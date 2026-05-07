# fukuro

Desktop utility for batching manga chapters into `.cbz` files. Built with Tauri v2 (Rust backend) + React + TypeScript + Tailwind CSS v4.

## Stack

| Layer | Choice |
|---|---|
| App shell | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Components | Significa Foundations (copied into `src/foundations/`) |
| Drag-to-reorder | @dnd-kit/sortable |
| Local DB | SQLite via `rusqlite` (bundled) |
| Zipping | `zip` crate |
| Image decoding | `image` crate (jpeg, png, gif, webp) |
| Thumbnail resize | `fast_image_resize` (SIMD-accelerated, bilinear) |
| Parallel processing | `rayon` |

## Project structure

```
src/
  App.tsx                         # Top-level view router (projects ↔ editor)
  types.ts                        # Shared TS types (Project, Chapter, ImageMeta, ThumbnailUpdate)
  index.css                       # Tailwind v4 + Foundations CSS tokens
  lib/
    tauri.ts                      # Typed invoke() wrappers for all Rust commands
    utils/classnames.ts           # CVA + tailwind-merge setup (cn, cva)
  components/
    ProjectList.tsx               # Home screen: recent projects, open folder
    Editor.tsx                    # Main workspace: chapter list + export panel
    ChapterList.tsx               # DnD context + sortable list
    ChapterItem.tsx               # Single chapter row: drag, rename, expand
    ImageGrid.tsx                 # Thumbnail grid with exclusion toggle + streaming optimiser
    ExportPanel.tsx               # Save dialog + export button
  foundations/                    # Significa Foundations components (copied, not installed)
    components/slot/
    hooks/use-element-transition/
    hooks/use-top-layer/
    utils/compose-refs/
    utils/dom/
    ui/button/ input/ dialog/ modal/ spinner/ skeleton/ divider/ toaster/

src-tauri/src/
  lib.rs                          # Tauri builder: plugin init, DB setup, command registry, native menu
  db.rs                           # DbState type + SQLite schema migration
  commands/
    mod.rs
    projects.rs                   # create_project, list_projects, delete_project, get_project_chapters
    chapters.rs                   # reorder_chapters, rename_chapter
    images.rs                     # get_chapter_images, generate_chapter_thumbnails_stream,
                                  # clear_thumbnail_cache, toggle_exclusion, hard_delete_image
    export.rs                     # create_cbz
```

## Database

SQLite at `{AppData}/fukuro.db` (macOS: `~/Library/Application Support/co.significa.fukuro/fukuro.db`).

```sql
projects       (id, root_path, name, created_at)
chapters       (id, project_id→projects, folder_path, display_name, sort_order, image_count)
excluded_images(chapter_id→chapters, image_path)  -- soft-delete exclusions
```

Foreign keys with `ON DELETE CASCADE`. WAL mode enabled.

## Rust commands

All commands return `Result<T, String>`. Errors surface as toast notifications in the UI.

| Command | Description |
|---|---|
| `create_project(rootPath)` | Scan folder for subdirs, create project + chapters in DB |
| `list_projects()` | Return projects ordered by `created_at DESC` |
| `delete_project(id)` | Cascade delete (chapters + exclusions) |
| `get_project_chapters(projectId)` | Chapters ordered by `sort_order`; rescans disk for new subdirs and inserts them |
| `reorder_chapters(chapterIds[])` | Bulk update `sort_order` after drag-drop |
| `rename_chapter(id, name)` | Update `display_name` |
| `get_chapter_images(chapterId)` | FS read + natural sort, with `isExcluded` and `thumbnailPath` |
| `generate_chapter_thumbnails_stream(chapterId, onEvent)` | Spawns background thread; generates thumbnails in parallel via rayon and streams `ThumbnailUpdate` events through a Tauri Channel |
| `clear_thumbnail_cache()` | Deletes `{AppData}/thumbnails/` entirely (dev menu action) |
| `toggle_exclusion(chapterId, imagePath)` | Insert/delete from `excluded_images`, returns new state |
| `hard_delete_image(chapterId, path)` | `fs::remove_file` + thumbnail cache cleanup + DB cleanup |
| `create_cbz(projectId, outputPath)` | Zip all non-excluded images in chapter/page order |

## Thumbnail cache

Generated on first expand of each chapter, cached across sessions.

- **Location:** `{AppData}/thumbnails/{chapter_id}/{stem}.jpg`
  (macOS: `~/Library/Application Support/co.significa.fukuro/thumbnails/`)
- **Size:** 200 px wide, proportional height
- **Encoding:** JPEG quality 75
- **Algorithm:** bilinear via `fast_image_resize` (SIMD), parallel workers via `rayon`
- **Lifecycle:** created by `generate_chapter_thumbnails_stream`, invalidated individually by `hard_delete_image`, wiped entirely via **Tools → Clear Thumbnail Cache** in the native menu bar

### ImageGrid flow

1. `get_chapter_images` returns immediately — checks cache, no generation
2. Images without a cached thumbnail have `thumbnailPath === path` (original as fallback, shown blurred with a spinner)
3. `generate_chapter_thumbnails_stream` runs in a detached thread, streams `{ imagePath, thumbnailPath }` via Channel
4. Frontend swaps each image in as its thumbnail arrives; blur/spinner clears

## Native menu

Configured in `lib.rs` via `tauri::menu`. Current items:

| Menu | Item | Action |
|---|---|---|
| Fukurō | About, Quit | standard |
| Tools | Clear Thumbnail Cache | deletes `{AppData}/thumbnails/` silently |

## Developer learning — PRIORITY

The developer is new to Rust and Tauri. `docs/rust-primer.md` is a living reference that explains every non-obvious Rust pattern used in this codebase in plain terms, tied to real code examples from the project.

**When writing or changing any Rust code, always update `docs/rust-primer.md` if:**
- A new pattern, crate, or language feature is introduced that doesn't already have an entry
- An existing pattern changes in a meaningful way (e.g. a different concurrency model, a new error handling approach)
- A concept is used in a more complex or nuanced way than previously documented

The goal is that the developer can read any file in `src-tauri/` and immediately look up what an unfamiliar construct does in the primer. Do not let the primer fall out of sync. Prefer updating an existing entry over adding a new one if the concept already has coverage.

## Git commits

Format: `feat(context): message` — one line, no description, no co-authoring.

## Development

Requires Rust (via rustup) and Node.js.

```bash
npm install
npm run tauri dev     # hot-reload dev server
npm run tauri build   # production build
```

## Path aliases

`@/` maps to `src/`. Configured in both `vite.config.ts` and `tsconfig.json`.

## Foundations components

Components live in `src/foundations/` and are **not** installed as a package — they are copied source files from [foundations.significa.co](https://foundations.significa.co). When updating a component, copy the new source from the site rather than editing in place.

Import path example: `import { Button } from '@/foundations/ui/button/button'`

## CBZ output format

Images are stored with zero-padded sequential names regardless of original filenames:

```
0000.jpg  ← chapter 1, page 1
0001.jpg
...
0086.jpg  ← chapter 2, page 1
```

Ensures correct display order in all CBZ readers.

## Image sorting

Images within each chapter folder are sorted with a natural sort algorithm (1, 2, 10 — not 1, 10, 2). Implemented in `commands/images.rs:natural_sort_key`.

## Planned (not built yet)

- Volume grouping (chapters → volumes → project)
