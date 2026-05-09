use rusqlite::params;
use std::collections::HashSet;
use std::io::Write;

use crate::db::DbState;
use crate::utils::{is_image_file, natural_sort_key, normalize_path};

// Produces a .cbz file from all non-excluded images across all chapters, in sort order.
//
// CBZ is just a ZIP file with images inside. CBZ readers display images alphabetically
// by entry name, so we use zero-padded sequential names (0000.jpg, 0001.jpg, ...)
// across all chapters to ensure correct page order regardless of original filenames.
//
// If the project has a cover image, it is written as 0000.jpg and chapter pages
// start at 0001.jpg so the cover sorts first in every CBZ reader.
#[tauri::command]
pub fn create_cbz(
    project_id: String,
    output_path: String,
    state: tauri::State<DbState>,
) -> Result<String, String> {
    // Phase 1: collect all data from the DB while holding the lock.
    // We release the lock before touching the filesystem — the zip write can take
    // several seconds for large projects, and we don't want to block other commands.
    let cover_path: Option<String>;
    let chapters_data: Vec<(String, HashSet<String>)>;

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;

        cover_path = conn
            .query_row(
                "SELECT cover_path FROM projects WHERE id = ?1",
                params![project_id],
                |r| r.get(0),
            )
            .unwrap_or(None);

        // Load chapters in sort_order so pages end up in the right sequence.
        let chapter_rows: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT c.id, c.folder_path FROM chapters c
                     WHERE c.project_id = ?1
                     ORDER BY c.sort_order ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, String)> = stmt
                .query_map(params![project_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        // For each chapter, load its excluded image paths into a HashSet.
        // We transform Vec<(chapter_id, folder_path)> → Vec<(folder_path, excluded_set)>
        // because that's all we need for the zip phase.
        chapters_data = chapter_rows
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
                        .map(|p: String| normalize_path(std::path::Path::new(&p)))
                        .collect()
                };
                (folder_path, excluded)
            })
            .collect();
    } // DB lock released here

    if chapters_data.is_empty() {
        return Err("No chapters found for this project".to_string());
    }

    // Phase 2: write the ZIP archive.
    let file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);

    // Stored = no compression. CBZ readers memory-map the file for fast page seeks,
    // and re-compressing already-compressed JPEGs would only waste CPU with no size benefit.
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o644);

    // If the project has a cover, write it as 0000.jpg and start pages at 0001.
    // cover_path must point to an existing file — if it doesn't (e.g. deleted externally),
    // we skip it silently and fall back to starting pages at 0000.
    let mut global_index: u32 = if let Some(ref path) = cover_path {
        let cover_file = std::path::Path::new(path);
        if cover_file.exists() {
            zip.start_file("0000.jpg", options).map_err(|e| e.to_string())?;
            let data = std::fs::read(cover_file).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
            1 // pages start at 0001
        } else {
            0
        }
    } else {
        0
    };

    for (folder_path, excluded) in &chapters_data {
        // Collect, filter, and sort images for this chapter.
        let mut images: Vec<std::path::PathBuf> = std::fs::read_dir(folder_path)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().map(|t| t.is_file()).unwrap_or(false)
                    && is_image_file(e.path().as_path())
                    && !excluded.contains(&normalize_path(&e.path()))
            })
            .map(|e| e.path())
            .collect();

        // Natural sort so pages within a chapter are in the right order.
        images.sort_by(|a, b| {
            let ka = natural_sort_key(a.file_name().and_then(|n| n.to_str()).unwrap_or(""));
            let kb = natural_sort_key(b.file_name().and_then(|n| n.to_str()).unwrap_or(""));
            ka.cmp(&kb)
        });

        for image_path in images {
            // Preserve the original extension (jpg, png, webp, etc.).
            let ext = image_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("jpg");

            // {:04} zero-pads to 4 digits: 0000, 0001, ..., 9999.
            // This ensures alphabetical sort in the CBZ reader matches page order.
            let entry_name = format!("{:04}.{}", global_index, ext);

            // start_file creates a new entry in the ZIP archive.
            zip.start_file(entry_name, options)
                .map_err(|e| e.to_string())?;

            // Read the image bytes and write them directly — no re-encoding.
            let data = std::fs::read(&image_path).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;

            global_index += 1;
        }
    }

    // Finalise the ZIP file (writes the central directory at the end of the file).
    zip.finish().map_err(|e| e.to_string())?;

    // Return the output path so the frontend can display it in the success toast.
    Ok(output_path)
}
