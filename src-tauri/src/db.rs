use rusqlite::{Connection, Result};

pub struct DbState(pub std::sync::Mutex<Connection>);

pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;

         CREATE TABLE IF NOT EXISTS projects (
             id TEXT PRIMARY KEY,
             root_path TEXT NOT NULL,
             name TEXT NOT NULL,
             created_at INTEGER NOT NULL
         );

         CREATE TABLE IF NOT EXISTS chapters (
             id TEXT PRIMARY KEY,
             project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
             folder_path TEXT NOT NULL,
             display_name TEXT NOT NULL,
             sort_order INTEGER NOT NULL,
             image_count INTEGER NOT NULL DEFAULT 0
         );

         CREATE TABLE IF NOT EXISTS excluded_images (
             chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
             image_path TEXT NOT NULL,
             PRIMARY KEY (chapter_id, image_path)
         );",
    )
}
