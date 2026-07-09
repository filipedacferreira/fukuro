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

### Tagged enums — discriminated unions over a Channel

When a command needs to stream *different kinds* of events (progress, success, error), a Rust enum serialises cleanly as a TypeScript discriminated union:

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ExportEvent {
    Progress { current: u32, total: u32 },
    Done { output_path: String },
    Error { message: String },
}
```

`tag = "type"` tells serde to add a `"type"` field to every variant's JSON object instead of the default serde wrapping. So `ExportEvent::Progress { current: 5, total: 10 }` becomes:

```json
{ "type": "progress", "current": 5, "total": 10 }
```

On the TypeScript side this maps directly to a discriminated union:

```ts
type ExportEvent =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; outputPath: string }
  | { type: 'error'; message: string }
```

The `Channel<ExportEvent>` generic on the Rust side and `Channel<ExportEvent>` on the TS side agree on the shape, so each `on_event.send(...)` call is type-safe end-to-end.

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

## `reqwest` — async HTTP inside a Tauri command

Tauri runs on a Tokio async runtime. `reqwest::blocking` tries to spin up its own runtime internally, which panics when nested inside an existing one. The fix is to make the command `async` and use `reqwest::Client` (the async client) with `.await`.

```rust
#[tauri::command]
pub async fn fetch_anilist_cover(
    project_id: String,
    anilist_id: i64,
    state: tauri::State<'_, DbState>,   // note the explicit lifetime
    app_handle: tauri::AppHandle,
) -> Result<AnilistResult, String> {
    let client = reqwest::Client::new();
    // ...
}
```

The `'_` lifetime on `tauri::State` is required for async commands — the compiler needs to know the state reference is tied to the function's lifetime, not `'static`.

**POST with a JSON body**

```rust
let response: serde_json::Value = client
    .post("https://graphql.anilist.co")
    .json(&serde_json::json!({ "query": "...", "variables": { "id": 123 } }))
    .send()
    .await
    .map_err(|e| format!("Request failed: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Parse failed: {e}"))?;
```

- `.json(&body)` serialises the body and sets `Content-Type: application/json`
- `.send().await` suspends until the response headers arrive
- `.json().await` reads and deserialises the response body

**Navigating dynamic JSON with `.pointer()`**

`serde_json::Value` lets you traverse the response without declaring a struct:

```rust
let title = response
    .pointer("/data/Media/title/english")
    .and_then(|v| v.as_str())
    .unwrap_or("Unknown");
```

`.pointer("/a/b/c")` is equivalent to `response["a"]["b"]["c"]` but returns `Option<&Value>` rather than panicking on a missing key.

**Downloading bytes**

```rust
let bytes = client
    .get(&url)
    .send()
    .await
    .map_err(|e| format!("Download failed: {e}"))?
    .bytes()
    .await
    .map_err(|e| format!("Read failed: {e}"))?;
```

`.bytes().await` collects the full response body as raw bytes. Pass `&bytes` to `image::load_from_memory` directly.

**Offloading CPU-bound work from async**

Async executors are for I/O — blocking them with CPU-heavy work (image decoding/encoding) starves other tasks. Use `spawn_blocking` to run it on a dedicated thread pool:

```rust
let img_bytes_vec = bytes.to_vec();         // clone data before move
let dest_clone = dest.clone();              // clone path before move

tauri::async_runtime::spawn_blocking(move || {
    encode_cover(&img_bytes_vec, &dest_clone)
})
.await
.map_err(|e| format!("Encoding task failed: {e}"))??; // outer ? = JoinError, inner ? = encode error
```

The double `??` unwraps two layers: `spawn_blocking` returns `Result<Result<(), String>, JoinError>`, so we propagate both.

**Accessing the DB after async work**

Lock the mutex only after all async/blocking work is done — never hold a `MutexGuard` across an `.await` point (the compiler will reject it anyway, since `MutexGuard` is not `Send`):

```rust
// all network + encoding done first
let conn = state.0.lock().map_err(|e| e.to_string())?;
conn.execute("UPDATE projects SET ...", params![...])?;
```

---

## Re-encoding images with the `image` crate

The cover commands decode any supported input format and re-encode it as JPEG. This normalises the format and controls quality.

```rust
use image::ImageEncoder;
use image::codecs::jpeg::JpegEncoder;

// Load from raw bytes — detects format automatically (JPEG, PNG, WebP, etc.)
let img = image::load_from_memory(&source_bytes).map_err(|e| e.to_string())?;

// Convert to RGB (JPEG doesn't support an alpha channel)
let rgb = img.to_rgb8();

// Encode to an in-memory buffer at a specific quality (0–100)
let mut buf = Vec::new();
let encoder = JpegEncoder::new_with_quality(&mut buf, 100);
encoder
    .write_image(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| e.to_string())?;

// Write the buffer to disk
std::fs::write(&dest_path, &buf).map_err(|e| e.to_string())?;
```

Key points:
- `load_from_memory` auto-detects format from the bytes header (no file extension needed)
- `to_rgb8()` converts RGBA/greyscale to RGB so JPEG encoding doesn't fail
- `JpegEncoder::new_with_quality(&mut buf, 100)` — quality 100 means maximum fidelity
- Writing to `Vec<u8>` first avoids partial-write corruption if encoding fails mid-way

---

## `notify` — filesystem watching from a background thread

`commands/watch.rs` watches the entire configured library root — both the manga level (its immediate subfolders) and the chapter level (each manga's immediate subfolders) — for the whole app session, so adding/removing manga or chapter folders never requires restarting or re-importing anything.

```rust
let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
    // runs on notify's own background thread whenever the watched path changes
})
.map_err(|e| e.to_string())?;

watcher.watch(Path::new(&library_root), RecursiveMode::Recursive)?;
```

`notify::recommended_watcher` picks the best backend for the current OS (on Windows, `ReadDirectoryChangesW`) and runs it on a thread it manages internally — there's no `std::thread::spawn` here, unlike the thumbnail/export streaming commands. The closure you pass is the event handler, called once per filesystem event.

**One recursive watch covers two logical levels**

`RecursiveMode::Recursive` on Windows uses `ReadDirectoryChangesW`'s recursive flag, which automatically covers newly-created subfolders at any depth — you don't need to call `.watch()` again when a new manga folder appears, unlike a scheme where you'd manually add a watch per folder. That means a *single* `watch()` call on the library root sees every folder-level change, at any depth, for the whole session.

The event handler is what turns "any depth" back into "the two levels we actually care about." For every path in an event, it compares that path's **parent directory** against the library root and against every known project's `root_path`:

```rust
if normalized_parent == normalized_root {
    // a manga folder appeared/disappeared directly under the library root
} else if let Some((project_id, project_root)) = project_roots
    .iter()
    .find(|(_, root)| normalize_path(Path::new(root)) == normalized_parent)
{
    // a chapter folder appeared/disappeared directly under that manga's folder
}
// anything else (e.g. an image file inside a chapter folder) is ignored
```

This is why the recursive watch is safe to use broadly: events three or more levels deep (an image file, a `.tmp` file mid-download, etc.) simply don't match either parent-dir check and are dropped without doing anything.

**Getting state into the handler closure**

The handler closure isn't a `#[tauri::command]`, so Tauri can't inject `AppHandle` or `State` into it the normal way. Instead, clone what you need from the surrounding function *before* the closure and `move` the clone in:

```rust
let app_for_handler = app.clone();
```

`AppHandle` is cheap to clone (it's a handle, not the app itself) and `Send + Sync`, so it's safe to hand a clone to notify's background thread. Inside the closure, `app_for_handler.state::<DbState>()` fetches the same managed state that `tauri::State<DbState>` would inject into a command. Everything else the closure needs (the library root, the current list of project root_paths) is re-read from the DB on every event rather than captured once — both can change over the watcher's lifetime, and the extra query is cheap next to the filesystem rescans it gates.

**Keeping the watcher alive — and restarting it**

A `RecommendedWatcher` stops watching the moment it's dropped. That's the mechanism this codebase uses for teardown/restart: `WatcherState` holds `Mutex<Option<RecommendedWatcher>>`, and `start_library_watcher` just assigns a new value into that `Option` — the old watcher (if any) is dropped as part of the assignment, which stops it:

```rust
let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
*guard = Some(watcher); // replaces (and thus drops/stops) any previous watcher
```

`start_library_watcher` is a plain function, not a `#[tauri::command]` — it's called from `lib.rs`'s `setup()` at launch (if a library root is already configured from a previous session) and again from `set_library_root` whenever the user points the app at a different root. If no root is configured, it just clears `WatcherState` to `None` and returns — no watcher runs until one is set.

**Deduplicating events**

Filesystem watchers commonly fire multiple events for a single logical change (e.g. `Create` followed by a `Modify` as the OS finishes writing metadata), and notify's Windows backend reports generic `Create(CreateKind::Any)` / `Remove(RemoveKind::Any)` rather than distinguishing files from folders. Rather than trying to parse event details precisely, the handler just re-runs the same rescan logic used by `list_projects`/`get_project_chapters`: `insert_new_projects`/`insert_new_chapters` add any subfolder not yet in the DB, and `remove_missing_projects`/`remove_missing_chapters` delete any row whose folder no longer exists on disk. All four dedupe against actual DB/disk state, so redundant events end up as no-op rescans — and deleting a manga or chapter folder outside the app removes it automatically (no confirmation prompt, since the deletion already happened on disk).

---

## Guard-checked migrations — `column_exists` and `table_exists`

SQLite (as bundled here) has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and no schema-version primitive built into `rusqlite`, so `db.rs`'s `initialize()` guards each migration step by checking, in plain SQL, whether the thing it's about to add already exists:

```rust
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0) > 0
}

fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0) > 0
}
```

`pragma_table_info(table)` is a table-valued function SQLite provides for introspecting a table's columns; `sqlite_master` is SQLite's built-in catalog of every table/index/etc. in the database. Both guards return `false` (rather than propagating an error) if the query itself fails — safe because a failure here almost always means "the table doesn't exist yet," which is exactly the case the caller wants to treat as "not present."

`initialize()` runs on every launch, so `CREATE TABLE IF NOT EXISTS` handles brand-new databases for free. These guards exist for the two migration shapes `IF NOT EXISTS` can't express:

- **Adding a column to an existing table** (`cover_path`, `anilist_id`, `cover_title`): guarded with `column_exists`, then `ALTER TABLE ... ADD COLUMN` runs only if it's missing.
- **A breaking schema change with no in-place migration path**: when the single-library-root rearchitecture landed, old databases' `projects` rows each pointed at an independent, manually-picked folder — a shape the new "one root, auto-scanned" model can't reconcile. Rather than write a data migration, `table_exists(conn, "settings")` detects "this is an old-schema DB" (the `settings` table is new) and drops `excluded_images`/`chapters`/`projects` outright before the normal `CREATE TABLE IF NOT EXISTS` block repopulates them — the next scan of whatever library root the user configures rebuilds everything from disk.

---

## Practical reading order

If you want to trace a full request through the stack, follow this path:

1. **`src/lib/tauri.ts`** — see how the frontend calls a command
2. **`src-tauri/src/lib.rs`** — see it registered in `invoke_handler`
3. **`src-tauri/src/commands/images.rs`** — read the actual implementation
4. **`src/components/ImageGrid.tsx`** — see how the result is used in the UI

`get_chapter_images` + `generate_chapter_thumbnails_stream` are the most instructive pair — they show the lock discipline, the detached thread pattern, the Channel streaming, and the iterator chains all in one place.
