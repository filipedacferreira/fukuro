# fukuro

Desktop utility for batching manga chapters into `.cbz` files. Built with Tauri v2 (Rust backend) + React + TypeScript + Tailwind CSS v4.

## Stack

| Layer | Choice |
|---|---|
| App shell | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Components | Significa Foundations (copied into `src/components/ui/`) |
| Drag-to-reorder | motion/react (`Reorder`) |
| Local DB | SQLite via `rusqlite` (bundled) |
| Zipping | `zip` crate |
| HTTP client | `reqwest` (async + json features) |
| Image decoding | `image` crate (jpeg, png, gif, webp) |
| Thumbnail resize | `fast_image_resize` (SIMD-accelerated, bilinear) |
| Parallel processing | `rayon` |

## Project structure

```
src/
  app.tsx                         # Top-level view router (projects ↔ editor)
  main.tsx                        # React entry point
  types.ts                        # Shared TS types (Project, Chapter, ImageMeta, ThumbnailUpdate)
  index.css                       # Tailwind v4 + Foundations CSS tokens
  lib/
    tauri.ts                      # Typed invoke() wrappers for all Rust commands
    utils/classnames.ts           # CVA + tailwind-merge setup (cn, cva)
  views/
    projects/                     # Projects list view
      project-list.tsx            # Home screen: recent projects, open folder
    editor/                       # Editor view
      editor.tsx                  # Main workspace: chapter list + export panel
      components/
        chapter-list.tsx          # DnD context + sortable list
        chapter-item.tsx          # Single chapter row: drag, rename, expand
        image-grid.tsx            # Thumbnail grid with exclusion toggle + streaming optimiser
        export-panel.tsx          # Save dialog + export button
  components/
    ui/                           # Significa Foundations UI (copied, not installed)
      slot.tsx button.tsx dialog.tsx disclosure.tsx divider.tsx
      input.tsx modal.tsx skeleton.tsx spinner.tsx toaster.tsx
    cover-dialog.tsx              # Shared cover dialog (open from project list or editor)
  hooks/                          # Foundations hooks (copied from foundations.significa.co)
    use-element-transition.ts
    use-top-layer.ts
  utils/                          # Foundations utils (copied from foundations.significa.co)
    compose-refs.ts
    next-frame.ts

src-tauri/src/
  lib.rs                          # Tauri builder: plugin init, DB setup, command registry, native menu
  db.rs                           # DbState type + SQLite schema migration
  utils.rs                        # Shared helpers: is_image_file, natural_sort_key
  commands/
    mod.rs
    projects.rs                   # create_project, list_projects, delete_project, rename_project, get_project_chapters
    chapters.rs                   # reorder_chapters, rename_chapter
    images.rs                     # get_chapter_images, toggle_exclusion, hard_delete_image
    thumbnails.rs                 # generate_chapter_thumbnails_stream, clear_thumbnail_cache, ensure_thumbnail
    export.rs                     # create_cbz
    cover.rs                      # set_project_cover, fetch_anilist_cover, remove_project_cover
```

## Database

SQLite at `{AppData}/fukuro.db` (macOS: `~/Library/Application Support/io.fukuro/fukuro.db`).

```sql
projects       (id, root_path, name, created_at, cover_path, anilist_id)
chapters       (id, project_id→projects, folder_path, display_name, sort_order, image_count)
excluded_images(chapter_id→chapters, image_path)  -- soft-delete exclusions
```

`cover_path` and `anilist_id` are nullable — added via `ALTER TABLE` migration in `db.rs` (guarded by `pragma_table_info` since SQLite has no `ADD COLUMN IF NOT EXISTS`).

Foreign keys with `ON DELETE CASCADE`. WAL mode enabled.

## Rust commands

All commands return `Result<T, String>`. Errors surface as toast notifications in the UI.

| Command | Description |
|---|---|
| `create_project(rootPath)` | Scan folder for subdirs, create project + chapters in DB |
| `list_projects()` | Return projects ordered by `created_at DESC` |
| `delete_project(id)` | Cascade delete (chapters + exclusions) |
| `rename_project(id, name)` | Update project display name |
| `get_project_chapters(projectId)` | Chapters ordered by `sort_order`; rescans disk for new subdirs and inserts them |
| `reorder_chapters(chapterIds[])` | Bulk update `sort_order` after drag-drop |
| `rename_chapter(id, name)` | Update `display_name` |
| `get_chapter_images(chapterId)` | FS read + natural sort, with `isExcluded` and `thumbnailPath` |
| `toggle_exclusion(chapterId, imagePath)` | Insert/delete from `excluded_images`, returns new state |
| `hard_delete_image(chapterId, path)` | `fs::remove_file` + thumbnail cache cleanup + DB cleanup |
| `generate_chapter_thumbnails_stream(chapterId, onEvent)` | Spawns background thread; generates thumbnails in parallel via rayon and streams `ThumbnailUpdate` events through a Tauri Channel |
| `clear_thumbnail_cache()` | Deletes `{AppData}/thumbnails/` entirely (dev menu action) |
| `create_cbz(projectId, outputPath)` | Zip all non-excluded images in chapter/page order; if a cover is set, it is written as `0000.jpg` and chapter pages start at `0001.jpg` |
| `set_project_cover(projectId, imagePath)` | Re-encode picked image as JPEG quality 100, store in `{AppData}/covers/`, update DB |
| `fetch_anilist_cover(projectId, anilistId)` | Fetch cover from Anilist GraphQL API, re-encode and store; returns `{ title, coverPath }` |
| `remove_project_cover(projectId)` | Delete cover file and clear `cover_path`/`anilist_id` in DB |

## Thumbnail cache

Generated on first expand of each chapter, cached across sessions.

- **Location:** `{AppData}/thumbnails/{chapter_id}/{stem}.jpg`
  (macOS: `~/Library/Application Support/io.fukuro/thumbnails/`)
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
| Edit | Undo, Redo, Cut, Copy, Paste, Select All | standard (predefined) |
| Tools | Clear Thumbnail Cache | deletes `{AppData}/thumbnails/` silently |

## Developer learning — PRIORITY

The developer is new to Rust and Tauri. `docs/rust-primer.md` is a living reference that explains every non-obvious Rust pattern used in this codebase in plain terms, tied to real code examples from the project.

**When writing or changing any Rust code, always update `docs/rust-primer.md` if:**
- A new pattern, crate, or language feature is introduced that doesn't already have an entry
- An existing pattern changes in a meaningful way (e.g. a different concurrency model, a new error handling approach)
- A concept is used in a more complex or nuanced way than previously documented

The goal is that the developer can read any file in `src-tauri/` and immediately look up what an unfamiliar construct does in the primer. Do not let the primer fall out of sync. Prefer updating an existing entry over adding a new one if the concept already has coverage.

All Rust source files must have descriptive inline comments, even for constructs that may seem obvious. These comments complement the primer and help the developer build intuition while reading code directly.

## Git commits

Format: `feat(context): message` — one line, no description, no co-authoring.

Split changes into multiple logical commits, each covering a single concern (e.g. DB schema, Rust commands, frontend feature, tooling, docs). Never bundle unrelated changes into one commit.

## Development

Requires Rust (via rustup) and Node.js.

```bash
pnpm install
pnpm dev         # hot-reload dev server (tauri dev)
pnpm build       # production build (tauri build)
pnpm lint        # biome lint (check only, no writes)
pnpm format      # biome check --write (lint + format + auto-fix)
pnpm check       # biome check (lint + format, no writes)
```

After making frontend changes, run `pnpm format` to auto-fix lint/format issues, then `pnpm check` to confirm no remaining violations.

## Component conventions

Components inside `src/views/` (and their `components/` subfolders) must use the arrow function + `FC` pattern:

```tsx
import type { FC } from 'react'

interface MyComponentProps {
  value: string
}

export const MyComponent: FC<MyComponentProps> = ({ value }) => {
  return <div>{value}</div>
}
```

- Always `import type { FC } from 'react'`
- Always declare a `Props` interface (even if empty, except for trivial internal sub-components)
- No `function` keyword declarations for components in this layer

## Path aliases

`@/` maps to `src/`. Configured in both `vite.config.ts` and `tsconfig.json`.

## Foundations components

Foundations UI components, hooks, and utils are **not** installed as a package — they are copied source files from [foundations.significa.co](https://foundations.significa.co). When updating a component, copy the new source from the site rather than editing in place.

They live alongside all other app code with no special namespace:
- UI components: `src/components/ui/{name}.tsx` (button, dialog, disclosure, divider, input, modal, skeleton, spinner, toaster, slot)
- Hooks: `src/hooks/{name}.ts` (use-element-transition, use-top-layer)
- Utils: `src/utils/{name}.ts` (compose-refs, next-frame)

Import path example: `import { Button } from '@/components/ui/button'`

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

## Platform target — Windows first

Windows is the primary target platform. macOS is supported but secondary. Every decision must be verified to work correctly on Windows.

### Path handling

Never manipulate file paths as raw strings. Always use Tauri's path APIs, which return and accept native OS paths (backslashes on Windows, forward slashes on macOS/Linux).

- **Obtaining paths** — use `@tauri-apps/plugin-dialog` (`open`, `save`); the returned string is already the correct native path.
- **Joining / resolving paths** — use `@tauri-apps/api/path` (`join`, `resolve`, `appDataDir`, etc.).
- **Displaying paths in the UI** — render as-is; do not normalise separators for display.
- **Image `src` attributes** — convert with `convertFileSrc` from `@tauri-apps/api/core` (produces the correct `asset://` / `https://asset.localhost/` URL per platform).
- **Rust side** — use `std::path::PathBuf` and `.join()` throughout; never concatenate strings with `/`.

### UI copy

Avoid macOS-specific terms. Use OS-neutral language:

| ❌ Don't use | ✅ Use instead |
|---|---|
| Show in Finder | Show in folder |
| Reveal in Finder | Reveal in folder |
| Trash | Delete |
| ⌘ shortcuts in copy | avoid in UI labels |

### Shell / file-manager actions

Use `revealItemInDir` from `@tauri-apps/plugin-opener` to reveal files in the system file manager. It calls Explorer on Windows, Finder on macOS, and the default file manager on Linux. Already bundled — no extra dependency needed.

