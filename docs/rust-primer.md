# Rust patterns in fukuro

This is not a Rust tutorial. It's a reference for the specific patterns that appear repeatedly in this codebase, explained in terms of what they're actually doing here.

---

## `Result<T, String>` — every command returns this

```rust
pub fn get_chapter_images(...) -> Result<Vec<ImageMeta>, String>
```

`Result<T, E>` is Rust's way of saying "this might fail." It's an enum with two variants:

```rust
Ok(value)   // success — contains the value
Err(reason) // failure — contains the error
```

We use `String` as the error type because Tauri serialises it and the frontend receives it as a plain string in the `catch` block.

When a command returns `Err("something went wrong".to_string())`, the `api.someCommand()` promise rejects, and the toast handler shows it.

---

## The `?` operator — early return on error

```rust
let conn = state.0.lock().map_err(|e| e.to_string())?;
```

The `?` at the end means: "if this is an `Err`, return it immediately from the current function." It's shorthand for:

```rust
let conn = match state.0.lock().map_err(|e| e.to_string()) {
    Ok(value) => value,
    Err(e) => return Err(e),
};
```

`.map_err(|e| e.to_string())` converts whatever error type the library returns into our `String` error type, so `?` can propagate it.

You'll see `?` on almost every fallible operation. Read it as "unwrap or bail."

---

## `tauri::State<DbState>` — dependency injection

```rust
pub fn get_chapter_images(
    chapter_id: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
)
```

Tauri automatically injects `state` and `app_handle` when it calls the command — you never pass them from the frontend. The frontend only sends `chapter_id`.

`DbState` is defined in `db.rs`:

```rust
pub struct DbState(pub Mutex<Connection>);
```

It's a newtype wrapper around a `Mutex<Connection>`. Tauri holds one instance of it for the whole app lifetime (registered with `app.manage(...)` in `lib.rs`), and every command that declares `state: tauri::State<DbState>` gets a reference to that same instance.

`app_handle` gives access to app-level APIs — we use it to call `app_handle.path().app_data_dir()` to find where to store thumbnails.

---

## The `Mutex` lock — why we lock then unlock

```rust
let folder_path = {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(...)?
}; // conn dropped here → lock released
```

`Mutex` ("mutual exclusion") ensures only one thread accesses the database at a time. `state.0.lock()` blocks until the lock is free, then returns a `MutexGuard` — a smart pointer that releases the lock when it goes out of scope.

The curly braces `{ }` create a new scope. When `conn` reaches the closing `}`, it's dropped, which releases the lock. This matters because we don't want to hold the DB lock while doing slow disk I/O (reading image files, generating thumbnails) — other commands would be blocked waiting.

The pattern throughout this codebase is: **lock → query → release → do I/O**.

---

## `#[derive(Serialize, Deserialize)]` — crossing the Rust/JS boundary

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMeta {
    pub path: String,
    pub thumbnail_path: String,
    pub filename: String,
    pub is_excluded: bool,
}
```

`serde` is the serialisation library. `#[derive(Serialize)]` auto-generates code to convert this struct to JSON. `#[derive(Deserialize)]` does the reverse.

`#[serde(rename_all = "camelCase")]` means `thumbnail_path` in Rust becomes `thumbnailPath` in JSON — matching TypeScript conventions without manual mapping.

When a Tauri command returns `Ok(image_meta)`, serde serialises it to JSON, Tauri sends it over IPC, and the TypeScript side receives a plain object matching the `ImageMeta` interface in `types.ts`.

---

## `#[tauri::command]` — registering a function as callable from JS

```rust
#[tauri::command]
pub fn get_chapter_images(...) -> Result<Vec<ImageMeta>, String>
```

This attribute macro transforms the function so Tauri can call it from the frontend via `invoke('get_chapter_images', { chapterId })`. Without it, it's just a regular Rust function invisible to the frontend.

The command is also registered in `lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::images::get_chapter_images,
    ...
])
```

Both are required — the attribute and the registration.

---

## Iterator chains — the functional loops

```rust
let images: Vec<ImageMeta> = std::fs::read_dir(&folder_path)?
    .filter_map(|e| e.ok())
    .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
    .map(|e| { ... })
    .collect();
```

This is idiomatic Rust instead of `for` loops. Read it top to bottom:

| Step | What it does |
|---|---|
| `read_dir(...)` | Returns an iterator of `Result<DirEntry>` |
| `.filter_map(\|e\| e.ok())` | Keeps only the `Ok` entries, discards errors |
| `.filter(\|e\| ...)` | Keeps only files (not subdirectories) |
| `.map(\|e\| { ... })` | Transforms each entry into an `ImageMeta` |
| `.collect()` | Consumes the iterator and builds a `Vec` |

Nothing runs until `.collect()` — iterators in Rust are lazy. The type annotation `Vec<ImageMeta>` tells the compiler what to build.

`.unwrap_or(false)` is a safe unwrap: if the inner `Result` or `Option` is an error/None, use `false` instead of panicking.

---

## `move` closures — capturing variables into threads

```rust
std::thread::spawn(move || {
    // uses folder_path, thumb_dir, on_event
});
```

`move` means the closure takes *ownership* of the variables it uses (`folder_path`, `thumb_dir`, `on_event`). Without `move`, the closure would borrow them — but borrows can't outlive the function that created them, and a spawned thread lives longer than the function that spawned it.

After `move`, those variables are owned by the thread. You can't use them in the original function anymore — they've moved. This is the compiler enforcing that two threads can't share data unsafely.

---

## `rayon` — one-word parallelism

```rust
images.par_iter().for_each(|entry| {
    // runs on a thread pool
});
```

`par_iter()` replaces `iter()` and automatically distributes work across a thread pool sized to the number of CPU cores. Each `for_each` closure runs on a different core simultaneously.

The `rayon` thread pool is separate from the OS thread we spawned with `std::thread::spawn`. The structure is:

```
IPC thread        → command returns immediately
  └─ OS thread    → owns the work loop
       └─ rayon   → splits images across CPU cores
```

`rayon` requires the closure to be `Send` (safe to send across threads) — the compiler enforces this automatically.

---

## `Path` vs `String` — two ways to handle file paths

```rust
let path = normalize_path(&entry.path());
let stem = Path::new(&filename).file_stem().unwrap_or_default().to_string_lossy().into_owned();
```

`Path` is Rust's type for filesystem paths — it understands separators, extensions, stems, etc. `String` is just text.

- `entry.path()` → `PathBuf` (owned path)
- `.to_string_lossy()` → `Cow<str>` (a string-like that might borrow or own)
- `.into_owned()` → `String` (forces an owned `String`)

`normalize_path` (in `utils.rs`) converts any path to a forward-slash string — needed because Windows uses backslashes natively but paths are stored in the DB with forward slashes. Always use `normalize_path` when turning a `Path` into a `String` for storage or comparison; never call `.replace('\\', "/")` inline.

`Path::new(&filename).file_stem()` extracts `"001"` from `"001.jpg"`. `.unwrap_or_default()` returns an empty string if there's no stem rather than panicking.

---

## `pub` vs no `pub` — what's visible where

```rust
pub fn is_image_file(...)   // callable from other modules (projects.rs uses this)
fn ensure_thumbnail(...)    // private to images.rs
pub struct ImageMeta { ... }  // type visible to the whole crate
pub path: String,           // field readable outside the module
```

`pub` is explicit in Rust — nothing is public by default. Helper functions used only within `images.rs` have no `pub`. Structs returned from commands need `pub` so Tauri's generated code can access their fields.

---

## Practical reading order

If you want to trace a full request through the stack, follow this path:

1. **`src/lib/tauri.ts`** — see how the frontend calls a command
2. **`src-tauri/src/lib.rs`** — see it registered in `invoke_handler`
3. **`src-tauri/src/commands/images.rs`** — read the actual implementation
4. **`src/components/ImageGrid.tsx`** — see how the result is used in the UI

`get_chapter_images` + `generate_chapter_thumbnails_stream` are the most instructive pair — they show the lock discipline, the detached thread pattern, the Channel streaming, and the iterator chains all in one place.
