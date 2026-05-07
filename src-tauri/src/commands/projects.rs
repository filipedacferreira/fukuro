use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

use crate::db::DbState;
use crate::commands::images::is_image_file;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub root_path: String,
    pub name: String,
    pub created_at: i64,
    pub chapter_count: i64,
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
        .unwrap_or(0)
}

#[tauri::command]
pub fn create_project(root_path: String, state: tauri::State<DbState>) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root_path));
    }

    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

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

    let mut entries: Vec<_> = std::fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();

    entries.sort_by_key(|e| e.file_name());

    for (i, entry) in entries.iter().enumerate() {
        let folder_path = entry.path().to_string_lossy().to_string();
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
    })
}

#[tauri::command]
pub fn list_projects(state: tauri::State<DbState>) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.root_path, p.name, p.created_at, COUNT(c.id) as chapter_count
             FROM projects p
             LEFT JOIN chapters c ON c.project_id = p.id
             GROUP BY p.id
             ORDER BY p.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                root_path: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                chapter_count: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

#[tauri::command]
pub fn delete_project(id: String, state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_project_chapters(
    project_id: String,
    state: tauri::State<DbState>,
) -> Result<Vec<Chapter>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

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
