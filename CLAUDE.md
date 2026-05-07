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

## Project structure

```
src/
  App.tsx                         # Top-level view router (projects ↔ editor)
  types.ts                        # Shared TS types (Project, Chapter, ImageMeta)
  index.css                       # Tailwind v4 + Foundations CSS tokens
  lib/
    tauri.ts                      # Typed invoke() wrappers for all Rust commands
    utils/classnames.ts           # CVA + tailwind-merge setup (cn, cva)
  components/
    ProjectList.tsx               # Home screen: recent projects, open folder
    Editor.tsx                    # Main workspace: chapter list + export panel
    ChapterList.tsx               # DnD context + sortable list
    ChapterItem.tsx               # Single chapter row: drag, rename, expand
    ImageGrid.tsx                 # Thumbnail grid with exclusion toggle
    ExportPanel.tsx               # Save dialog + export button
  foundations/                    # Significa Foundations components (copied, not installed)
    components/slot/
    hooks/use-element-transition/
    hooks/use-top-layer/
    utils/compose-refs/
    utils/dom/
    ui/button/ input/ dialog/ modal/ spinner/ skeleton/ divider/ toaster/

src-tauri/src/
  lib.rs                          # Tauri builder: plugin init, DB setup, command registry
  db.rs                           # DbState type + SQLite schema migration
  commands/
    mod.rs
    projects.rs                   # create_project, list_projects, delete_project, get_project_chapters
    chapters.rs                   # reorder_chapters, rename_chapter
    images.rs                     # get_chapter_images, toggle_exclusion, hard_delete_image
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
| `get_project_chapters(projectId)` | Chapters ordered by `sort_order`, includes `excluded_count` |
| `reorder_chapters(chapterIds[])` | Bulk update `sort_order` after drag-drop |
| `rename_chapter(id, name)` | Update `display_name` |
| `get_chapter_images(chapterId)` | FS read + natural sort, with `isExcluded` flag |
| `toggle_exclusion(chapterId, imagePath)` | Insert/delete from `excluded_images`, returns new state |
| `hard_delete_image(chapterId, path)` | `fs::remove_file` + DB cleanup |
| `create_cbz(projectId, outputPath)` | Zip all non-excluded images in chapter/page order |

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
- Windows CI build via GitHub Actions
