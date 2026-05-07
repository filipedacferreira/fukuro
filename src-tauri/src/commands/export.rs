use rusqlite::params;
use std::collections::HashSet;
use std::io::Write;

use crate::commands::images::{is_image_file, natural_sort_key};
use crate::db::DbState;

#[tauri::command]
pub fn create_cbz(
    project_id: String,
    output_path: String,
    state: tauri::State<DbState>,
) -> Result<String, String> {
    // Collect all data while holding the lock, then release before doing I/O
    let chapters_data: Vec<(String, HashSet<String>)> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;

        let chapter_rows: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT c.id, c.folder_path FROM chapters c
                     WHERE c.project_id = ?1
                     ORDER BY c.sort_order ASC",
                )
                .map_err(|e| e.to_string())?;
            let result: Vec<(String, String)> = stmt
                .query_map(params![project_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            result
        };

        chapter_rows
            .into_iter()
            .map(|(chapter_id, folder_path)| {
                let excluded: HashSet<String> = {
                    let mut stmt = conn
                        .prepare(
                            "SELECT image_path FROM excluded_images WHERE chapter_id = ?1",
                        )
                        .unwrap();
                    stmt.query_map(params![chapter_id], |row| row.get(0))
                        .unwrap()
                        .filter_map(|r| r.ok())
                        .collect()
                };
                (folder_path, excluded)
            })
            .collect()
    }; // lock released here

    if chapters_data.is_empty() {
        return Err("No chapters found for this project".to_string());
    }

    let file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o644);

    let mut global_index: u32 = 0;

    for (folder_path, excluded) in &chapters_data {
        let mut images: Vec<std::path::PathBuf> = std::fs::read_dir(folder_path)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().map(|t| t.is_file()).unwrap_or(false)
                    && is_image_file(e.path().as_path())
                    && !excluded.contains(&e.path().to_string_lossy().to_string())
            })
            .map(|e| e.path())
            .collect();

        images.sort_by(|a, b| {
            let ka = natural_sort_key(a.file_name().and_then(|n| n.to_str()).unwrap_or(""));
            let kb = natural_sort_key(b.file_name().and_then(|n| n.to_str()).unwrap_or(""));
            ka.cmp(&kb)
        });

        for image_path in images {
            let ext = image_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("jpg");
            let entry_name = format!("{:04}.{}", global_index, ext);

            zip.start_file(entry_name, options).map_err(|e| e.to_string())?;
            let data = std::fs::read(&image_path).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;

            global_index += 1;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;

    Ok(output_path)
}
