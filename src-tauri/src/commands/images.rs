use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::Manager;

use crate::db::DbState;
use crate::utils::{is_image_file, natural_sort_key, normalize_path};

// Returned by get_chapter_images for each image file found in a chapter folder.
// Both `path` and `thumbnail_path` are absolute filesystem paths.
// `thumbnail_path` equals `path` when no cached thumbnail exists yet (original used as fallback).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMeta {
    pub path: String,
    pub thumbnail_path: String,
    pub filename: String,
    pub is_excluded: bool,
}

// Returns all image files in a chapter folder, annotated with exclusion state
// and their cached thumbnail path (if one exists).
// Does NOT generate thumbnails — call generate_chapter_thumbnails_stream for that.
#[tauri::command]
pub fn get_chapter_images(
    chapter_id: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<ImageMeta>, String> {
    // Acquire the DB lock only long enough to read the folder path and exclusion list,
    // then release it before doing any disk I/O.
    let (folder_path, excluded) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;

        let folder_path: String = conn
            .query_row(
                "SELECT folder_path FROM chapters WHERE id = ?1",
                params![chapter_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        // Load all excluded image paths into a HashSet so we can check membership in O(1).
        let excluded: HashSet<String> = {
            let mut stmt = conn
                .prepare("SELECT image_path FROM excluded_images WHERE chapter_id = ?1")
                .map_err(|e| e.to_string())?;
            let result: HashSet<String> = stmt
                .query_map(params![chapter_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .map(|p: String| normalize_path(Path::new(&p)))
                .collect();
            result
        };

        (folder_path, excluded) // lock is released when this block ends
    };

    // Determine where thumbnails for this chapter are cached.
    let thumb_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails")
        .join(&chapter_id);

    // Read the chapter folder, filter to image files, and build ImageMeta for each.
    let mut images: Vec<ImageMeta> = std::fs::read_dir(&folder_path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()) // skip entries we can't read
        .filter(|e| {
            e.file_type().map(|t| t.is_file()).unwrap_or(false)
                && is_image_file(e.path().as_path())
        })
        .map(|e| {
            let path = normalize_path(&e.path());
            let filename = e.file_name().to_string_lossy().to_string();
            let is_excluded = excluded.contains(&path);

            // Compute the expected thumbnail path from the filename stem.
            // e.g. "001.png" → "{thumb_dir}/001.jpg"
            let stem = Path::new(&filename)
                .file_stem()          // returns Option<&OsStr> — None only for hidden files like ".foo"
                .unwrap_or_default()  // OsStr::default() is an empty OsStr, safe fallback
                .to_string_lossy()    // converts OsStr to Cow<str> (borrowed if valid UTF-8, owned if not)
                .into_owned();        // converts Cow<str> to an owned String we can store and move
            let thumb = thumb_dir.join(format!("{stem}.jpg"));

            // If the thumbnail exists, return its path. Otherwise fall back to the original
            // so the frontend can show a blurred preview while generation runs.
            let thumbnail_path = if thumb.exists() {
                normalize_path(&thumb)
            } else {
                path.clone()
            };

            ImageMeta { path, thumbnail_path, filename, is_excluded }
        })
        .collect();

    // Sort using natural sort so filenames with numbers order correctly.
    images.sort_by(|a, b| {
        let ka = natural_sort_key(&a.filename);
        let kb = natural_sort_key(&b.filename);
        // Vec<String> implements Ord, so .cmp() does lexicographic comparison segment by segment.
        // It returns std::cmp::Ordering::{Less, Equal, Greater}, which sort_by uses to rank the pair.
        ka.cmp(&kb)
    });

    Ok(images)
}

// Toggles an image's exclusion state. Returns the new state (true = excluded).
// The frontend uses optimistic updates — it flips the UI immediately and calls this
// in the background. On error, it reverts.
#[tauri::command]
pub fn toggle_exclusion(
    chapter_id: String,
    image_path: String,
    state: tauri::State<DbState>,
) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Check if a row already exists for this image.
    // We use COUNT(*) > 0 rather than an EXISTS subquery because rusqlite's
    // query_row always expects exactly one result row, which COUNT(*) guarantees.
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM excluded_images WHERE chapter_id = ?1 AND image_path = ?2",
            params![chapter_id, image_path],
            |row| row.get::<_, i64>(0), // extract the count as i64
        )
        .map_err(|e| e.to_string())?
        > 0; // convert the count to a bool: 0 → false, anything else → true

    if exists {
        // Already excluded → remove the row (include it again).
        conn.execute(
            "DELETE FROM excluded_images WHERE chapter_id = ?1 AND image_path = ?2",
            params![chapter_id, image_path],
        )
        .map_err(|e| e.to_string())?;
        Ok(false) // new state: included
    } else {
        // Not excluded → insert a row.
        conn.execute(
            "INSERT INTO excluded_images (chapter_id, image_path) VALUES (?1, ?2)",
            params![chapter_id, image_path],
        )
        .map_err(|e| e.to_string())?;
        Ok(true) // new state: excluded
    }
}

// Permanently deletes an image file from disk, its cached thumbnail, and its exclusion row.
// image_count in the chapters table is intentionally NOT updated here — it was cached at
// scan time and the frontend tracks the live count in component state.
#[tauri::command]
pub fn hard_delete_image(
    chapter_id: String,
    path: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Delete the original file from disk first.
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;

    // Delete the thumbnail from cache, if one exists.
    let filename = Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let stem = Path::new(&filename)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        let thumb = data_dir
            .join("thumbnails")
            .join(&chapter_id)
            .join(format!("{stem}.jpg"));
        let _ = std::fs::remove_file(thumb); // ignore error if thumbnail didn't exist
    }

    // Remove the exclusion row if this image was marked excluded.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM excluded_images WHERE chapter_id = ?1 AND image_path = ?2",
        params![chapter_id, path],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
