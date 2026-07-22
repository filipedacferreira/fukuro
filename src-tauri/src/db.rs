use std::path::Path;

use rusqlite::{Connection, Result, params};

// DbState is a newtype wrapper around a Mutex-protected SQLite connection.
// Tauri holds one instance of this for the entire app lifetime (registered in lib.rs
// via app.manage()), and injects a reference into any command that declares
// `state: tauri::State<DbState>` as a parameter.
//
// The Mutex ensures only one thread can query the database at a time.
// `.0` accesses the inner field (Rust tuple-struct syntax).
pub struct DbState(pub std::sync::Mutex<Connection>);

// Returns true if `column` already exists in `table`.
// Used by migrations that add new columns — ALTER TABLE has no IF NOT EXISTS
// in the SQLite version bundled with rusqlite, so we check manually.
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        // `r` is a Row. `.get::<_, i64>(0)` reads column index 0 as an i64.
        // The turbofish `::<_, i64>` tells Rust what type to decode the value as;
        // `_` lets Rust infer the index type (usize).
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0) > 0 // if the pragma fails for any reason, assume the column doesn't exist
}

// Returns true if `table` already exists in the database schema.
// Used to detect pre-"single library root" databases (see the v4 migration below) —
// sqlite_master is SQLite's built-in schema catalog, one row per table/index/etc.
fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0) > 0
}

// Called once at startup (lib.rs) to set up pragmas and create tables.
// `IF NOT EXISTS` makes this safe to run on every launch — it's a no-op
// when the DB already has the tables.
pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        // WAL (Write-Ahead Logging) mode: readers don't block writers and vice versa.
        // Much better performance for a desktop app where commands fire concurrently.
        "PRAGMA journal_mode=WAL;

         -- Enforce REFERENCES constraints (SQLite ignores them by default without this).
         PRAGMA foreign_keys=ON;",
    )?;

    // v4: single watched library root, replacing per-manga manual imports. Old databases
    // have no `settings` table — their `projects` rows each point at an independent,
    // manually-picked root_path, which the new "one root, auto-scanned" model can't
    // reconcile. Rather than attempt a migration, drop the old data and let the fresh
    // scan of the newly-configured library root repopulate everything. ON DELETE CASCADE
    // isn't in play here (we're dropping the tables outright), so children are dropped
    // explicitly in FK order (excluded_images -> chapters -> projects).
    if !table_exists(conn, "settings") {
        conn.execute_batch(
            "DROP TABLE IF EXISTS excluded_images;
             DROP TABLE IF EXISTS chapters;
             DROP TABLE IF EXISTS projects;",
        )?;
    }

    conn.execute_batch(
        // Generic key-value store for app-wide settings. Currently holds a single row,
        // key = 'library_root', but a table (rather than a dedicated column somewhere)
        // keeps room for future settings without another migration.
        "CREATE TABLE IF NOT EXISTS settings (
             key TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS projects (
             id TEXT PRIMARY KEY,
             root_path TEXT NOT NULL,   -- absolute path to this manga's folder (a direct
                                        -- child of the configured library root)
             name TEXT NOT NULL,        -- derived from the folder name, shown in the UI
             created_at INTEGER NOT NULL -- Unix timestamp (seconds)
         );

         CREATE TABLE IF NOT EXISTS chapters (
             id TEXT PRIMARY KEY,
             project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
             folder_path TEXT NOT NULL,   -- absolute path to the chapter subfolder
             display_name TEXT NOT NULL,  -- editable label shown in the UI
             sort_order INTEGER NOT NULL, -- 0-based; drives chapter order in the CBZ
             image_count INTEGER NOT NULL DEFAULT 0 -- re-derived from disk on every
                                                     -- get_project_chapters call (see
                                                     -- recompute_image_counts), not a
                                                     -- write-once cache
         );

         -- Soft-delete table: marking an image excluded doesn't touch the file.
         -- Hard delete (trash icon) removes the file AND this row.
         -- Composite PK prevents duplicate exclusions for the same image.
         CREATE TABLE IF NOT EXISTS excluded_images (
             chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
             image_path TEXT NOT NULL,
             PRIMARY KEY (chapter_id, image_path)
         );",
    )?;

    // v2: cover image columns — added separately because ALTER TABLE ADD COLUMN
    // has no IF NOT EXISTS in the bundled SQLite version, so we guard with pragma_table_info.
    if !column_exists(conn, "projects", "cover_path") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN cover_path TEXT;")?;
    }
    if !column_exists(conn, "projects", "anilist_id") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN anilist_id INTEGER;")?;
    }
    // v3: store the resolved manga title alongside the Anilist ID so the UI can display
    // a meaningful label without making a network request.
    if !column_exists(conn, "projects", "cover_title") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN cover_title TEXT;")?;
    }
    // v5: cache a small (200px-wide) cover thumbnail separately from the full-resolution
    // cover_path master. The master is embedded verbatim as page 0000 in CBZ exports, so
    // it can't be downscaled — but the UI only ever displays covers at a few dozen pixels,
    // so decoding the master for every list row/header render was wasteful.
    if !column_exists(conn, "projects", "cover_thumbnail_path") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN cover_thumbnail_path TEXT;")?;
    }
    // v6: replaced Anilist with MangaUpdates as the cover-lookup source. Renaming the
    // column preserves the rest of the schema; the old numeric Anilist IDs are meaningless
    // in MangaUpdates' ID space, so any existing values are cleared right after the rename
    // (the cover files themselves are left alone — only the provider metadata is stale).
    if column_exists(conn, "projects", "anilist_id") && !column_exists(conn, "projects", "mangaupdates_id") {
        conn.execute_batch(
            "ALTER TABLE projects RENAME COLUMN anilist_id TO mangaupdates_id;
             UPDATE projects SET mangaupdates_id = NULL;",
        )?;
    }
    // v7: reverted back to Anilist — MangaUpdates' search results turned out to serve very
    // low-resolution cover images. Any cover actually fetched through the (now-removed)
    // MangaUpdates lookup is cleared out entirely, not just its ID, so the next automatic
    // or bulk lookup redownloads a proper Anilist cover instead of leaving the low-quality
    // file in place; covers with no mangaupdates_id (manual uploads) are left untouched.
    // The column itself is renamed back, mirroring v6 in reverse.
    if column_exists(conn, "projects", "mangaupdates_id") && !column_exists(conn, "projects", "anilist_id") {
        conn.execute_batch(
            "UPDATE projects SET cover_path = NULL, cover_thumbnail_path = NULL, cover_title = NULL
                 WHERE mangaupdates_id IS NOT NULL;
             ALTER TABLE projects RENAME COLUMN mangaupdates_id TO anilist_id;
             UPDATE projects SET anilist_id = NULL;",
        )?;
    }

    // v9: export history + Kobo sync tracking. last_export_path/last_exported_at record
    // where and when the project's .cbz was last written to disk (set by create_cbz);
    // last_synced_at records when that file was last copied onto a Kobo device. Keeping
    // these as two separate nullable timestamps (rather than one) lets the UI tell "never
    // exported" (both null) apart from "exported but not yet on the device" (exported set,
    // synced null) and "outdated on the device" (exported > synced). Timestamps are Unix
    // epoch seconds (INTEGER), matching the existing `created_at` column, rather than an
    // ISO-8601 string — no date/time crate is otherwise needed in this codebase, and a plain
    // epoch number is what the client-side "outdated" comparison and "X days ago" display
    // actually want.
    if !column_exists(conn, "projects", "last_export_path") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN last_export_path TEXT;")?;
    }
    if !column_exists(conn, "projects", "last_exported_at") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN last_exported_at INTEGER;")?;
    }
    if !column_exists(conn, "projects", "last_synced_at") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN last_synced_at INTEGER;")?;
    }

    // v10: Kobo sync stopped reusing the user-facing last_export_path/last_exported_at (the
    // manual "Export CBZ" file) as its own local cache — syncing now always writes to a fixed
    // AppData path the user never picks or sees (see kobo.rs's kobo_cache_path), so it never
    // needs a save-location prompt. That cache needs its own freshness timestamp, independent
    // of whatever the user's own last manual export was.
    if !column_exists(conn, "projects", "last_kobo_export_at") {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN last_kobo_export_at INTEGER;")?;
    }

    // v8: chapter display_name is no longer a user-editable label (the rename UI and
    // rename_chapter command are gone) — it's now purely a read-only mirror of the
    // chapter folder's name, auto-sorted instead of manually reordered. Any name a user
    // customized before this change would otherwise keep showing as a label that no
    // longer matches its actual folder, so resync every row from folder_path once here.
    // This has no schema change to gate on, and re-running it is harmless (folder_path
    // only changes when a chapter is deleted and reinserted, which already sets
    // display_name fresh), so it just runs unconditionally on every launch.
    resync_chapter_display_names(conn)?;

    Ok(())
}

fn resync_chapter_display_names(conn: &Connection) -> Result<()> {
    // Collect first — SQLite can't UPDATE a row while a SELECT statement holding a
    // borrow of `conn` is still open over it.
    let rows: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare("SELECT id, folder_path, display_name FROM chapters")?;
        let result: Vec<(String, String, String)> = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    for (id, folder_path, display_name) in rows {
        // file_name() reads the last path segment regardless of which separator the
        // stored path uses — folder_path is normalized to forward slashes, but this
        // works for either.
        let basename = Path::new(&folder_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(folder_path);

        if basename != display_name {
            conn.execute(
                "UPDATE chapters SET display_name = ?1 WHERE id = ?2",
                params![basename, id],
            )?;
        }
    }

    Ok(())
}
