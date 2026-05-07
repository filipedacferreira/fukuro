use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

use crate::db::DbState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMeta {
    pub path: String,
    pub filename: String,
    pub is_excluded: bool,
}

pub fn is_image_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("jpg") | Some("jpeg") | Some("png") | Some("webp") | Some("gif") | Some("avif")
    )
}

pub fn natural_sort_key(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_num = false;

    for c in s.chars() {
        if c.is_ascii_digit() {
            if !in_num {
                if !current.is_empty() {
                    parts.push(current.clone());
                    current.clear();
                }
                in_num = true;
            }
            current.push(c);
        } else {
            if in_num {
                parts.push(format!("{:0>20}", current));
                current.clear();
                in_num = false;
            }
            current.push(c);
        }
    }
    if !current.is_empty() {
        if in_num {
            parts.push(format!("{:0>20}", current));
        } else {
            parts.push(current);
        }
    }
    parts
}

#[tauri::command]
pub fn get_chapter_images(
    chapter_id: String,
    state: tauri::State<DbState>,
) -> Result<Vec<ImageMeta>, String> {
    let (folder_path, excluded) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;

        let folder_path: String = conn
            .query_row(
                "SELECT folder_path FROM chapters WHERE id = ?1",
                params![chapter_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let excluded: HashSet<String> = {
            let mut stmt = conn
                .prepare("SELECT image_path FROM excluded_images WHERE chapter_id = ?1")
                .map_err(|e| e.to_string())?;
            let result: HashSet<String> = stmt
                .query_map(params![chapter_id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            result
        };

        (folder_path, excluded)
    };

    let mut images: Vec<ImageMeta> = std::fs::read_dir(&folder_path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().map(|t| t.is_file()).unwrap_or(false)
                && is_image_file(e.path().as_path())
        })
        .map(|e| {
            let path = e.path().to_string_lossy().to_string();
            let filename = e.file_name().to_string_lossy().to_string();
            let is_excluded = excluded.contains(&path);
            ImageMeta { path, filename, is_excluded }
        })
        .collect();

    images.sort_by(|a, b| {
        let ka = natural_sort_key(&a.filename);
        let kb = natural_sort_key(&b.filename);
        ka.cmp(&kb)
    });

    Ok(images)
}

#[tauri::command]
pub fn toggle_exclusion(
    chapter_id: String,
    image_path: String,
    state: tauri::State<DbState>,
) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM excluded_images WHERE chapter_id = ?1 AND image_path = ?2",
            params![chapter_id, image_path],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0;

    if exists {
        conn.execute(
            "DELETE FROM excluded_images WHERE chapter_id = ?1 AND image_path = ?2",
            params![chapter_id, image_path],
        )
        .map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        conn.execute(
            "INSERT INTO excluded_images (chapter_id, image_path) VALUES (?1, ?2)",
            params![chapter_id, image_path],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn hard_delete_image(
    chapter_id: String,
    path: String,
    state: tauri::State<DbState>,
) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM excluded_images WHERE chapter_id = ?1 AND image_path = ?2",
        params![chapter_id, path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
