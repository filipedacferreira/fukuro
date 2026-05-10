# Roadmap

## Now

### Cover image

Each project can have a cover image that is included as the first file in the exported `.cbz` (before any chapter pages).

**Sources**

- **Manual upload** — user picks any image file; stored in `{AppData}/covers/{project_id}.jpg` (re-encoded to JPEG for consistency)
- **Anilist** — user provides an Anilist manga ID; the app fetches the cover URL from the Anilist GraphQL API (`https://graphql.anilist.co`) and downloads it automatically

**DB changes**

- Add `cover_path TEXT` (nullable) and `anilist_id INTEGER` (nullable) columns to `projects`

**Rust commands**

- `set_project_cover(projectId, imagePath)` — copy + re-encode image to `covers/` dir, update `cover_path`
- `fetch_anilist_cover(projectId, anilistId)` — call Anilist GraphQL, download cover, store same as above, persist `anilist_id`
- `create_cbz` — if `cover_path` is set and the file exists, insert it as `cover.jpg` at position 0 before the chapter pages

**UI**

- Cover thumbnail in the editor header (placeholder when unset)
- Two actions: _Upload image_ and _Fetch from Anilist_ (text input for the ID)
- Show the Anilist title as confirmation after a successful fetch so the user can verify the right entry was matched

### Chapter number parsing

Parse chapter numbers from folder names so `sort_order` and future metadata fields are seeded correctly rather than relying solely on filesystem order.

**Patterns to recognise:** `Ch. 12`, `Chapter_012`, `第12話`, `Vol.2 Ch.5`, bare numeric prefixes (`012 - Title`)

**Approach**

- Run the parser in `create_project` and `get_project_chapters` (new subdir path) to set `sort_order` from the parsed number when present; fall back to directory enumeration order
- Expose parsed number as a `chapter_number REAL` column (nullable, supports decimals like 12.5 for half-chapters)
- Show the parsed number as a small badge in the chapter row; user can correct it inline

### Pre-export summary

Before committing to an export, show a summary of what will be included so the user can catch mistakes.

- Triggered by a "Review" step before the file picker (or as an expandable panel in the export UI)
- Shows: total chapter count, total page count, excluded page count, estimated output file size (sum of source image sizes as a lower bound)
- Highlights any chapters with zero active images (all pages excluded) as a warning
- User can go back to fix issues or proceed to export

### Stale path recovery

When a project's `root_path` or a chapter's `folder_path` no longer exists on disk, the app currently fails silently — images don't load, exports produce empty chapters, and the only escape is deleting and re-importing.

**Approach: detect on load, prompt to re-link**

- On `get_project_chapters`, check whether `root_path` still exists. If not, return a typed error (e.g. `{ kind: "root_missing", last_path }`) instead of proceeding.
- In the UI, show a banner or modal: _"Folder not found at `<path>`. Did you move or rename it?"_ with a **Relink** button that opens a folder picker.
- On relink, update `root_path` in `projects` and patch all child `folder_path`s in `chapters` using the same relative structure (old subfolder name relative to old root → same name relative to new root).
- For individual chapter mismatches (root is fine, but one subfolder was renamed), surface a per-chapter warning on expand and let the user pick the new folder for that chapter alone.

**What this covers**

| Scenario | Recovery |
|---|---|
| Root folder renamed/moved | Relink project to new root; all chapters auto-patched |
| One chapter subfolder renamed | Per-chapter relink |
| Entire project moved to a different drive | Relink project |

**What this does not cover**

- Real-time file watching (not needed — recovery on next open is sufficient)
- Chapters whose subfolder was deleted (not renamed) — those should be flagged as missing and offer a remove option

### Developer mode

A toggleable developer mode (off by default) that surfaces low-level tooling without cluttering the main UI. Replaces the current **Tools → Clear Thumbnail Cache** menu item — all dev actions live here instead.

**How to activate**

- Hidden toggle in a future Settings screen (or a keyboard shortcut / secret click target in the meantime)
- When active, a small "DEV" badge appears in the app header so it's obvious the mode is on

**Actions**

- **Clear Thumbnail Cache** — deletes `{AppData}/thumbnails/` entirely (moved from the Tools menu)
- **Force Thumbnail Regeneration** — deletes the thumbnail cache for the currently open chapter only and re-runs generation; useful when tweaking the thumbnail pipeline without wiping everything
- **Open App Data Folder** — reveals `{AppData}/io.fukuro/` in the system file manager (covers, thumbnails, and the DB all in one place)
- **Copy DB Path** — copies the absolute path of `fukuro.db` to the clipboard so it can be opened in an external SQLite viewer
- **Reset Database** — drops and recreates all tables; nuclear option for when a schema migration goes wrong during development (requires a confirmation prompt)
- **Reload Current Project** — forces a `get_project_chapters` re-scan without navigating away; handy when iterating on Rust commands
- **Show Raw Paths** — toggles the editor to display raw `folder_path` / `image_path` values instead of display names
- **Export Debug Info** — copies a plain-text dump of project/chapter/image counts and current config to the clipboard, intended for bug reports

---

### Export history

Track when each project was last exported and to which path, so re-exporting doesn't require going through the file picker again.

**DB changes**

- Add `last_export_path TEXT` and `last_exported_at TEXT` (ISO timestamp, nullable) to `projects`

**UI**

- Show "Last exported: X days ago" in the project list
- **Re-export** button in the export panel that skips the file picker and writes to `last_export_path` directly (with a confirmation if the file already exists)

---

## Next

### Chapter exclusion

Let users exclude entire chapters from the CBZ export without deleting them, mirroring the per-image exclusion already in place.

- Add an `is_excluded` column (boolean, default `false`) to the `chapters` table
- Toggle via a button in the chapter row (same visual pattern as the image exclusion toggle)
- `create_cbz` skips excluded chapters entirely; excluded chapters still appear in the editor so the user can re-include them
- The pre-export summary (when built) should count excluded chapters alongside excluded images

### Batch export

Export multiple projects to a target folder in one operation, without going through the file picker for each one.

- Add a multi-select mode to the project list (checkbox per row, "Select all" toggle)
- A "Export selected" action opens a single folder picker; each project is exported as `{project_name}.cbz` into that folder
- Progress is shown inline per project (idle → exporting → done / failed)
- Projects that fail mid-batch surface an error without aborting the rest

### Drag-and-drop folder to open project

Allow users to drag a folder from Finder onto the app window to create or open a project, instead of using the folder picker button.

- Use Tauri's `drag-drop` event from the `@tauri-apps/plugin-drag-drop` plugin (or the built-in window file drop handler) to receive the dropped path
- Validate that the dropped item is a directory; ignore files
- Run the same flow as the existing "Open Folder" button: call `create_project` (or find an existing project with that `root_path`) and navigate to the editor
- Show a drop overlay on the projects screen when a drag enters the window so the target area is obvious

### Root path

Let users configure a global root path (e.g. `~/Manga`) that the app scans on launch to auto-discover projects. Any subdirectory that matches the expected structure (contains chapter subfolders) is surfaced as a known project without the user having to open each folder manually.

- Add a `root_path TEXT` setting (persisted in a `settings` table or a flat config file in `{AppData}`)
- On launch, scan the root path for eligible subdirectories and upsert them into `projects` — existing records are matched by `root_path` and skipped, new ones are inserted
- Show the configured root path in the project list header with a button to change it
- If no root path is set, fall back to the current manual "Open Folder" flow

### Output filename templates

Let users define a naming template for the exported file instead of always using the file picker's current name.

**Template tokens:** `{series}`, `{volume}`, `{chapter}`, `{year}`

**Example:** `{series} - Vol.{volume}` → `Berserk - Vol.03.cbz`

- Template configured per-project, stored as a `filename_template TEXT` column on `projects`
- Resolved at export time; file picker pre-fills the suggested name, user can still override

---

## Later

### Volume grouping

Add a volume layer between projects and chapters: chapters → volumes → project.

- Add `volumes` table (`id`, `project_id`, `display_name`, `sort_order`) with a nullable `volume_id FK` on `chapters`
- Update `create_cbz` to accept a volume ID and filter chapters accordingly
- Add a volume grouping layer above the chapter list in the editor UI

The DB schema is already relational enough to support this without migration pain.

### Import from CBZ

Open an existing `.cbz` file to re-edit its contents — reorder pages, exclude images, then re-export.

- File picker accepts `.cbz` / `.zip`; contents are extracted to a temp directory in `{AppData}/imports/{id}/`
- A new project record is created with `root_path` pointing to the temp dir; chapters are derived from top-level folders inside the archive (or a single flat chapter if no subfolders exist)
- The editor opens as normal; on export the temp dir is not cleaned up automatically so re-exports are fast
- Add a "Remove imported files" action (alongside Clear Thumbnail Cache) to purge temp dirs

### Watch folder

While the editor is open, detect new subfolders added to the project's `root_path` and insert them as chapters automatically.

**Approach**

- Use the [`notify`](https://crates.io/crates/notify) crate to set up a recursive watcher on `root_path` when `get_project_chapters` is first called
- On a `Create(Dir)` event, run the same new-subdir insertion logic already used in `get_project_chapters`
- Emit a Tauri event to the frontend (`chapters-updated`) so the chapter list refreshes without a manual reload
- Watcher is torn down when the project is closed or the window loses focus

### Duplicate image detection

Flag identical or near-identical images within a chapter — common with scraped sources that include repeated splash pages, volume covers, or watermarks inserted between pages.

**Approach**

- Hash-based exact duplicates: SHA-256 of raw bytes, O(n) per chapter, done at scan time
- Near-duplicates: perceptual hash (e.g. `image_hasher` crate, dHash) with a configurable Hamming distance threshold
- Results surfaced in the image grid as a warning badge; user can review and bulk-exclude

**Commands**

- `detect_duplicates(chapterId)` — returns groups of `{ images[], similarity }` for review

### Settings screen

No settings exist yet. Candidates:
- Default export location
- Theme override
- Thumbnail size in the grid
