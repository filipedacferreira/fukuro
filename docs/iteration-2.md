# Iteration 2 — Cover Image

**Date:** May 2026
**Status:** Planned

---

## Overview

Each project can have a cover image prepended to the exported CBZ. Sources: manual file upload or automatic fetch from the Anilist manga database by numeric ID. The cover is stored locally in AppData and exported as `0000.jpg` so it sorts first in CBZ readers (chapter pages shift to `0001.jpg+`).

---

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| HTTP client | `reqwest` (blocking) in Rust | Full backend flow — no frontend involvement |
| Anilist UX | ID input only | Simple, scoped; title search is a future enhancement |
| CBZ cover filename | `0000.jpg` | `cover.jpg` sorts after digits alphabetically — readers would show it last |
| Chapter pages offset | Start at `0001.jpg` when cover exists | Preserves sequential numbering |
| Cover removal | Explicit remove action | Full user control |
| DB migration | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` | No migration runner needed; idempotent on every launch |
| Cover storage quality | JPEG quality 100 | Maximum fidelity — covers are the face of the CBZ |
| Cover display | `convertFileSrc(coverPath)` directly | One image per project — no separate thumbnail needed |
| UI — project list | Cover thumbnail leftmost on each card | |
| UI — editor | Compact thumbnail in header; click opens dialog | Minimal header real estate |
| UI — actions | Contained in a modal dialog | Upload / Fetch from Anilist / Remove |

---

## Implementation plan

### Phase 1 — Rust backend

#### `Cargo.toml`
Add:
```toml
reqwest = { version = "0.12", features = ["blocking", "json"] }
```

#### `src-tauri/src/db.rs`
Append inside `execute_batch` after existing `CREATE TABLE` statements:
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cover_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS anilist_id INTEGER;
```

#### `src-tauri/src/commands/cover.rs` — new file

Three commands:

**`set_project_cover(project_id, image_path, state, app_handle) -> Result<String, String>`**
1. Resolve `{app_data}/covers/`, create dir if missing
2. Open source image with `image` crate, re-encode as JPEG quality 100 → `covers/{project_id}.jpg`
3. `UPDATE projects SET cover_path = ? WHERE id = ?`
4. Return stored `cover_path`

**`fetch_anilist_cover(project_id, anilist_id, state, app_handle) -> Result<AnilistResult, String>`**

`AnilistResult`:
```rust
pub struct AnilistResult {
    pub title: String,
    pub cover_path: String,
}
```

Steps:
1. POST `https://graphql.anilist.co` with:
   ```graphql
   query ($id: Int) {
     Media(id: $id, type: MANGA) {
       title { romaji english }
       coverImage { extraLarge }
     }
   }
   ```
2. Parse title (english → romaji fallback) and `coverImage.extraLarge` URL
3. GET the image URL, collect bytes
4. Decode + re-encode as JPEG quality 100 → `covers/{project_id}.jpg`
5. `UPDATE projects SET cover_path = ?, anilist_id = ? WHERE id = ?`
6. Return `{ title, cover_path }`

**`remove_project_cover(project_id, state, app_handle) -> Result<(), String>`**
1. Query current `cover_path`
2. `fs::remove_file` if file exists (ignore not-found)
3. `UPDATE projects SET cover_path = NULL, anilist_id = NULL WHERE id = ?`

#### `src-tauri/src/commands/mod.rs`
Add `pub mod cover;`

#### `src-tauri/src/commands/projects.rs`
- Extend `Project` struct: add `cover_path: Option<String>`, `anilist_id: Option<i64>`
- Update `list_projects` SELECT to include these columns

#### `src-tauri/src/commands/export.rs`
In `create_cbz`, before the chapter loop:
- Query `cover_path` for the project
- If `Some(path)` and file exists: write to ZIP as `0000.jpg`, set `global_index = 1`
- Else: `global_index = 0` (unchanged)

#### `src-tauri/src/lib.rs`
Register in `invoke_handler`:
- `commands::cover::set_project_cover`
- `commands::cover::fetch_anilist_cover`
- `commands::cover::remove_project_cover`

---

### Phase 2 — TypeScript types & API

#### `src/types.ts`
Add to `Project`:
```ts
coverPath: string | null
anilistId: number | null
```

#### `src/lib/tauri.ts`
```ts
setProjectCover(projectId: string, imagePath: string): Promise<string>
fetchAnilistCover(projectId: string, anilistId: number): Promise<{ title: string; coverPath: string }>
removeProjectCover(projectId: string): Promise<void>
```

---

### Phase 3 — Frontend UI

#### Project list card (`src/views/projects/project-list.tsx`)
- Leftmost element: cover thumbnail (~40px wide, 2:3 aspect ratio)
- `convertFileSrc(project.coverPath)` when set; neutral placeholder (grey rect + book icon) when unset
- Clicking thumbnail opens `<CoverDialog>`

#### Editor header (`src/views/editor/editor.tsx`)
- Compact cover thumbnail (~32px tall) between back button and project name
- Placeholder icon when no cover
- Clicking thumbnail opens `<CoverDialog>`

#### `src/components/cover-dialog.tsx` — new shared component
Moved to `src/components/` (not under editor) so it can be opened from both the project list and the editor.

Props: `projectId`, `coverPath`, `onCoverChange(newPath: string | null)`, `open`, `onOpenChange`

Modal containing:
- Cover preview (large) or empty state
- **Upload image** — Tauri file picker (jpg/jpeg/png/webp) → `api.setProjectCover` → `onCoverChange`
- **Fetch from Anilist** — numeric ID input + Fetch button → `api.fetchAnilistCover` → show returned title as confirmation → `onCoverChange`
- **Remove** (only when cover set) — `api.removeProjectCover` → `onCoverChange(null)`
- All actions: loading state + error toast on failure

#### Project list card (`src/views/projects/project-list.tsx`) — cover trigger
- Clicking the cover thumbnail (or placeholder) on a project card opens `<CoverDialog>` for that project
- Each card manages its own `coverPath` state locally; initialised from `project.coverPath`, updated via `onCoverChange`

#### Editor header (`src/views/editor/editor.tsx`) — cover trigger
- Compact cover thumbnail (~32px tall) between back button and project name
- Click → open `<CoverDialog>` for the current project
- `coverPath` state lives in `editor.tsx`; passed to dialog via `onCoverChange`

---

### Phase 4 — Rust Primer

Update `docs/rust-primer.md` with:
- `reqwest::blocking::Client` — sync HTTP inside a Tauri command
- JSON deserialization from external API responses
- Downloading image bytes from a URL and writing to disk

---

## Verification

| Scenario | Expected |
|---|---|
| Upload PNG cover | Appears in editor header + project card; stored as JPEG quality 100 |
| Fetch Anilist cover (valid ID e.g. 30654) | Title shown as confirmation, cover appears |
| Fetch Anilist cover (invalid ID) | Error toast, no state change |
| Remove cover | Placeholder restored in header and card |
| Export with cover | `0000.jpg` is cover, chapter pages start at `0001.jpg` |
| Export without cover | Pages start at `0000.jpg` (unchanged) |
| Launch with existing DB | No crash, old projects have `cover_path = NULL` |

## Critical files

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `reqwest` |
| `src-tauri/src/db.rs` | Add `ALTER TABLE` migrations |
| `src-tauri/src/commands/cover.rs` | New — all three cover commands |
| `src-tauri/src/commands/export.rs` | Prepend cover as `0000.jpg` |
| `src-tauri/src/commands/projects.rs` | Return `cover_path`, `anilist_id` |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/types.ts` | Extend `Project` type |
| `src/lib/tauri.ts` | Add cover API wrappers |
| `src/views/projects/project-list.tsx` | Cover thumbnail on card |
| `src/views/editor/editor.tsx` | Compact cover in header |
| `src/components/cover-dialog.tsx` | New — shared cover dialog (project list + editor) |
