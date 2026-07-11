# Fukurō

A desktop utility for batching manga chapters into `.cbz` files.

Manga chapters arrive as folders of numbered images with inconsistent names and unwanted extra pages. Fukurō watches a library folder, treats each manga subfolder as a project, sorts its chapters automatically, lets you cull unwanted pages, and exports everything as a single `.cbz` in one click — with page order preserved. It can also copy finished `.cbz` files straight onto a connected Kobo eReader and keep them up to date.

---

## Features

- **Watch a library folder** — point Fukurō at one root; every immediate subfolder becomes a project, and new/removed manga and chapters are picked up live as the folder changes on disk
- **Automatic chapter ordering** — chapters are natural-sorted by folder name (1, 2, 10 — not 1, 10, 2) and labelled "Chapter N" when a number can be parsed; no manual reordering needed
- **Rename projects** — click a project name to rename it inline (folders on disk are untouched)
- **Cull images** — expand a chapter to see all pages as thumbnails; click to soft-exclude or trash to hard-delete from disk
- **Cover image** — covers are looked up automatically from Anilist as soon as a manga folder is discovered; fix a wrong or missing match anytime via manual upload or an Anilist title search, or re-run the lookup in bulk for projects still missing one. Cover is prepended to the exported CBZ
- **Export CBZ** — packs all non-excluded images into a single `.cbz` with zero-padded sequential filenames; progress bar shown during export
- **Kobo sync** — when a Kobo is connected it's detected automatically; send a single project or sync every outdated/missing project onto the device from a dedicated sync drawer, with per-project status and progress
- **Persistent state** — the library root, renames, exclusions, covers, and sync history are all saved locally; work survives app restarts

## How it works

1. **Point Fukurō at a library folder.** Each immediate subfolder is treated as a manga project; each subfolder inside those is a chapter. New and removed folders are picked up live while the app runs.
2. **Let covers fill in.** As soon as a project is discovered, its folder name is matched against Anilist and a cover is applied automatically when the match is confident. Wrong or missing matches can be fixed manually anytime.
3. **Cull pages.** Expand a chapter to review every page as a thumbnail. Soft-exclude pages you don't want in the export (reversible), or hard-delete them from disk.
4. **Export or sync.** Click **Export CBZ** to write a `.cbz` anywhere, or **Send to device** to copy it onto a connected Kobo — the sync drawer tracks which projects are up to date, outdated, or not yet sent.

### CBZ output format

Pages are written with zero-padded sequential names in reading order, regardless of their original filenames, so every reader displays them correctly. When a cover is set it becomes page `0000.jpg` and chapter pages follow:

```
0000.jpg  ← cover
0001.jpg  ← chapter 1, page 1
0002.jpg
...
0087.jpg  ← chapter 2, page 1
```

## Stack

- [Tauri v2](https://tauri.app) — app shell and Rust backend
- [React 19](https://react.dev) + TypeScript + Vite — frontend
- [Tailwind CSS v4](https://tailwindcss.com) — styling
- [Significa Foundations](https://foundations.significa.co) — component library
- SQLite (`rusqlite`) — local persistence
- `zip` crate — CBZ creation
- `reqwest` — Anilist cover lookups
- `image` + `fast_image_resize` + `rayon` — thumbnail decoding and parallel resize
- `windows` crate — Kobo device detection (Win32 volume APIs)

## Development

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io) 10+
- [Rust](https://www.rust-lang.org/learn/get-started) (via rustup)

### Setup

```bash
pnpm install
pnpm dev
```

### Build

```bash
pnpm build
```

Produces a Windows `.exe` / `.msi`. **Windows is the only supported platform** — the app is developed, built, and run exclusively on Windows; release builds are produced in CI. There is no macOS/Linux support.

## Testing CBZ output

- [CDisplayEx](https://www.cdisplayex.com) — Windows CBZ reader

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture overview: project structure, database schema, Rust commands, and how each subsystem (covers, thumbnails, Kobo sync) fits together
- [`docs/rust-primer.md`](docs/rust-primer.md) — a living reference explaining every non-obvious Rust/Tauri pattern used in the backend, tied to real code in the project
- [`docs/roadmap.md`](docs/roadmap.md) — planned features, ordered by dependency

## License

[GPL-3.0](LICENSE)
