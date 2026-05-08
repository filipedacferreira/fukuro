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
```

## Database

SQLite at `{AppData}/fukuro.db` (macOS: `~/Library/Application Support/io.fukuro/fukuro.db`).

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
| `rename_project(id, name)` | Update project display name |
| `get_project_chapters(projectId)` | Chapters ordered by `sort_order`; rescans disk for new subdirs and inserts them |
| `reorder_chapters(chapterIds[])` | Bulk update `sort_order` after drag-drop |
| `rename_chapter(id, name)` | Update `display_name` |
| `get_chapter_images(chapterId)` | FS read + natural sort, with `isExcluded` and `thumbnailPath` |
| `toggle_exclusion(chapterId, imagePath)` | Insert/delete from `excluded_images`, returns new state |
| `hard_delete_image(chapterId, path)` | `fs::remove_file` + thumbnail cache cleanup + DB cleanup |
| `generate_chapter_thumbnails_stream(chapterId, onEvent)` | Spawns background thread; generates thumbnails in parallel via rayon and streams `ThumbnailUpdate` events through a Tauri Channel |
| `clear_thumbnail_cache()` | Deletes `{AppData}/thumbnails/` entirely (dev menu action) |
| `create_cbz(projectId, outputPath)` | Zip all non-excluded images in chapter/page order |

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

## Git commits

Format: `feat(context): message` — one line, no description, no co-authoring.

## Development

Requires Rust (via rustup) and Node.js.

```bash
pnpm install
pnpm dev         # hot-reload dev server (tauri dev)
pnpm build       # production build (tauri build)
```

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

## Planned (not built yet)

- Volume grouping (chapters → volumes → project)
