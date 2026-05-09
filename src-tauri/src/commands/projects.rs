use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

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
    pub anilist_id: Option<i64>,
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

// Scans the selected root folder for subdirectories, creates a project in the DB,
// and inserts one chapter row per subdirectory.
// The initial sort_order is alphabetical by folder name — a sensible first guess.
#[tauri::command]
pub fn create_project(
    root_path: String,
    state: tauri::State<DbState>,
) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root_path));
    }

    // Derive the project name from the folder name (the last segment of the path).
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // Uuid::new_v4() generates a random unique ID — no collision risk.
    let project_id = Uuid::new_v4().to_string();

    // Unix timestamp in seconds — used for "created_at" ordering on the home screen.
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    conn.execute(
        "INSERT INTO projects (id, root_path, name, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![project_id, root_path, name, created_at],
    )
    .map_err(|e| e.to_string())?;

    // Collect all immediate subdirectories and sort them by name.
    let mut entries: Vec<_> = std::fs::read_dir(root)
        .map_err(|e| e.to_string())?
        // filter_map(|e| e.ok()) combines filter + map: it calls e.ok() on each item,
        // keeps only the Some(...) results, and unwraps them. Items that return None
        // (e.g. entries we don't have permission to read) are silently skipped.
        .filter_map(|e| e.ok())
        // file_type() returns a Result, so we map it to a bool and default to false
        // if it fails — this silently excludes entries whose type we can't determine.
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();

    entries.sort_by_key(|e| e.file_name());

    // Insert one chapter row per subdirectory.
    for (i, entry) in entries.iter().enumerate() {
        // Normalise to forward slashes so paths are consistent across Windows and macOS.
        let folder_path = normalize_path(&entry.path());
        let display_name = entry.file_name().to_string_lossy().to_string();
        let chapter_id = Uuid::new_v4().to_string();
        let image_count = count_images_in_dir(&entry.path());

        conn.execute(
            "INSERT INTO chapters (id, project_id, folder_path, display_name, sort_order, image_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![chapter_id, project_id, folder_path, display_name, i as i64, image_count],
        )
        .map_err(|e| e.to_string())?;
    }

    // Count the inserted chapters to return an accurate `chapterCount` to the frontend.
    let chapter_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(Project {
        id: project_id,
        root_path,
        name,
        created_at,
        chapter_count,
        cover_path: None,
        anilist_id: None,
    })
}

// Returns all projects ordered newest-first.
// Uses a LEFT JOIN so projects with zero chapters still appear.
#[tauri::command]
pub fn list_projects(state: tauri::State<DbState>) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.root_path, p.name, p.created_at, COUNT(c.id) as chapter_count,
                    p.cover_path, p.anilist_id
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
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

// Deletes a project row. The DB schema has ON DELETE CASCADE, so all related
// chapters and excluded_images rows are automatically removed too.
#[tauri::command]
pub fn delete_project(id: String, state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
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

// Returns all chapters for a project, ordered by sort_order.
// Also rescans the project's root folder for any new subdirectories added since the
// project was created, inserting them as new chapters at the end of the list.
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
    let mut new_dirs: Vec<_> = std::fs::read_dir(&root_path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| {
            !existing.contains(&normalize_path(&e.path())) // keep only folders not already in the DB
        })
        .collect();
    new_dirs.sort_by_key(|e| e.file_name());

    // Insert the new subdirectories as chapters, appended after the existing ones.
    if !new_dirs.is_empty() {
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
