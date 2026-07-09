use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::commands::settings::read_library_root;
use crate::db::DbState;
use crate::utils::{is_image_file, normalize_path};

// These structs are returned from commands. `Serialize` lets serde convert them to JSON
// so Tauri can send them to the frontend. `rename_all = "camelCase"` means `root_path`
// becomes `rootPath` in JSON — matching TypeScript naming conventions automatically.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub root_path: String,
    pub name: String,
    pub created_at: i64,
    pub chapter_count: i64,
    pub cover_path: Option<String>,
    pub cover_thumbnail_path: Option<String>,
    pub anilist_id: Option<i64>,
    pub cover_title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub project_id: String,
    pub folder_path: String,
    pub display_name: String,
    pub sort_order: i64,
    pub image_count: i64,
    pub excluded_count: i64,
}

// Counts how many image files are directly inside a directory (not recursive).
// Used when inserting a new chapter — the count is cached in the DB.
fn count_images_in_dir(dir: &Path) -> i64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.file_type().map(|t| t.is_file()).unwrap_or(false)
                        && is_image_file(e.path().as_path())
                })
                .count() as i64
        })
        .unwrap_or(0) // if the directory can't be read, return 0 rather than crashing
}

// Shared SELECT behind both `list_projects` and `set_library_root` — factors out the
// join/count query so it's written once instead of duplicated at every call site.
pub(crate) fn query_all_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.root_path, p.name, p.created_at, COUNT(c.id) as chapter_count,
                    p.cover_path, p.anilist_id, p.cover_title, p.cover_thumbnail_path
             FROM projects p
             LEFT JOIN chapters c ON c.project_id = p.id
             GROUP BY p.id
             ORDER BY p.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    // query_map runs the query and calls the closure for each row, returning an iterator
    // of Result<Project>. The closure must return Ok(...) even on success — that's how
    // rusqlite signals the row was processed without error.
    // filter_map(|r| r.ok()) silently skips any rows that fail to deserialise.
    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                root_path: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                chapter_count: row.get(4)?,
                cover_path: row.get(5)?,
                anilist_id: row.get(6)?,
                cover_title: row.get(7)?,
                cover_thumbnail_path: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

// Returns all projects, rescanning the configured library root first so the list always
// reflects the current state of disk (mirrors the rescan-on-read pattern `get_project_chapters`
// already uses one level down for chapters). Returns an empty list if no library root has
// been configured yet — the frontend shows the onboarding empty state in that case.
#[tauri::command]
pub fn list_projects(
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let Some(library_root) = read_library_root(&conn)? else {
        return Ok(Vec::new());
    };

    insert_new_projects(&conn, &library_root)?;
    remove_missing_projects(&conn, &app_handle)?;

    query_all_projects(&conn)
}

// Permanently deletes a manga: removes its folder (and everything in it) from disk, then
// its DB row (cascading to chapters/excluded_images). A DB-only delete would just be
// undone by the next rescan/watch event, since the folder would still exist under the
// watched library root — so this mirrors `hard_delete_image`'s permanent-delete behaviour
// one level up.
//
// If the folder can't be removed (e.g. a file inside is open elsewhere), the error is
// returned and the DB row is left untouched, so the project doesn't vanish from the list
// while its files are still on disk.
#[tauri::command]
pub fn delete_project(
    id: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let (root_path, cover_path, cover_thumbnail_path): (String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT root_path, cover_path, cover_thumbnail_path FROM projects WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    std::fs::remove_dir_all(&root_path).map_err(|e| e.to_string())?;

    cleanup_project_assets(
        &conn,
        &app_handle,
        &id,
        cover_path.as_deref(),
        cover_thumbnail_path.as_deref(),
    )?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn rename_project(
    id: String,
    name: String,
    state: tauri::State<DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// Deletes a project's cached cover image and per-chapter thumbnail cache directories.
// Called before a project's DB row is removed — whether by an explicit `delete_project`,
// by `remove_missing_projects` noticing its folder vanished, or by `set_library_root`
// wiping out projects that belonged to the previous root — so AppData doesn't accumulate
// files for projects that no longer exist in the DB.
pub(crate) fn cleanup_project_assets(
    conn: &Connection,
    app_handle: &AppHandle,
    project_id: &str,
    cover_path: Option<&str>,
    cover_thumbnail_path: Option<&str>,
) -> Result<(), String> {
    if let Some(cover_path) = cover_path {
        let _ = std::fs::remove_file(cover_path); // ignore error if already gone
    }
    if let Some(cover_thumbnail_path) = cover_thumbnail_path {
        let _ = std::fs::remove_file(cover_thumbnail_path); // ignore error if already gone
    }

    let chapter_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM chapters WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let result: Vec<String> = stmt
            .query_map(params![project_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        for chapter_id in chapter_ids {
            let thumb_dir = data_dir.join("thumbnails").join(chapter_id);
            let _ = std::fs::remove_dir_all(thumb_dir); // ignore error if already gone
        }
    }

    Ok(())
}

// Scans the library root's immediate subdirectories not yet in the DB and inserts them
// as projects (mangas), each with its own chapters scanned immediately — a manga folder
// can already contain chapter subfolders the first time we see it (e.g. it existed on
// disk before the library root was configured, or was just copied in wholesale).
// Shared by `list_projects` (rescan on read) and the library watcher in `watch.rs`
// (rescan on filesystem change). Returns whether any projects were inserted, so callers
// can decide whether to notify the frontend.
pub(crate) fn insert_new_projects(conn: &Connection, library_root: &str) -> Result<bool, String> {
    // Collect the root_paths of projects already in the DB into a HashSet for O(1) lookup.
    let existing: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT root_path FROM projects")
            .map_err(|e| e.to_string())?;
        let result: HashSet<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|p: String| normalize_path(Path::new(&p)))
            .collect();
        result
    };

    // Find subdirectories on disk that aren't in the DB yet.
    let mut new_dirs: Vec<_> = std::fs::read_dir(library_root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| !existing.contains(&normalize_path(&e.path())))
        .collect();
    new_dirs.sort_by_key(|e| e.file_name());

    let inserted_any = !new_dirs.is_empty();

    for entry in &new_dirs {
        let root_path = normalize_path(&entry.path());
        let name = entry.file_name().to_string_lossy().to_string();
        let project_id = Uuid::new_v4().to_string();
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO projects (id, root_path, name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![project_id, root_path, name, created_at],
        )
        .map_err(|e| e.to_string())?;

        insert_new_chapters(conn, &project_id, &root_path)?;
    }

    Ok(inserted_any)
}

// Deletes projects whose root_path no longer exists on disk, cleaning up their cached
// cover/thumbnails first. The DB schema's ON DELETE CASCADE takes care of that project's
// chapters and excluded_images rows. Shared by `list_projects` (rescan on read) and the
// library watcher in `watch.rs` (rescan on filesystem change), mirroring
// `insert_new_projects`. Returns whether any projects were removed, so callers can decide
// whether to notify the frontend.
pub(crate) fn remove_missing_projects(
    conn: &Connection,
    app_handle: &AppHandle,
) -> Result<bool, String> {
    let projects: Vec<(String, String, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT id, root_path, cover_path, cover_thumbnail_path FROM projects")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String, Option<String>, Option<String>)> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    let missing: Vec<(String, Option<String>, Option<String>)> = projects
        .into_iter()
        .filter(|(_, root_path, _, _)| !Path::new(root_path).is_dir())
        .map(|(id, _, cover_path, cover_thumbnail_path)| (id, cover_path, cover_thumbnail_path))
        .collect();

    let removed_any = !missing.is_empty();

    for (project_id, cover_path, cover_thumbnail_path) in &missing {
        cleanup_project_assets(
            conn,
            app_handle,
            project_id,
            cover_path.as_deref(),
            cover_thumbnail_path.as_deref(),
        )?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
            .map_err(|e| e.to_string())?;
    }

    Ok(removed_any)
}

// Rescans a project's root folder for subdirectories not yet in the DB and inserts
// them as new chapters, appended after the existing ones by sort_order.
// Shared by `get_project_chapters` (rescan on open) and the library watcher in
// `watch.rs` (rescan on filesystem change) so both paths dedupe against the DB the
// same way. Returns whether any new chapters were inserted, so callers can decide
// whether to notify the frontend.
pub(crate) fn insert_new_chapters(
    conn: &rusqlite::Connection,
    project_id: &str,
    root_path: &str,
) -> Result<bool, String> {
    // Collect the folder paths of chapters already in the DB into a HashSet for O(1) lookup.
    // The braces create a new scope so `stmt` is dropped (and its borrow of `conn` released)
    // as soon as we've collected the results — Rust requires all borrows to end before
    // we can use `conn` again below.
    let existing: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT folder_path FROM chapters WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let result: HashSet<String> = stmt
            .query_map(params![project_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            // Normalise all stored paths to forward slashes before comparison,
            // matching what normalize_path() produces when scanning disk.
            .map(|p: String| normalize_path(Path::new(&p)))
            .collect();
        result // the last expression in a block is the block's return value
    };

    // Find subdirectories on disk that aren't in the DB yet.
    let mut new_dirs: Vec<_> = std::fs::read_dir(root_path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| {
            !existing.contains(&normalize_path(&e.path())) // keep only folders not already in the DB
        })
        .collect();
    new_dirs.sort_by_key(|e| e.file_name());

    let inserted_any = !new_dirs.is_empty();

    // Insert the new subdirectories as chapters, appended after the existing ones.
    if inserted_any {
        // Find the current highest sort_order so we can append after it.
        let max_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM chapters WHERE project_id = ?1",
                params![project_id],
                |r| r.get(0),
            )
            .unwrap_or(-1);

        for (i, entry) in new_dirs.iter().enumerate() {
            let folder_path = normalize_path(&entry.path());
            let display_name = entry.file_name().to_string_lossy().to_string();
            let chapter_id = Uuid::new_v4().to_string();
            let image_count = count_images_in_dir(&entry.path());

            conn.execute(
                "INSERT INTO chapters (id, project_id, folder_path, display_name, sort_order, image_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    chapter_id, project_id, folder_path, display_name,
                    max_order + 1 + i as i64, image_count
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(inserted_any)
}

// Deletes chapters whose folder_path no longer exists on disk. The DB schema's
// ON DELETE CASCADE takes care of that chapter's excluded_images rows too.
// Shared by `get_project_chapters` (rescan on open) and the library watcher in
// `watch.rs` (rescan on filesystem change), mirroring `insert_new_chapters`.
// Returns whether any chapters were removed, so callers can decide whether to
// notify the frontend.
pub(crate) fn remove_missing_chapters(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<bool, String> {
    let chapters: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, folder_path FROM chapters WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String)> = stmt
            .query_map(params![project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    let missing_ids: Vec<String> = chapters
        .into_iter()
        .filter(|(_, folder_path)| !Path::new(folder_path).is_dir())
        .map(|(id, _)| id)
        .collect();

    let removed_any = !missing_ids.is_empty();

    for id in &missing_ids {
        conn.execute("DELETE FROM chapters WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }

    Ok(removed_any)
}

// Returns all chapters for a project, ordered by sort_order.
// Also rescans the project's root folder: new subdirectories are inserted as chapters,
// and chapters whose folder was deleted on disk are removed from the DB.
#[tauri::command]
pub fn get_project_chapters(
    project_id: String,
    state: tauri::State<DbState>,
) -> Result<Vec<Chapter>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Look up the root folder so we can rescan it.
    let root_path: String = conn
        .query_row(
            "SELECT root_path FROM projects WHERE id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    insert_new_chapters(&conn, &project_id, &root_path)?;
    remove_missing_chapters(&conn, &project_id)?;

    // Query all chapters (including any just inserted) in sort order.
    // The subquery counts excluded images inline so the frontend gets the badge count
    // without needing a second request.
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.project_id, c.folder_path, c.display_name, c.sort_order,
                    c.image_count,
                    (SELECT COUNT(*) FROM excluded_images ei WHERE ei.chapter_id = c.id) as excluded_count
             FROM chapters c
             WHERE c.project_id = ?1
             ORDER BY c.sort_order ASC",
        )
        .map_err(|e| e.to_string())?;

    let chapters = stmt
        .query_map(params![project_id], |row| {
            Ok(Chapter {
                id: row.get(0)?,
                project_id: row.get(1)?,
                folder_path: row.get(2)?,
                display_name: row.get(3)?,
                sort_order: row.get(4)?,
                image_count: row.get(5)?,
                excluded_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(chapters)
}
