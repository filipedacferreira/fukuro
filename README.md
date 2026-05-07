# fukuro

A desktop utility for batching manga chapters into `.cbz` files.

Manga chapters arrive as folders of numbered images with inconsistent names and unwanted extra pages. fukuro lets you reorder chapters by drag-and-drop, rename them, mark images for exclusion, and export everything as a single `.cbz` in one click — with page order preserved.

---

## Features

- **Open a manga folder** — scans all subfolders as chapters, counts images per chapter
- **Reorder chapters** — drag-and-drop to set the final reading order
- **Rename chapters** — click any chapter name to rename inline
- **Cull images** — expand a chapter to see all pages as thumbnails; click to soft-exclude or trash to hard-delete from disk
- **Export CBZ** — packs all non-excluded images into a single `.cbz` with zero-padded sequential filenames
- **Persistent state** — all ordering, renames, and exclusions are saved locally; work survives app restarts

## Stack

- [Tauri v2](https://tauri.app) — app shell and Rust backend
- [React 19](https://react.dev) + TypeScript + Vite — frontend
- [Tailwind CSS v4](https://tailwindcss.com) — styling
- [Significa Foundations](https://foundations.significa.co) — component library
- SQLite (`rusqlite`) — local persistence
- `zip` crate — CBZ creation
- `@dnd-kit` — drag-and-drop reordering

## Development

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Rust](https://www.rust-lang.org/learn/get-started) (via rustup)

### Setup

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

Produces a native binary for the current platform. For a Windows `.exe` / `.msi` build from macOS, use a Windows CI runner.

## Testing CBZ output

- **macOS** — [Yacreader](https://www.yacreader.com) (`brew install --cask yacreader`)
- **Windows** — [CDisplayEx](https://www.cdisplayex.com)

## License

[GPL-3.0](LICENSE)
