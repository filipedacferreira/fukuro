# fukuro

Desktop utility for batching manga chapters into `.cbz` files. Built with Tauri v2 (Rust backend) + React + TypeScript + Tailwind CSS v4.

## Stack

| Layer | Choice |
|---|---|
| App shell | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Components | Significa Foundations (copied into `src/components/ui/`) |
| Scroll layout animation | motion/react (`layoutScroll`) |
| Local DB | SQLite via `rusqlite` (bundled) |
| Zipping | `zip` crate |
| HTTP client | `reqwest` (async + json features) |
| Image decoding | `image` crate (jpeg, png, gif, webp) |
| Thumbnail resize | `fast_image_resize` (SIMD-accelerated, bilinear) |
| Parallel processing | `rayon` |
| Cover metadata source | [Anilist](https://anilist.co) GraphQL API (public, no key) |
| Title similarity | `strsim` (Jaro-Winkler) |
| Title cleanup | `regex` |
| Kobo device info | `windows` crate (raw Win32: `GetVolumeInformationW`, `GetDiskFreeSpaceExW`) |
| Auto-update | `tauri-plugin-updater` + `tauri-plugin-process`, signed GitHub Releases as the update source |

## Project structure

```
src/
  app.tsx                         # Top-level view router (projects ↔ editor); holds View union state
  main.tsx                        # React entry point
  types.ts                        # Shared TS types (Project, CoverInfo, AnilistCandidate, BackfillEvent, Chapter, ImageMeta, ThumbnailUpdate, ExportEvent, KoboDevice, SyncEvent, SyncAllEvent)
  index.css                       # Tailwind v4 + Foundations CSS tokens
  lib/
    tauri.ts                      # Typed invoke() wrappers for all Rust commands
    validation.ts                 # Shared zod schemas (renameSchema / RenameValues)
    kobo.ts                       # getKoboSyncStatus, isKoboPending, formatBytes, formatRelativeTime
    utils/classnames.ts           # CVA + tailwind-merge setup (cn, cva)
  hooks/
    use-kobo-device.ts             # Tracks the connected Kobo device: get_kobo_device seed + kobo-device-changed listener
    use-kobo-sync.ts               # Drives one project's "Send to device" flow; shared by ProjectRow's menu item and ExportPanel
    use-app-update.ts              # Startup GitHub-Releases update check + download/install state machine (see Auto-update below)
    use-element-transition.ts     # Foundations hook (copied from foundations.significa.co)
    use-top-layer.ts              # Foundations hook (copied from foundations.significa.co)
  views/
    projects/                     # Projects list view
      project-list.tsx            # Home screen: library-root onboarding, live project list, ChangeLibraryDialog
      components/
        project-row.tsx            # Project card + ProjectRenameDialog + ProjectDeleteDialog; "Send to device" lives in its dropdown menu
        kobo-sync-drawer.tsx       # Header pill (device + pending count) opening a Drawer: per-project sync status/progress list + Sync all
        kobo-sync-row.tsx          # One project's row inside the drawer: status pill, last-synced subline, per-row send/retry (own useKoboSync)
    editor/                       # Editor view
      editor.tsx                  # Main workspace: chapter list + export panel
      components/
        chapter-list.tsx          # Renders the auto-sorted chapter list (empty-state fallback)
        chapter-item.tsx          # Disclosure wrapper + scroll-into-view on expand; composes ChapterRow + ImageGrid
        chapter-row.tsx           # Chapter header row: derived "Chapter N" label + folder name, image/excluded count, hover-reveal delete-chapter button + confirm Dialog
        image-grid.tsx            # Thumbnail grid with exclusion toggle + streaming optimiser
        image-card.tsx            # Single image card with exclude toggle + delete dialog
        export-panel.tsx          # Save dialog + Export CBZ button + Send to device button
  components/
    ui/                           # Significa Foundations UI (copied, not installed)
      slot.tsx button.tsx dialog.tsx disclosure.tsx divider.tsx drawer.tsx menu.tsx popover.tsx
      field.tsx input.tsx modal.tsx progress.tsx skeleton.tsx spinner.tsx toaster.tsx tooltip.tsx
    cover-dialog.tsx              # Shared cover dialog; accepts projectId + cover: CoverInfo + onCoverChange: (CoverInfo) => void
    cover-thumbnail.tsx           # Shared cover button (sm/lg sizes); used in editor header + project cards
    app-update-dialog.tsx         # Fully-controlled dialog driven by useAppUpdate's state machine; mounted once in app.tsx
  utils/                          # Foundations utils (copied from foundations.significa.co)
    compose-refs.ts
    next-frame.ts

src-tauri/src/
  lib.rs                          # Tauri builder: plugin init, DB setup, command registry, native menu
  db.rs                           # DbState type + SQLite schema migration
  utils.rs                        # Shared helpers: normalize_path, now_unix, is_image_file, natural_sort_key, extract_chapter_number
  commands/
    mod.rs
    settings.rs                   # get_library_root, set_library_root; read_library_root helper
    projects.rs                   # list_projects, delete_project, rename_project, get_project_chapters, insert/remove_new_*_projects/chapters, recompute_sort_order, cleanup_project_assets, clear_stale_export_paths
    images.rs                     # get_chapter_images, toggle_exclusion, hard_delete_image, invalidate_export
    thumbnails.rs                 # generate_chapter_thumbnails_stream, clear_thumbnail_cache, ensure_thumbnail
    export.rs                     # create_cbz; collect_cbz_source/write_cbz_archive (shared with kobo.rs's sync)
    cover.rs                      # set_project_cover, search/apply_anilist_cover, auto_fill_missing_covers, remove_project_cover, CoverLookupSemaphore
    watch.rs                      # start_library_watcher (plain fn, not a command) + WatcherState
    kobo.rs                       # get_kobo_device, sync_project_to_kobo, sync_all_to_kobo, start_kobo_watcher (plain fn) + KoboDeviceState
```

## Database

SQLite at `{AppData}/fukuro.db`.

```sql
settings       (key, value)  -- key-value store; currently one row, key='library_root'
projects       (id, root_path, name, created_at, cover_path, cover_thumbnail_path, anilist_id, cover_title,
                 last_export_path, last_exported_at, last_kobo_export_at, last_synced_at)
chapters       (id, project_id→projects, folder_path, display_name, sort_order, image_count)
excluded_images(chapter_id→chapters, image_path)  -- soft-delete exclusions
```

`cover_path`, `cover_thumbnail_path`, `anilist_id`, and `cover_title` are nullable — added via `ALTER TABLE` migrations in `db.rs` (guarded by `pragma_table_info` since SQLite has no `ADD COLUMN IF NOT EXISTS`). `anilist_id` briefly became `mangaupdates_id` (renamed via `ALTER TABLE ... RENAME COLUMN`) when the cover source was switched to MangaUpdates, then renamed back once that switch turned out to serve much lower-resolution cover images than Anilist; both renames cleared the column's existing values, since neither provider's ID space corresponds to the other's.

`last_export_path`/`last_exported_at` (Export history, the user's own "Export CBZ" file) and `last_kobo_export_at`/`last_synced_at` (Kobo sync's independent AppData cache) are all nullable INTEGER/TEXT columns added the same way — Unix epoch seconds rather than an ISO string, since nothing else in this codebase needs a date/time crate. See **Kobo sync** below for why the two pairs are deliberately unrelated.

The `settings` table's presence also gates a one-time fresh-reset migration: databases from before the single-library-root rearchitecture (no `settings` table) have their `projects`/`chapters`/`excluded_images` tables dropped on next launch rather than migrated in place, since old projects each had an independently-picked `root_path` that the new "one watched root, auto-scanned" model can't reconcile. Everything is rebuilt from disk once the user (re-)configures a library root.

Foreign keys with `ON DELETE CASCADE`. WAL mode enabled.

## Rust commands

All commands return `Result<T, String>`. Errors surface as toast notifications in the UI.

| Command | Description |
|---|---|
| `get_library_root()` | Returns the configured library root path, or `null` if none is set yet |
| `set_library_root(rootPath)` | Wipes all existing projects (and their cached covers/thumbnails), points the app at `rootPath`, scans its immediate subfolders as projects (each with its own chapters), restarts the library watcher, and returns the fresh project list |
| `list_projects()` | Rescans the library root (new manga subfolders inserted, missing ones removed) **and every project's chapters** (new chapter folders inserted, missing ones removed — so a chapter downloaded while the app was closed is noticed on reopen), invalidating the Kobo/export caches of any project whose chapter set changed; returns projects ordered by `created_at DESC`, or `[]` if no library root is configured. Also clears `last_export_path`/`last_exported_at` for any project whose exported file has been deleted externally (`clear_stale_export_paths`) |
| `delete_project(id)` | **Permanently deletes the manga's folder from disk** (`fs::remove_dir_all`), then cascade-deletes its DB row (chapters + exclusions) and cleans up its cached cover/thumbnails. If the folder can't be removed (e.g. a file inside is open elsewhere), the error is returned and the DB row is left untouched |
| `rename_project(id, name)` | Update project display name (does not rename the folder on disk) |
| `delete_chapter(chapterId)` | **Permanently deletes the chapter's folder from disk** (`fs::remove_dir_all`), then its cached thumbnail dir and DB row (cascade-deletes its exclusions), and calls `invalidate_export` since removing a chapter changes CBZ contents. Disk-first like `delete_project`: if the folder can't be removed, the error is returned and the DB row is left untouched. No `recompute_sort_order` needed — `get_project_chapters` re-derives `sort_order` on every read |
| `get_project_chapters(projectId)` | Chapters ordered by `sort_order`; rescans disk for new subdirs and inserts them, deletes chapters whose folder no longer exists, and re-derives every `sort_order` from the folder name via `recompute_sort_order` (natural sort) so the list always reads in order. Also re-derives every chapter's `image_count` from disk via `recompute_image_counts`, unconditionally (not just when chapters are added/removed) — a chapter's own folder can still gain or lose pages after it was first discovered (e.g. a downloader that creates the folder before finishing writing pages into it), which would otherwise leave `image_count` stuck at a stale value. `chapterNumber` is derived from the folder name at read time (`extract_chapter_number`), not stored |
| `get_chapter_images(chapterId)` | FS read + natural sort, with `isExcluded` and `thumbnailPath` |
| `toggle_exclusion(chapterId, imagePath)` | Insert/delete from `excluded_images`, returns new state |
| `hard_delete_image(chapterId, path)` | `fs::remove_file` + thumbnail cache cleanup + DB cleanup |
| `generate_chapter_thumbnails_stream(chapterId, onEvent)` | Spawns background thread; generates thumbnails in parallel via rayon and streams `ThumbnailUpdate` events through a Tauri Channel |
| `clear_thumbnail_cache()` | Deletes `{AppData}/thumbnails/` entirely (dev menu action) |
| `create_cbz(projectId, outputPath, onEvent)` | Zip all non-excluded images in chapter/page order; streams `progress` / `done` / `error` events via Channel; if a cover is set, it is written as `0000.jpg` and chapter pages start at `0001.jpg`. On success, updates `last_export_path`/`last_exported_at` on the project |
| `set_project_cover(projectId, imagePath)` | Re-encode picked image as JPEG quality 100 into `{AppData}/covers/`, plus a 200px-wide thumbnail into `{AppData}/covers/thumbnails/`, update DB; returns `{ coverPath, coverThumbnailPath }` |
| `search_anilist_covers(query)` | Search Anilist's public GraphQL API by title, return up to 5 `AnilistCandidate`s (`anilistId`, `title`, `year`, `thumbnailUrl`, `imageUrl`) for the manual picker in `CoverDialog` |
| `apply_anilist_cover(projectId, anilistId, imageUrl, title)` | Download `imageUrl` and write it verbatim as the master (Anilist always serves JPEG, so no lossy re-encode), plus a re-encoded 200px-wide thumbnail; update DB with `anilist_id`/`cover_title`; returns `{ coverPath, coverThumbnailPath }` |
| `auto_fill_missing_covers(onEvent)` | Runs the automatic lookup (see below) for every project with no cover; streams `{ current, total, applied }` progress and a final `{ applied, total }` summary through a Channel |
| `remove_project_cover(projectId)` | Delete cover + thumbnail files and clear `cover_path`/`cover_thumbnail_path`/`anilist_id`/`cover_title` in DB |
| `get_kobo_device()` | Returns the currently-known Kobo device (`{ drivePath, label, freeBytes, totalBytes }`) or `null`, read synchronously from the state the background poller keeps current — see **Kobo sync** below |
| `sync_project_to_kobo(projectId, onEvent)` | Ensures a fresh `.cbz` in Kobo sync's own AppData cache (re-exporting first if needed), then copies it onto the connected Kobo with byte-level progress; streams `exporting` / `copying` / `done` / `error` via Channel. Never prompts for a save location |
| `sync_all_to_kobo(onEvent)` | Runs the same sync for every project that's outdated or missing on the device, in sequence; streams `started` (row now uploading) / `progress` (row finished) / `done` (summary) via Channel — coarse, no byte-level detail per project |

`start_library_watcher` (in `watch.rs`) is not an invokable command — it's a plain function called from `lib.rs`'s `setup()` at launch (if a library root is already configured) and from `set_library_root` whenever the root changes. It watches the entire library root recursively for the whole app session (both the manga level and the chapter level — see `docs/rust-primer.md`'s `notify` entry for how one recursive watch is scoped back to those two levels), replacing any previously active watcher. On a relevant `Create`/`Remove` event it rescans the affected level and emits either `projects-updated` (payload: the fresh `Project[]`) or `chapters-updated` (payload: the affected project id) — no confirmation, since the filesystem change already happened.

## Cover auto-lookup

Every project gets an automatic attempt at an Anilist cover the moment it's first discovered on disk — no user action required. `insert_new_projects` (in `projects.rs`) returns the `(id, name)` of every project it just inserted; each of its three call sites (`list_projects`, `set_library_root`, and the watcher in `watch.rs`) then calls `cover::spawn_auto_cover_lookup` once per new project. This is fire-and-forget: the lookup runs in a detached `tauri::async_runtime::spawn` task so project discovery itself (which can mean scanning hundreds of folders at once, e.g. a first-time library import) never blocks on network I/O.

The lookup itself (`try_auto_apply_cover`):
1. Clean the folder name (`clean_title`) — strips `[...]`/`(...)` groups and volume/chapter range tokens (`v01-05`, `ch1-10`) via `regex`, since scanlation folder names rarely match a series title verbatim.
2. Search Anilist (`Page { media(search: ..., type: MANGA) { ... } }`) for the cleaned title, take only the top hit.
3. Compare the cleaned title against *both* the hit's English and romaji titles with `strsim::jaro_winkler` (case-insensitive), taking whichever is closer. Comparing only the (English-preferred) display title isn't enough — scanlation folder names are almost always romaji, and a manga's English localisation title can differ from it completely (e.g. "Kaoru Hana wa Rin to Saku" vs "The Fragrant Flower Blooms With Dignity"), which silently failed the threshold despite being the correct match. Below **0.85**, do nothing — silently, no toast, since there's no user watching a background lookup and a wrong auto-applied cover would be worse than none.
4. Above the threshold, download and apply it the same way `apply_anilist_cover` does, then re-emit `projects-updated` so any open `ProjectList`/`ProjectRow` picks up the new cover live.

This feature originally shipped against MangaUpdates' search API instead of Anilist's, but MangaUpdates' cover images turned out to be much lower resolution — see the column-rename history under `anilist_id` in the Database section above. The `clean_title` → search → similarity-gate → apply architecture is unchanged from that first version; only the HTTP calls and response parsing in `cover.rs` differ.

All concurrent lookups — automatic and the manual `auto_fill_missing_covers` bulk backfill alike — share one `CoverLookupSemaphore` (capacity 4, managed state, initialised in `lib.rs`), so a large import or a bulk backfill never fires more than a handful of Anilist requests at once.

Since automatic lookup only fires at discovery time, projects that already existed before this feature shipped (or whose lookup was skipped for low similarity) never get a retroactive attempt on their own — that's what `auto_fill_missing_covers` is for: the same lookup, run once for every project currently missing a cover, triggered manually from the "Auto-fill missing covers" button in `ProjectList`'s header.

Manual override always remains available regardless of what automatic lookup did or didn't do: `CoverDialog`'s title search (`search_anilist_covers`) shows a picker of up to 5 candidates, and picking one calls `apply_anilist_cover` directly.

## Thumbnail cache

Generated on first expand of each chapter, cached across sessions.

- **Location:** `{AppData}/thumbnails/{chapter_id}/{stem}.jpg`
- **Size:** 200 px wide, proportional height
- **Encoding:** JPEG quality 75
- **Algorithm:** bilinear via `fast_image_resize` (SIMD), parallel workers via `rayon`
- **Lifecycle:** created by `generate_chapter_thumbnails_stream`, invalidated individually by `hard_delete_image`, wiped entirely via **Tools → Clear Thumbnail Cache** in the native menu bar

Project covers have their own parallel thumbnail, since `cover_path` is the master file embedded verbatim as page 0000 in CBZ exports and can't be downscaled: `cover.rs` writes a 200px-wide `cover_thumbnail_path` into `{AppData}/covers/thumbnails/{project_id}.jpg` eagerly (not lazily/streamed like chapter thumbnails, since there's only one cover per project) whenever the cover is set or fetched, sharing the same resize routine (`resize_to_jpeg` in `thumbnails.rs`) as chapter thumbnails. `CoverThumbnail` renders `coverThumbnailPath`, falling back to the full-res `coverPath` for any project whose cover predates this cache.

### ImageGrid flow

1. `get_chapter_images` returns immediately — checks cache, no generation
2. Images without a cached thumbnail have `thumbnailPath === path` (original as fallback, shown blurred with a spinner)
3. `generate_chapter_thumbnails_stream` runs in a detached thread, streams `{ imagePath, thumbnailPath }` via Channel
4. Frontend swaps each image in as its thumbnail arrives; blur/spinner clears

## Kobo sync

Copies exported `.cbz` files onto a connected Kobo eReader and keeps them up to date as chapters/pages change.

**Device detection**

`kobo.rs`'s `start_kobo_watcher` runs a background thread (started in `lib.rs`'s `setup()`) that polls drive letters `A:`–`Z:` every 3 seconds for a `.kobo` marker directory at the drive root — the reliable cross-model signal a mounted drive is a Kobo, confirmed against a real device (volume label `KOBOeReader`). The result is kept in managed `KoboDeviceState` (`Mutex<Option<KoboDevice>>`) and only written/emitted (`kobo-device-changed`) when it actually changes. `get_kobo_device()` reads the same state synchronously so the frontend's `useKoboDevice` hook doesn't start blank for up to 3s on mount.

**Local cache — deliberately not the user's exported file**

Kobo sync never prompts for a save location, on either the per-project button or the bulk "Sync all". Instead `kobo_cache_path` (kobo.rs) writes its own `.cbz` to `{AppData}/kobo-exports/{project_id}.cbz` — a fixed, hidden location the user never picks or sees, the same way chapter thumbnails and cover images live under AppData rather than anywhere user-chosen. This is deliberately independent of `last_export_path`/`last_exported_at` (Export history's columns, set only by the user's own "Export CBZ" button): the two are now separate files on disk, so Kobo sync gets its own freshness timestamp, `last_kobo_export_at`, rather than reusing (and potentially fighting over) the export-history one. `cleanup_project_assets` (projects.rs) deletes this cache file alongside covers/thumbnails when a project is removed.

**Destination**

Synced files go to `{drive}\fukuro\{project_name}.cbz` on the device — a dedicated folder (created on first sync), not the device root or any existing sideload folder, so the "does this project already have a file on the device" scan in `sync_all_to_kobo` only ever has to look in one place. Kobo's Nickel software indexes `.cbz`/`.epub` files recursively regardless of folder structure, so no specific folder name is required by the device itself.

**Status detection**

`getKoboSyncStatus` (`lib/kobo.ts`) derives one of three resting states from `lastKoboExportAt`/`lastSyncedAt` (never `lastExportedAt` — that's Export history's own column, unrelated to what's on the device):

- **`not-sent`** — both timestamps null: never exported to the Kobo cache *and* never copied to a device. (This case previously returned `null`/no indicator, which hid never-sent projects from the pending count even though `sync_all_to_kobo` would send them — the awareness gap the drawer redesign fixed.)
- **`outdated`** — on the device once but drifted since: exported-but-not-copied, or invalidated after an exclusion toggle / page delete (`lastKoboExportAt` null with a prior sync — see below).
- **`up-to-date`** — the device copy reflects the current cache.

`isKoboPending` = anything that isn't `up-to-date` (both `not-sent` and `outdated`); it drives the header pill's count and the drawer's "N pending" summary. It's an approximation — it can't see a device copy deleted directly on the Kobo (the backend's `existing_on_device` scan catches that), which is why the drawer's Sync action stays enabled even at zero pending.

**Invalidating a stale cache**

Excluding/including a page (`toggle_exclusion`), permanently deleting one (`hard_delete_image`), or deleting a whole chapter (`delete_chapter`, projects.rs) changes what either cached `.cbz` would actually contain, so all three call `invalidate_export` (`pub(crate)` in images.rs) to null out the owning project's `last_exported_at` **and** `last_kobo_export_at` together — one action, two independent caches invalidated. `sync_project` (kobo.rs) treats a null `last_kobo_export_at` the same as a missing cache file — re-running `write_cbz_archive` before copying — rather than silently re-uploading a `.cbz` that no longer matches the chapter's current content.

A chapter *appearing or disappearing on disk* invalidates the same two timestamps, via the project-level sibling `invalidate_export_by_project` (also `pub(crate)` in images.rs — takes a project id directly instead of resolving one from a chapter row). This fires wherever the chapter set is reconciled against disk: the library watcher (`watch.rs`, live while the app runs), `get_project_chapters` (on editor open), and — importantly — `list_projects`, which now rescans **every** project's chapters, not just the project level, so a chapter downloaded while the app was closed is noticed (and marked out-of-sync) the moment the app is reopened rather than only when that project's editor is first opened. Without this, a freshly-downloaded chapter left the project reading as up-to-date and hid it from the Kobo pending count. The watcher additionally re-emits `projects-updated` after a live chapter change, since the project list / Kobo pill only listens to that event (not `chapters-updated`, which the editor owns).

**Sync flow**

`sync_project` (shared by both commands) always resolves the local file via `kobo_cache_path`, re-exporting into it if missing/stale, then chunked-copies it onto the device with byte-level progress (`copy_with_progress`; see `docs/rust-primer.md`'s entry on chunked I/O). `sync_all_to_kobo` runs this in sequence (not concurrently — one USB device, no benefit to parallelism) for every project that's outdated, missing from the device's `fukuro` folder, or invalidated since its last sync — every project is a candidate, since there's no save-location prompt to avoid in bulk anymore.

**UI**

- `KoboSyncDrawer` (project-list header, shown only when a device is connected) is the single place the whole sync picture lives. A labeled **pill trigger** shows the device + a pending count (warning tint) or an up-to-date check, visible without opening anything. Clicking it opens a right-hand Foundations **Drawer**:
  - **Header:** device label + free/total space.
  - **List:** *every* project (via `KoboSyncRow`), pending (Not sent / Outdated) sorted above Up to date, each with a status pill, a "Synced X ago" subline, and a per-row **Send**/**Retry** button (a single send shows byte-level progress via its own `useKoboSync`).
  - **Actions (sticky footer):** an overall "Syncing X of N" bar during a run + a **Sync all** button, always enabled while a device is connected (reads "Re-sync all" at zero pending so the backend's device scan can catch externally-deleted files).
  - During **Sync all**, rows go Queued → Syncing (spinner) → Done/Failed, driven by `SyncAllEvent`'s `started`/`progress` stream; failed rows keep a Retry after the run. The drawer refuses to close mid-run so the event channel isn't orphaned.
- Per-project sync *also* lives in `ProjectRow`'s `⋯` dropdown menu as a plain **Send to device** item, and `ExportPanel` (editor) has its own **Send to device** button alongside **Export CBZ** — all three entry points (drawer row, row menu, export panel) drive the shared `useKoboSync` hook. Project rows carry no standalone status marker; the drawer is the source of truth.

**A gotcha worth knowing:** `SyncEvent`/`SyncAllEvent`/`ExportEvent`/`BackfillEvent` all need **both** `rename_all = "camelCase"` (renames the `type` tag) **and** `rename_all_fields = "camelCase"` (renames the fields inside each variant) — one without the other silently ships snake_case field names with no error anywhere. See `docs/rust-primer.md`'s "Tagged enums" entry for the full story.

## Auto-update

Checks GitHub Releases for a newer published version on every app startup and offers to download and install it in place, using `tauri-plugin-updater` + `tauri-plugin-process`. Entirely frontend-driven — no Rust commands were added; `use-app-update.ts` calls each plugin's JS API directly (`check`, `Update.download`, `Update.install`, `relaunch`), the same way `plugin-dialog` is only ever called from JS. `lib.rs` just registers both plugins (`.plugin(tauri_plugin_updater::Builder::new().build())`, `.plugin(tauri_plugin_process::init())`); their permissions (`updater:default`, `process:allow-restart`) live in `capabilities/default.json`.

**Release pipeline**

- Releases continue to be published as **drafts** by `release.yml` — the manual publish step on GitHub is the real gate; the updater endpoint (`.../releases/latest/download/latest.json`) only ever resolves to the latest *published*, non-prerelease release, so nothing auto-publishes.
- `bundle.targets` is `["nsis"]` only (narrowed from `"all"`) — the updater plugin needs one predictable Windows artifact to sign and serve, and NSIS supports the quiet/passive silent-install modes the updater relies on; MSI's silent-update path is clunkier. `.msi` is no longer produced.
- `bundle.createUpdaterArtifacts: true` in `tauri.conf.json` tells the build to produce the signed update artifact/signature whenever the signing env vars are present. `tauri-action` in `release.yml` (via `includeUpdaterJson: true`) aggregates those into `latest.json` on the GitHub release — no separate signing step to maintain.
- The signing keypair (`tauri signer generate`) and its two GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) are generated and set by hand, outside any assistant session — the private key never needs to touch the repo or an editor. Only the public key goes into `tauri.conf.json`'s `plugins.updater.pubkey`.
- Single stable channel only — no beta/prerelease opt-in.

**Check & install flow**

- Checked once, on app startup only (`useAppUpdate`'s mount effect) — no periodic in-session polling, no manual "Check for updates" menu item.
- If the check itself fails (offline, GitHub unreachable, rate-limited): silent no-op, since this is a passive background check the user didn't trigger. Any failure *after* the user accepts the prompt (download or install) surfaces in the dialog instead, since they've now taken an explicit action.
- `AppUpdateDialog` (mounted once in `app.tsx`, alongside `Toaster`) is a single `Dialog` fully controlled by `useAppUpdate`'s state machine (`idle` → `available` → `downloading` → `ready` → `installing`, or `error` at any point past `available`) — no `Dialog.Trigger`, since nothing the user clicks opens it.
- `available`: prompts **Download & install** vs **Not now**, before any bytes are fetched.
- `downloading`: shows byte progress via the plugin's `Started`/`Progress` events; the dialog can't be dismissed mid-download (mirrors `KoboSyncDrawer`'s guard against closing mid-batch — closing here would abandon the in-flight download).
- `ready`: prompts **Restart now** (installs then `relaunch()`s) vs **Restart later**. "Restart later" discards the in-memory `Update` handle entirely rather than trying to persist it across a process exit — the next launch's startup check simply finds the same release again and the whole prompt/download/restart flow repeats from scratch.
- `installing` can't be dismissed either, for the same reason as `downloading`.

## Native menu

Configured in `lib.rs` via `tauri::menu`. Current items:

| Menu | Item | Action |
|---|---|---|
| Fukurō | About, Quit | About shows a native message box with the running build's name/version, via explicit `AboutMetadata` built from `app.package_info()`; on Windows, `PredefinedMenuItem::about` with no metadata is a silent no-op, not a default dialog. Quit is standard |
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

## Feature planning — PRIORITY

Before implementing any new feature (not bug fixes, not refactors — new user-facing or backend functionality), always run the `grilling` skill (relentless interview to sharpen the plan/design) first, even if the user did not invoke it via `/grill-me` or `/grilling`. This applies regardless of how the feature request was phrased — treat it as a mandatory gate, not an optional offer.

Do not start writing code for a new feature until the grilling session has reached a shared understanding of the design.

## Git commits

Format: `action(context): message` — single line, no description body, no co-authoring.

Split changes into multiple logical commits, each covering a single concern (e.g. DB schema, Rust commands, frontend feature, tooling, docs). Never bundle unrelated changes into one commit.

Before committing, `git status` must be clean afterward — no leftover untracked or modified files. Stage everything relevant to the commit(s) being made; don't leave stray files sitting uncommitted.

**Never commit without explicit approval.** Do not run `git commit` unless the user explicitly says to commit, or you have asked and received clear confirmation. Finishing a task does not imply approval to commit. Before committing, present the proposed split (if multiple commits) and each commit message, and wait for the user to confirm they look right.

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

## Tailwind class conventions

Always prefer canonical Tailwind classes over arbitrary-value syntax when a canonical form exists. Common cases:

| ❌ Arbitrary | ✅ Canonical |
|---|---|
| `aspect-[2/3]` | `aspect-2/3` |
| `rounded-[4px]` | `rounded` / `rounded-sm` / etc. |
| `inset-[0]` | `inset-0` |
| `opacity-[0.5]` | `opacity-50` |

When writing Tailwind classes, reach for the canonical scale-based class first. Only use `[arbitrary]` syntax when no canonical class covers the value.

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

## Component architecture

Composability over configuration. When a component grows hard to read, break it into focused named pieces — not by adding props, but by extracting sub-components with explicit, minimal interfaces.

**Rules of thumb:**
- A JSX block assigned to a `const` variable and used once is a component waiting to be named. Make it an `FC`.
- Props that always travel together (e.g. `coverPath + anilistId + coverTitle`) belong in a shared type (`CoverInfo`). Callers hold one state var; the callback takes one argument.
- Props that leak internal state (form refs, register functions, submit handlers) signal the wrong owner. Move the form logic into the component that renders it.
- Make event callbacks optional (`onRenamed?`) when a no-op is the natural default and the parent legitimately doesn't care.
- When the same UI pattern appears in two places, extract a shared primitive (`CoverThumbnail`, `renameSchema`) before it appears a third time.
- Navigation state should carry domain objects (`project: Project`), not unpacked fields.

**What not to extract:** stable, single-use components with a clear single concern (e.g. `ExportPanel`, `CoverDialog`) are fine as-is even if sizeable. Only extract when the complexity is accidental, not inherent.

## Path aliases

`@/` maps to `src/`. Configured in both `vite.config.ts` and `tsconfig.json`.

## Foundations components

Foundations UI components, hooks, and utils are **not** installed as a package — they are copied source files from [foundations.significa.co](https://foundations.significa.co). When updating a component, copy the new source from the site rather than editing in place.

**Looking anything up on Foundations — a component's exact source, its dependencies, usage docs, whether a component exists at all — always use `curl` against `foundations.significa.co/llms.txt`, not WebFetch.** WebFetch summarizes pages through a smaller model, which has already silently dropped or garbled source code details in this project. `curl` gets the raw text directly.

- `curl https://foundations.significa.co/llms.txt` — the full site index: every page's path and a one-line description, grouped by section (`ui`, `components`, etc).
- `curl https://foundations.significa.co/{path}/llms.txt` (path from the index, e.g. `ui/button`, `components/marquee`) — that page's full docs in plain text: description, dependencies (as further `llms.txt` links to follow if needed), and the complete current source code block.

They live alongside all other app code with no special namespace:
- UI components: `src/components/ui/{name}.tsx` (button, dialog, disclosure, divider, drawer, field, input, modal, progress, skeleton, spinner, toaster, tooltip, slot)
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

## Chapter ordering

Chapters are **not** manually reorderable or renameable — there is no drag-and-drop and no inline rename (both were removed). `get_project_chapters` re-derives every chapter's `sort_order` from its folder name on each read (`recompute_sort_order` in `projects.rs`, using `natural_sort_key`), so the list always reflects on-disk folder names in natural order. The `display_name` is the raw folder name; the `chapterNumber` shown as "Chapter N" is parsed from it at read time by `extract_chapter_number` (`utils.rs`) and rendered above the folder name, falling back to just the folder name when no number can be extracted.

## Image sorting

Images within each chapter folder are sorted with a natural sort algorithm (1, 2, 10 — not 1, 10, 2). Implemented in `utils.rs:natural_sort_key` (shared with chapter ordering).

## Platform target — Windows only

Windows is the only supported platform. The project is developed, built, and run exclusively on Windows; no macOS/Linux testing or support is maintained.

### Path handling

Never manipulate file paths as raw strings. Always use Tauri's path APIs, which return and accept native Windows paths (backslashes).

- **Obtaining paths** — use `@tauri-apps/plugin-dialog` (`open`, `save`); the returned string is already the correct native path.
- **Joining / resolving paths** — use `@tauri-apps/api/path` (`join`, `resolve`, `appDataDir`, etc.).
- **Displaying paths in the UI** — render as-is; do not normalise separators for display.
- **Image `src` attributes** — convert with `convertFileSrc` from `@tauri-apps/api/core` (produces the correct `asset://` URL).
- **Rust side** — use `std::path::PathBuf` and `.join()` throughout; never concatenate strings with `/`.

### UI copy

Use Windows-native terms:

| Term |
|---|
| Show in folder |
| Delete |

### Shell / file-manager actions

Use `revealItemInDir` from `@tauri-apps/plugin-opener` to reveal files in Explorer. Already bundled — no extra dependency needed.

