# Roadmap

Sections are ordered by dependency, not just appeal — an item lands in **Now** if nothing else on the roadmap blocks it (or it's itself a prerequisite other tiers need), **Next** if it depends on at least one **Now** item, and **Later** if it's independent but larger in scope with no current urgency.

## Urgent

Bugs or regressions blocking normal use. Always empty unless something is actively broken.

---

## Now

No unresolved dependencies on other roadmap items — several of these are prerequisites the **Next** tier builds on.

### Chapter number parsing

Parse chapter numbers from folder names so `sort_order` and future metadata fields are seeded correctly rather than relying solely on filesystem order. Unlocks the `{chapter}` token in **Output filename templates**.

**Patterns to recognise:** `Ch. 12`, `Chapter_012`, `第12話`, `Vol.2 Ch.5`, bare numeric prefixes (`012 - Title`)

**Approach**

- Run the parser in `create_project` and `get_project_chapters` (new subdir path) to set `sort_order` from the parsed number when present; fall back to the existing natural sort order (`natural_sort_key`)
- Expose parsed number as a `chapter_number REAL` column (nullable, supports decimals like 12.5 for half-chapters)
- Parser only seeds `chapter_number` when the column is currently `NULL` — never overwrites a manually set value
- Show the parsed number as a small badge in the chapter row; user can correct it inline via a new `update_chapter_number(id, number)` command that updates only `chapter_number`, not `display_name`

### Stale path recovery

When a project's `root_path` or a chapter's `folder_path` no longer exists on disk, the app currently fails silently — images don't load, exports produce empty chapters, and the only escape is deleting and re-importing. Establishes the **Relink** pattern that **Root path** reuses for its own missing-root case.

**Approach: detect on load, prompt to re-link**

- On `get_project_chapters`, check whether `root_path` still exists. If not, return a typed error (e.g. `{ kind: "root_missing", last_path }`) instead of proceeding.
- In the UI, show a banner or modal: _"Folder not found at `<path>`. Did you move or rename it?"_ with a **Relink** button that opens a folder picker.
- On relink, update `root_path` in `projects` and patch all child `folder_path`s in `chapters` using the same relative structure (old subfolder name relative to old root → same name relative to new root).
- For individual chapter mismatches (root is fine, but one subfolder was renamed), surface a per-chapter warning on expand and let the user pick the new folder for that chapter alone; handled by a new `relink_chapter(id, newFolderPath)` command that updates only that chapter's `folder_path` in the DB.

**What this covers**

| Scenario | Recovery |
|---|---|
| Root folder renamed/moved | Relink project to new root; all chapters auto-patched |
| One chapter subfolder renamed | Per-chapter relink |
| Entire project moved to a different drive | Relink project |

**What this does not cover**

- Chapters whose subfolder was deleted (not renamed) — already handled outside this feature: the folder watcher (see removed "Watch folder" item) and `get_project_chapters` both remove chapters whose `folder_path` no longer exists automatically, no confirmation prompt
- Real-time watching of the *root* path itself disappearing (covered by the "detect on load" approach above, not by the watcher, since a missing root can't be watched)

### Export history

Track when each project was last exported and to which path, so re-exporting doesn't require going through the file picker again. Unlocks **Batch export** (relies on these columns), **Chapter exclusion** (nulls `last_exported_at` on toggle), and **Kobo sync** (compares `last_exported_at` against `last_synced_at`).

**DB changes**

- Add `last_export_path TEXT` and `last_exported_at TEXT` (ISO timestamp, nullable) to `projects`

**UI**

- Show "Last exported: X days ago" in the project list
- **Re-export** button in the export panel that skips the file picker and overwrites `last_export_path` directly (file existence is guaranteed at this point by load-time validation — confirmation asks "overwrite existing file?" not "does it exist?")

**File existence validation**

The app has no file watcher on `last_export_path` — if the user deletes the exported `.cbz` externally (while the app is open or closed), the DB still holds the stale path. To handle this gracefully:

- When the project list loads, check whether `last_export_path` exists on disk via a cheap `fs::metadata` call for each project that has one
- If the file is gone, treat the project as never exported: grey out or hide the "Last exported" indicator and clear `last_export_path` / `last_exported_at` in the DB
- This same validation must run before Kobo sync attempts a copy — a missing local file should fall back to prompting for a new path rather than erroring silently

### Pre-export summary

Before committing to an export, show a summary of what will be included so the user can catch mistakes. Ships before **Chapter exclusion**, so that feature's summary integration (counting excluded chapters) extends an existing screen rather than waiting on one.

- Triggered by a **Review** step before the file picker — user sees the summary, then proceeds to pick an output path
- Shows: total chapter count, total page count (including the cover as page 1 if set), excluded page count, estimated output file size (sum of source image sizes — close to exact since images are stored uncompressed in the zip)
- Highlights any chapters with zero active images (all pages excluded) as a warning
- User can go back to fix issues or proceed to export

### App auto-update via GitHub Releases

Check GitHub Releases on startup and let the user download and install updates without leaving the app, using Tauri's official updater plugin (`tauri-plugin-updater` + `tauri-plugin-process`). Fully independent of everything else on this roadmap.

**Release pipeline changes**

- Releases continue to be published as **drafts** by the existing `release.yml` workflow — the manual publish step on GitHub stays as the final "is this actually ready" gate; the updater only ever sees published, non-prerelease releases, so nothing auto-publishes
- Generate a signing keypair once via `tauri signer generate`; store the private key and its password as GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); commit only the public key into `tauri.conf.json`
- `tauri-action` (already used in `release.yml`) generates the signed updater manifest (`latest.json`) and artifacts automatically as part of the existing build — no separate signing step to maintain
- Updater endpoint: `https://github.com/filipedacferreira/fukuro/releases/latest/download/latest.json` (resolves only to the latest published, non-prerelease release)
- Single stable channel only — no beta/prerelease opt-in for now

**Check & install flow**

- Checked once, on app startup only — no periodic in-session polling, no manual "Check for updates" menu item
- If the check itself fails (offline, GitHub unreachable, rate-limited): silent no-op, nothing shown to the user, since this is a passive background check the user didn't trigger
- If an update is found: prompt first — _"Update available (vX.Y.Z). Download & install?"_ — before fetching anything, using the existing `Modal`/`Toaster` primitives in `src/components/ui/`
- On accept: download with a progress indicator
- On download complete: prompt **Restart now** (default) vs **Restart later** — never force an immediate relaunch, since the user may be mid-export or mid-chapter-reorder; "Restart later" defers the install to the next time the app is closed and reopened
- Any failure from this point on (download failure, install failure) surfaces as an error, unlike the silent startup check, since the user has now taken an explicit action

### Developer mode

A toggleable developer mode (off by default) that surfaces low-level tooling without cluttering the main UI.

**How to activate**

- Fixed keyboard shortcut (`Ctrl+Shift+D` on Windows) toggles dev mode — independent of the Settings screen, since dev-mode toggling shouldn't require opening a menu each time
- When active, a small "DEV" badge appears in the app header so it's obvious the mode is on
- The header must accommodate multiple badges (DEV + Kobo device indicator) simultaneously

**Actions**

- **Force Thumbnail Regeneration** — deletes the thumbnail cache for the currently open chapter only and re-runs generation; only available (visible/enabled) when the editor is open with a chapter loaded
- **Open App Data Folder** — reveals `{AppData}/io.fukuro/` in the system file manager (covers, thumbnails, and the DB all in one place)
- **Copy DB Path** — copies the absolute path of `fukuro.db` to the clipboard so it can be opened in an external SQLite viewer
- **Reset Database** — drops and recreates all tables; nuclear option for when a schema migration goes wrong during development (requires a confirmation prompt)
- **Reload Current Project** — forces a `get_project_chapters` re-scan without navigating away; handy when iterating on Rust commands
- **Show Raw Paths** — toggles the editor to display raw `folder_path` / `image_path` values instead of display names
- **Export Debug Info** — copies a plain-text dump of project/chapter/image counts and current config to the clipboard, intended for bug reports

### Settings screen

A modal for low-stakes, independently-togglable app preferences — reached from the native **Fukurō** menu (above About), not gated behind Developer Mode. Values persist in the shared `settings` key-value table and apply immediately as each control changes; there's no Save/Cancel step.

**Settings**

- **Default export location** — a folder path used as the starting directory for the export and Kobo-sync save dialogs when a project has no prior `last_export_path`. Validated lazily, at use time only: if the configured folder no longer exists when a picker opens, fall back silently to the OS default rather than blocking Settings or erroring
- **Theme** — System (default) / Light / Dark. "System" preserves today's automatic behavior (`prefers-color-scheme` in `index.css`); Light/Dark apply an explicit override via a `data-theme` attribute on `<html>` that CSS checks before falling back to the media query
- **Thumbnail size** — small / medium / large card density in the image grid. Display-only: adjusts CSS grid sizing, not the underlying 200px cached thumbnail generation size, so it's instant and never invalidates the thumbnail cache
- **Clear Thumbnail Cache** — deletes `{AppData}/thumbnails/` entirely. Moved here from the native Tools menu since it's a normal-use action, not dev tooling. Requires a confirmation step (_"Clear all cached thumbnails? They'll regenerate next time you open each chapter."_) now that it's exposed to regular users rather than buried in a menu only developers dig into

**Explicitly out of scope**

- The library root path — that has its own dedicated "change library" control near the project list (a heavier, disruptive action that rescans/repopulates projects), not a row among lightweight preferences here

---

## Next

Depends on at least one **Now** item; ordered below so each entry's prerequisites appear earlier in the list.

### Chapter exclusion

Let users exclude entire chapters from the CBZ export without deleting them, mirroring the per-image exclusion already in place. Depends on **Export history**'s `last_exported_at` column.

- Add an `is_excluded` column (boolean, default `false`) to the `chapters` table
- Toggle via a button in the chapter row — uses a distinct chapter-level icon (e.g. folder-slash) rather than the same icon as image exclusion, to clearly signal different scope
- `create_cbz` skips excluded chapters entirely; excluded chapters still appear in the editor so the user can re-include them
- The pre-export summary must count excluded chapters alongside excluded images
- Toggling chapter exclusion (either direction) must update `last_exported_at` to null on that project, marking the local file and any Kobo copy as outdated

### Root path

Let users configure a global root path (e.g. `C:\Users\{name}\Manga` on Windows) that the app scans on launch to auto-discover projects. Any subdirectory that matches the expected structure is surfaced as a known project without the user having to open each folder manually. Reuses **Stale path recovery**'s Relink pattern for its own missing-root case.

- A subdirectory qualifies as a project using the same rule as `create_project`: it must contain at least one subdirectory (chapter subfolder)
- Add a `library_root` entry to the shared `settings` key-value table (the same store used by the Settings screen's preferences)
- On launch, scan runs as an async background operation so the UI is not blocked; new projects appear in the list as they are discovered
- Existing records are matched by `root_path` and skipped; new ones are inserted
- Show the configured root path in the project list header with a button to change it
- If the root path itself is missing on launch (moved/deleted), show a banner with a **Relink** button — same recovery pattern as stale project paths
- If no root path is set, fall back to the current manual "Open Folder" flow

### Drag-and-drop folder to open project

Allow users to drag a folder onto the app window to create or open a project, instead of using the folder picker button. Complements **Root path** as an alternative onboarding path — no dependency between the two, both coexist.

- Use Tauri's `drag-drop` event from the `@tauri-apps/plugin-drag-drop` plugin (or the built-in window file drop handler) to receive the dropped path
- Validate that the dropped item is a directory; ignore files
- Only active on the projects screen — drag events while the editor is open are ignored silently
- Run the same flow as the existing "Open Folder" button: call `create_project` (or find an existing project with that `root_path`, triggering a `get_project_chapters` re-scan for new chapters) and navigate to the editor
- Show a drop overlay on the projects screen when a drag enters the window so the target area is obvious

### Volume grouping

Add a volume layer between projects and chapters: chapters → volumes → project. Unlocks the `{volume}` token in **Output filename templates**.

- Add `volumes` table (`id`, `project_id`, `display_name`, `sort_order`) with a nullable `volume_id FK` on `chapters`
- Chapters with `volume_id = NULL` in a project that has volumes are shown under an implicit **Ungrouped** section in the editor, so mixed projects remain navigable
- `create_cbz` is extended to accept an optional volume ID: if provided, only that volume's chapters are exported; if omitted, all chapters (across all volumes and ungrouped) are exported — both modes coexist
- The export UI gains a volume selector when the project has volumes, with a "Whole project" option as the default
- Add a volume grouping layer above the chapter list in the editor UI

The DB schema is already relational enough to support this without migration pain.

### Output filename templates

Let users define a naming template for the exported file instead of always using the file picker's current name. Depends on **Chapter number parsing** (`chapter_number` column) and **Volume grouping** (`display_name` on `volumes`).

**Template tokens:** `{series}`, `{volume}`, `{chapter}`, `{year}`

- `{chapter}` resolves from the `chapter_number` column set by chapter number parsing; omitted silently if `chapter_number` is null
- `{volume}` resolves from the volume's `display_name` on the `volumes` table; a project with no volume grouping enabled has no value for this token
- `{year}` is the year the export is produced (export year, not publication year)
- If a template uses a token with no value (e.g. `{volume}` but no volume is assigned, or volume grouping isn't enabled for the project), export is blocked and the user is shown which tokens are unresolved before proceeding
- No default template for new projects — file picker name is used as-is until the user configures one

**Example:** `{series} - Vol.{volume}` → `Berserk - Vol.03.cbz`

- Template configured per-project, stored as a `filename_template TEXT` column on `projects`
- Resolved at export time; file picker pre-fills the suggested name, user can still override

### Batch export

Export multiple projects to a target folder in one operation, without going through the file picker for each one. Depends on **Export history** (`last_export_path`/`last_exported_at`); resolves **Output filename templates** per project when one is set.

- Add a multi-select mode to the project list (checkbox per row, "Select all" toggle)
- A "Export selected" action opens a single folder picker; each project is exported as `{project_name}.cbz` into that folder (resolving the output filename template per project if one is set)
- Progress is shown inline per project (idle → exporting → done / failed)
- Each project's `last_export_path` and `last_exported_at` are updated immediately on its individual success, regardless of whether other projects in the batch fail
- Projects that fail mid-batch surface an error without aborting the rest

### Kobo sync

Send exported `.cbz` files directly to a Kobo device connected via USB and keep them up to date as projects grow. Depends on **Export history** (`last_exported_at`/`last_synced_at` comparison) and resolves **Output filename templates** for the destination filename when one is set.

**Device detection (Windows-first)**

On Windows, enumerate all drive letters (`A:\` – `Z:\`) and check each root for the `.kobo/` marker directory — the reliable cross-model signal that the drive is a Kobo. macOS detection scans `/Volumes/` for the same marker. Detection runs on a short poll interval (e.g. every 3 s) so the UI reacts without requiring an app restart.

**Global device indicator**

- A small badge in the app header (similar to the Developer Mode DEV badge) appears when a Kobo is detected — e.g. a device icon with the drive label
- The badge disappears immediately when the device is unplugged
- Clicking the badge opens a Kobo panel / popover showing device name, free space, and a **Sync all** button

**Per-project status markers (project list)**

Each project row gets a Kobo status icon that reflects the sync state:

| State | Marker |
|---|---|
| Not on device | no icon |
| On device, up to date | green device / checkmark icon |
| On device, outdated | amber warning icon (new chapters added since last sync) |
| Syncing | spinner |

"Outdated" is determined by comparing `last_exported_at` against `last_synced_at` — both tracked as nullable ISO timestamps on `projects`. See the sync section below for details.

**Two export scenarios — export and sync are separate concerns**

The core **Export CBZ** button always stays and is available regardless of whether a Kobo is connected. Sync is a follow-up step, not a replacement:

1. **Export** — runs `create_cbz`, saves the `.cbz` to a user-picked local path, updates `last_export_path` and `last_exported_at` on the project (owned by the export history feature)
2. **Sync to Kobo** — ensures the device copy is current; the local `.cbz` is always written first, then copied to the device. The sync button resolves the export step as follows:
   - If `last_export_path` exists on disk: skip re-export, copy the existing file directly to the device
   - If `last_export_path` is set but the file is gone (stale path): re-export silently to the same path, then copy
   - If no prior export path exists: prompt the user for a save location, export, then copy
   - The user never needs to manually export before syncing; the two-step flow is an implementation detail

The `.cbz` always lives locally first — the device receives a copy. These two timestamps serve different purposes and must not be conflated:

| Column | Set by | Meaning |
|---|---|---|
| `last_exported_at` | Export | When the local file was last written |
| `last_synced_at` | Kobo sync | When the device copy was last updated |

A project is considered outdated on the device when `last_exported_at > last_synced_at`. Null values are handled as follows: if `last_synced_at` is null and `last_exported_at` is set, treat as outdated; if both are null, treat as "not on device" (no icon shown).

**Sync actions**

- **Per-project sync button** — appears in the project row (or its hover state) when a Kobo is connected; copies the local `.cbz` to the device (running export first if needed); updates `last_synced_at` on success
- **Sync all** — in the Kobo panel header; at the start of the run, scans `{kobo_root}\Digital Reads\` to build a set of existing filenames, then iterates all projects where `last_exported_at > last_synced_at` (applying null rules above) or whose expected `{project_name}.cbz` is absent from that set; runs in sequence with per-project progress inline (same pattern as batch export)
- Destination filename resolves the output filename template if one is set, falling back to `{project_name}.cbz` — local and device filenames must always match so the Sync all file existence check stays reliable
- Destination path is `{kobo_root}\Digital Reads\{resolved_name}.cbz` (`PathBuf::join` on the Rust side — never string-concatenate; note: verify that `Digital Reads` is the correct sideload path across Kobo firmware versions before implementation)
- Errors (device disconnected mid-sync, insufficient space) surface per-project without aborting the rest of the queue

**UI copy**

Use device-neutral language throughout: **Send to device**, **Sync**, **Up to date**, **Outdated** — never Finder/Explorer-specific terms.

---

## Later

Independent of everything above, but larger in scope with no current urgency.

### Import from CBZ

Open an existing `.cbz` file to re-edit its contents — reorder pages, exclude images, then re-export.

- File picker accepts `.cbz` / `.zip`; contents are extracted to a temp directory in `{AppData}/imports/{id}/`
- Archive structure is auto-detected before extraction: if the archive contains a single root folder wrapping everything, that folder is unwrapped and its contents are treated as the project root; otherwise the archive root is used directly
- A new project record is created with `root_path` pointing to the temp dir; chapters are derived from top-level folders inside the archive (or a single flat chapter if no subfolders exist after unwrapping)
- The editor opens as normal; on export the temp dir is not cleaned up automatically so re-exports are fast
- **Cleanup policy:** temp dir is deleted automatically when the imported project is deleted; a manual **Remove imported files** bulk action (alongside Clear Thumbnail Cache) purges any leftover temp dirs

### Duplicate image detection

Flag identical or near-identical images within a chapter — common with scraped sources that include repeated splash pages, volume covers, or watermarks inserted between pages.

**Approach**

- Runs automatically as a background operation when a chapter is opened (same pattern as thumbnail generation) — chapter opens immediately, duplicate badges appear as results stream in
- A manual **Re-run** button in the chapter row lets the user force a fresh scan at any time
- Hash-based exact duplicates: SHA-256 of raw bytes, O(n) per chapter
- Near-duplicates: perceptual hash (e.g. `image_hasher` crate, dHash) with a configurable Hamming distance threshold — verify Windows compatibility before adopting this dependency
- Results surfaced in the image grid as a warning badge; user can review and bulk-exclude

**Commands**

- `detect_duplicates(chapterId)` — streams groups of `{ images[], similarity }` via a Tauri Channel (same pattern as thumbnail generation)
