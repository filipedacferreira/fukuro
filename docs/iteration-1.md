# Iteration 1 — Manga CBZ Batcher

**Date:** May 2026  
**Status:** Complete (pending Rust install for first dev run)

---

## Overview

fukuro is a desktop utility for readers who download manga chapters as folders of numbered JPEG images and want to batch them into a single `.cbz` file for use in a CBZ reader like Yacreader or CDisplayEx.

The core problem it solves:
- Manga chapters arrive with inconsistent, non-sequential folder names (e.g. `[SubGroup] Title v01 ch001 [1080p]`)
- Some chapters contain extra images (cover variants, credits pages, ads) that break sequential reading
- Manually renaming, culling, and zipping dozens of folders is tedious

fukuro provides a visual interface to reorder chapters, rename them cleanly, mark unwanted images for exclusion, and export everything as a single `.cbz` in one click.

---

## Tech stack decisions

### Tauri v2 — why not Electron

Both Tauri and Electron let you build a Windows desktop app using web tech. The decision factors:

| | Tauri | Electron |
|---|---|---|
| Bundle size | ~10–15 MB | ~150–200 MB |
| File system ops | Native Rust — fast, no overhead | Node.js + IPC |
| Zipping | `zip` crate, no subprocess | Node's `archiver` or similar |
| Learning curve | Rust basics required | Pure JS/TS |
| macOS dev → Windows build | Yes, via CI | Yes, via CI |

For a file-heavy utility (reading hundreds of images, creating ZIP archives), the Rust backend is a natural fit. Bundle size is also a meaningful concern for a tool you want to share easily.

### React 19 + TypeScript + Vite — not Svelte or Vue

The user is part of Significa, a product studio with a React-centric stack. Using React ensures consistency with the rest of the team's muscle memory and allows reuse of Significa's Foundations component library.

### Significa Foundations — why copied, not installed

Foundations (foundations.significa.co) is not published as an npm package — components are designed to be copied into your project and adapted. This is intentional: it avoids dependency lock-in and lets each project own its component implementations. When a Foundations component changes, you pull the new source selectively rather than running `npm update`.

The CSS tokens and design system (spacing, colour, radius, shadows, typography) come from the Foundations `globals.css`, imported via `src/index.css`. The colour scheme is automatic OS light/dark via `@media (prefers-color-scheme: dark)`.

### SQLite for state persistence

State is persisted to a local SQLite database rather than using ephemeral in-memory state or a flat JSON file. This means:

- Work survives app restarts — you can reorder chapters, mark exclusions, and come back the next day
- The schema is relational, making the future volumes feature straightforward to add
- A single Mutex-wrapped `rusqlite::Connection` is managed as Tauri app state, giving all Rust commands shared access without complexity

The DB file lives at `{AppData}/fukuro.db`:
- macOS: `~/Library/Application Support/io.fukuro/fukuro.db`
- Windows: `%APPDATA%\io.fukuro\fukuro.db`

WAL mode and foreign key enforcement are enabled on every connection.

---

## Data model

```
projects
  id          TEXT PK
  root_path   TEXT        ← the folder the user opened
  name        TEXT        ← derived from folder name
  created_at  INTEGER     ← Unix timestamp

chapters
  id           TEXT PK
  project_id   TEXT FK → projects (CASCADE DELETE)
  folder_path  TEXT        ← absolute path to the chapter folder on disk
  display_name TEXT        ← what the user sees (editable)
  sort_order   INTEGER     ← 0-based, drives export order
  image_count  INTEGER     ← cached at scan time

excluded_images
  chapter_id  TEXT FK → chapters (CASCADE DELETE)
  image_path  TEXT        ← absolute path to the image file
  PRIMARY KEY (chapter_id, image_path)
```

`excluded_images` is a soft-delete table — marking an image for exclusion does not touch the file on disk. Hard delete (trash icon with confirmation) actually calls `fs::remove_file` and then removes the row.

---

## User flows

### Opening a project

1. Click "Open folder" → Tauri's native folder picker dialog opens (`@tauri-apps/plugin-dialog`)
2. The selected path is passed to the `create_project` Rust command
3. Rust scans the folder for immediate subdirectories (non-recursive), counts images per subfolder, and inserts them into the DB ordered by filesystem filename sort (the initial best guess at order)
4. The new project is returned to the frontend and the editor view is loaded

Re-opening a project from the home screen calls `get_project_chapters`, which also rescans the root folder for new subdirectories and inserts them as chapters at the end of the sort order. Existing chapters — including any custom ordering or renames — are left untouched.

### Reordering chapters

The chapter list uses `@dnd-kit/sortable` with a pointer sensor. Dragging a row calls `arrayMove` on the local array (immediate optimistic UI update), then fires `reorder_chapters(orderedIds[])` to the Rust backend which bulk-updates `sort_order` in SQLite.

The `sort_order` column drives both the display order in the editor and the page order in the exported CBZ.

### Renaming a chapter

The display name in each row is a click-to-edit inline field. Clicking the name replaces it with a Foundations `<Input>` component. Pressing Enter or blurring commits via `rename_chapter(id, name)`. Pressing Escape discards the change. The original folder name is never changed on disk — only `display_name` in the DB is updated.

### Culling images

Clicking the expand arrow on a chapter row loads the `ImageGrid` component, which calls `get_chapter_images`. The Rust command:

1. Reads the chapter's `folder_path` from DB
2. Scans the folder for image files (jpg, jpeg, png, webp, gif, avif)
3. Applies a **natural sort** algorithm so `2.jpg` comes before `10.jpg`
4. Queries `excluded_images` for this chapter and sets `isExcluded` on each image
5. Returns `thumbnailPath` for each image — the cached 200 px thumbnail path if it exists, or the original path as fallback

In the grid, clicking an image thumbnail **toggles its exclusion state**:
- Excluded images get a desaturated overlay with an eye-slash icon
- The chapter badge shows active count + strikethrough excluded count
- The toggle is optimistic — UI updates immediately, DB write happens in background

The trash icon on each thumbnail triggers a confirmation dialog before calling `hard_delete_image`, which removes the file from disk, deletes its cached thumbnail, and cleans up any exclusion row.

Images are served to the `<img>` tag using `convertFileSrc()` from `@tauri-apps/api/core`, which translates absolute file paths to Tauri's `asset://localhost/...` URL scheme.

#### Thumbnail optimisation

After `get_chapter_images` returns, `ImageGrid` checks whether any images lack a cached thumbnail (`thumbnailPath === path`). If so, it calls `generate_chapter_thumbnails_stream`, which:

1. Spawns a detached OS thread immediately and returns — the IPC call resolves without blocking
2. Inside the thread, processes all images in parallel via `rayon`
3. For each image: decodes with the `image` crate, resizes to 200 px wide with `fast_image_resize` (SIMD bilinear), encodes as JPEG at quality 75, writes to `{AppData}/thumbnails/{chapter_id}/{stem}.jpg`
4. Emits a `ThumbnailUpdate { imagePath, thumbnailPath }` event through a Tauri Channel for each completed thumbnail

The frontend listens on the Channel and swaps each image's `src` in as its thumbnail arrives. Images without a ready thumbnail render blurred with a spinner overlay. On subsequent opens the cached thumbnails load instantly.

### Exporting

The Export panel sits at the bottom of the editor. Clicking "Export CBZ" opens a native save dialog filtered to `.cbz`. The selected output path is passed to `create_cbz(projectId, outputPath)`.

The Rust command:

1. Acquires the DB lock, reads all chapters ordered by `sort_order`, reads all excluded image paths, then **releases the lock before doing any I/O**
2. For each chapter folder, reads image files from disk, applies the same natural sort, and filters out excluded paths
3. Writes a ZIP archive (no compression — CBZ readers expect uncompressed images for fast page seeks) with sequentially named entries: `0000.jpg`, `0001.jpg`, etc.
4. Returns the output path on success; the frontend shows a positive toast

The sequential naming (`0000.jpg`, `0001.jpg`, …) is important: CBZ readers sort entries alphabetically, so padding to 4 digits ensures correct page order across all chapter boundaries.

---

## Rust command reference

### `create_project(rootPath: String) → Project`

Scans `rootPath` for immediate subdirectories. For each:
- Counts image files (depth 1 only)
- Inserts a `chapters` row with `sort_order = index` (sorted by OS filename order)

Returns the new `Project` with `chapterCount`.

### `list_projects() → Vec<Project>`

Left-join query on `projects` + `chapters`, grouped to produce `chapterCount`. Ordered by `created_at DESC`.

### `delete_project(id: String) → ()`

Single DELETE on `projects`. `ON DELETE CASCADE` handles chapters and excluded_images automatically.

### `get_project_chapters(projectId: String) → Vec<Chapter>`

Ordered by `sort_order`. Subquery counts `excluded_count` per chapter inline.

Also rescans the project's `root_path` for subdirectories not yet in the DB. New entries are inserted at the end of the sort order (`MAX(sort_order) + 1 + i`). The DB lock is held only for the query + insert phase — no thumbnail generation happens here.

### `reorder_chapters(chapterIds: Vec<String>) → ()`

Iterates the incoming ordered array and issues `UPDATE chapters SET sort_order = {i} WHERE id = {id}` for each. Called after every drag-and-drop.

### `rename_chapter(id: String, name: String) → ()`

Simple `UPDATE` of `display_name`. Does not touch the filesystem.

### `get_chapter_images(chapterId: String) → Vec<ImageMeta>`

Acquires the DB lock to read `folder_path` and collect excluded paths into a `HashSet<String>`, then releases the lock. Reads the directory from disk, filters to image extensions, applies `natural_sort_key`, and annotates each entry with `isExcluded`.

Also resolves `thumbnailPath` for each image: checks whether `{AppData}/thumbnails/{chapter_id}/{stem}.jpg` exists. If it does, that path is returned; otherwise `path` (the original) is used as fallback. No thumbnail generation happens in this command — it only reads the cache.

The natural sort key function splits a filename into alternating text and zero-padded numeric segments, producing a comparable `Vec<String>`. This ensures `ch10.jpg` sorts after `ch9.jpg`.

### `generate_chapter_thumbnails_stream(chapterId: String, onEvent: Channel<ThumbnailUpdate>) → ()`

Returns immediately after spawning a detached OS thread. The thread scans the chapter folder, generates thumbnails in parallel via `rayon`, and streams `{ imagePath, thumbnailPath }` events through the Tauri Channel as each thumbnail completes. Skips images whose thumbnail already exists in cache.

Thumbnail spec: 200 px wide, proportional height, JPEG quality 75, bilinear filter via `fast_image_resize`.

### `clear_thumbnail_cache() → ()`

Deletes `{AppData}/thumbnails/` and all its contents. Exposed as **Tools → Clear Thumbnail Cache** in the native menu bar — not surfaced in the UI.

### `toggle_exclusion(chapterId: String, imagePath: String) → bool`

Checks for an existing row in `excluded_images`. If present, deletes it and returns `false` (now included). If absent, inserts it and returns `true` (now excluded). Returns the new excluded state so the frontend can update the badge count.

### `hard_delete_image(chapterId: String, path: String) → ()`

`std::fs::remove_file(path)`, then deletes the corresponding thumbnail from `{AppData}/thumbnails/{chapter_id}/{stem}.jpg` if it exists, then DELETE from `excluded_images`. The chapter's `image_count` in DB is intentionally not updated here — it was cached at scan time and the frontend tracks the live count in component state.

### `create_cbz(projectId: String, outputPath: String) → String`

Uses the `zip` crate's `ZipWriter`. Steps:
1. Lock → collect `(folder_path, excluded_set)` for all chapters → unlock
2. For each chapter: read dir, filter images, natural sort, filter excluded
3. For each image: `zip.start_file(format!("{:04}.{ext}", global_index), options)` then `zip.write_all(&data)`
4. `zip.finish()` closes the archive
5. Returns `outputPath` for the success toast to display

Compression method is `Stored` (no compression) — CBZ readers memory-map the file for fast seeks, and re-compressing already-compressed JPEGs would only waste CPU.

---

## Frontend architecture

### View routing

`App.tsx` holds a single `View` discriminated union in local state:

```ts
type View =
  | { type: 'projects' }
  | { type: 'editor'; projectId: string; projectName: string }
```

No router library — for a two-screen app it's unnecessary overhead.

### State management

All state is local to components. There is no global store. The DB is the source of truth for persisted data; component state is a temporary view layer that syncs with the DB through Tauri commands.

Optimistic updates are used throughout: UI updates immediately, the async DB write happens in the background, and errors revert the state and show a toast. This keeps the app feeling snappy.

### `src/lib/tauri.ts`

A thin typed wrapper over `invoke()` from `@tauri-apps/api/core`. Every Rust command has a corresponding `api.commandName()` function here. This is the single place that knows about command name strings — components never call `invoke` directly.

### Foundations components used

| Component | Used in |
|---|---|
| `Button`, `IconButton` | Throughout |
| `Input` | `ChapterItem` inline rename |
| `Dialog` | Delete confirmations |
| `Modal` | Base for Dialog |
| `Toaster` + `toast()` | Error/success feedback |
| `Spinner` | Button loading states |
| `Skeleton` | Loading placeholders |
| `Divider` | Button.Group internal |
| `Slot`, `Slottable` | Component composition primitives |

---

## What's not built yet

See [`roadmap.md`](./roadmap.md).
