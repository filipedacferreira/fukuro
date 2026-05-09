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
         PRAGMA foreign_keys=ON;

         CREATE TABLE IF NOT EXISTS projects (
             id TEXT PRIMARY KEY,
             root_path TEXT NOT NULL,   -- the folder the user opened
             name TEXT NOT NULL,        -- derived from the folder name, shown in the UI
             created_at INTEGER NOT NULL -- Unix timestamp (seconds)
         );

         CREATE TABLE IF NOT EXISTS chapters (
             id TEXT PRIMARY KEY,
             project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
             folder_path TEXT NOT NULL,   -- absolute path to the chapter subfolder
             display_name TEXT NOT NULL,  -- editable label shown in the UI
             sort_order INTEGER NOT NULL, -- 0-based; drives chapter order in the CBZ
             image_count INTEGER NOT NULL DEFAULT 0 -- cached at scan time
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

    Ok(())
}
