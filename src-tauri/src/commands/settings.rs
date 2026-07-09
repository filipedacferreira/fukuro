use rusqlite::{params, Connection};
use std::path::Path;
use tauri::AppHandle;

use crate::commands::projects::{cleanup_project_assets, insert_new_projects, query_all_projects, Project};
use crate::commands::watch::start_library_watcher;
use crate::db::DbState;

// The one row this table currently holds: the absolute path to the folder the user
// configured as their manga library. Kept in a generic key-value `settings` table
// (see db.rs) rather than a dedicated column so future settings don't need another
// migration.
const LIBRARY_ROOT_KEY: &str = "library_root";

// Reads the configured library root, if any. `None` means the app hasn't been pointed
// at a folder yet — every other project/chapter command treats that as "nothing to do".
// Shared by `get_library_root`, `list_projects`, and the watcher in `watch.rs`.
pub(crate) fn read_library_root(conn: &Connection) -> Result<Option<String>, String> {
    match conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![LIBRARY_ROOT_KEY],
        |r| r.get::<_, String>(0),
    ) {
        Ok(value) => Ok(Some(value)),
        // query_row returns this specific error (rather than an empty Option) when zero
        // rows match — that's the normal "not configured yet" case, not a real failure.
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_library_root(state: tauri::State<DbState>) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    read_library_root(&conn)
}

// Points the app at a new library root: wipes every existing project (their root_paths
// belonged to the *previous* root and are meaningless once we're scanning a different
// folder tree — cascading deletes take care of chapters/exclusions, and
// `cleanup_project_assets` takes care of their cached covers/thumbnails in AppData),
// scans the new root's immediate subfolders as projects, and (re)starts the single
// recursive watcher on it. Returns the freshly-scanned project list.
#[tauri::command]
pub fn set_library_root(
    root_path: String,
    app: AppHandle,
    db_state: tauri::State<DbState>,
) -> Result<Vec<Project>, String> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root_path));
    }

    {
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;

        let existing: Vec<(String, Option<String>)> = {
            let mut stmt = conn
                .prepare("SELECT id, cover_path FROM projects")
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, Option<String>)> = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };
        for (project_id, cover_path) in &existing {
            cleanup_project_assets(&conn, &app, project_id, cover_path.as_deref())?;
        }
        // ON DELETE CASCADE removes their chapters/excluded_images rows too.
        conn.execute("DELETE FROM projects", [])
            .map_err(|e| e.to_string())?;

        // UPSERT: first-time setup inserts, changing the root later updates in place.
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![LIBRARY_ROOT_KEY, root_path],
        )
        .map_err(|e| e.to_string())?;

        insert_new_projects(&conn, &root_path)?;
    } // lock released before restarting the watcher, which acquires it again internally

    start_library_watcher(&app)?;

    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    query_all_projects(&conn)
}
