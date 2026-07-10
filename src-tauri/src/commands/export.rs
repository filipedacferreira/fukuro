use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::HashSet;
use std::io::Write;
use tauri::Manager;

use crate::db::DbState;
use crate::utils::{is_image_file, natural_sort_key, normalize_path, now_unix};

// Events streamed through the Tauri Channel during CBZ export.
// `tag = "type"` serialises as `{ "type": "progress", ... }` so the frontend
// can discriminate on the `type` field without a separate wrapper.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum ExportEvent {
    Progress { current: u32, total: u32 },
    Done { output_path: String },
    Error { message: String },
}

// Everything needed to build a project's .cbz: its cover (if any) and each chapter's folder
// path + excluded-image set, already in export order. Split out from `create_cbz` so
// `sync_project_to_kobo` (commands/kobo.rs) can gather the same data — Kobo sync re-exports
// internally when the local file is missing/stale, and needs the exact same source data
// `create_cbz` would use.
pub(crate) struct CbzSource {
    pub cover_path: Option<String>,
    pub chapters: Vec<(String, HashSet<String>)>,
}

// Phase 1: reads everything `write_cbz_archive` needs from the DB. Kept separate from the
// zip-writing phase so callers can release the DB lock before the (potentially slow) zip
// write — see `create_cbz`'s comment on why that matters.
pub(crate) fn collect_cbz_source(conn: &Connection, project_id: &str) -> Result<CbzSource, String> {
    let cover_path: Option<String> = conn
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
    let chapters = chapter_rows
        .into_iter()
        .map(|(chapter_id, folder_path)| {
            let excluded: HashSet<String> = {
                // We use .unwrap() here instead of ? because we're inside a closure
                // passed to .map(), and closures used with map() cannot propagate
                // errors with ?. prepare() failing here would be a bug (invalid SQL),
                // not a runtime error, so panicking is acceptable.
                let mut stmt = conn
                    .prepare("SELECT image_path FROM excluded_images WHERE chapter_id = ?1")
                    .unwrap();
                stmt.query_map(params![chapter_id], |row| row.get(0))
                    .unwrap()
                    .filter_map(|r| r.ok()) // silently skip any rows that fail to deserialise
                    .map(|p: String| normalize_path(std::path::Path::new(&p)))
                    .collect()
            };
            (folder_path, excluded)
        })
        .collect();

    Ok(CbzSource { cover_path, chapters })
}

// Phase 2: writes `source` out to `output_path` as a .cbz, calling `on_progress(current,
// total)` after the cover (if any) and after each page. Shared by `create_cbz`'s background
// thread and `sync_project_to_kobo`'s (commands/kobo.rs) — both write the exact same file,
// they just report progress through differently-shaped event channels, so this returns a
// plain Result instead of sending events itself.
//
// CBZ is just a ZIP file with images inside. CBZ readers display images alphabetically
// by entry name, so we use zero-padded sequential names (0000.jpg, 0001.jpg, ...)
// across all chapters to ensure correct page order regardless of original filenames.
//
// If the project has a cover image, it is written as 0000.jpg and chapter pages
// start at 0001.jpg so the cover sorts first in every CBZ reader.
pub(crate) fn write_cbz_archive(
    source: &CbzSource,
    output_path: &str,
    mut on_progress: impl FnMut(u32, u32),
) -> Result<(), String> {
    // Count total images upfront so callers can show a progress bar.
    let mut all_images: Vec<std::path::PathBuf> = Vec::new();

    for (folder_path, excluded) in &source.chapters {
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

        all_images.extend(images);
    }

    let cover_count = source
        .cover_path
        .as_ref()
        .map(|p| if std::path::Path::new(p).exists() { 1u32 } else { 0 })
        .unwrap_or(0);
    let total = all_images.len() as u32 + cover_count;

    let file = std::fs::File::create(output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);

    // Stored = no compression. CBZ readers memory-map the file for fast page seeks,
    // and re-compressing already-compressed JPEGs would only waste CPU with no size benefit.
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o644);

    // If the project has a cover, write it as 0000.jpg and start pages at 0001.
    // cover_path must point to an existing file — if it doesn't (e.g. deleted externally),
    // we skip it silently and fall back to starting pages at 0000.
    let mut global_index: u32 = if let Some(ref path) = source.cover_path {
        let cover_file = std::path::Path::new(path);
        if cover_file.exists() {
            // Chain three fallible operations into a single Result:
            //   1. start_file() — add a new entry to the ZIP
            //   2. and_then(|_| fs::read(...)) — discard the () from start_file, read the file bytes
            //   3. and_then(|data| write_all(...)) — write those bytes into the ZIP entry
            // If any step fails, the chain short-circuits and returns the first Err.
            zip.start_file("0000.jpg", options)
                .map_err(|e| e.to_string())
                .and_then(|_| std::fs::read(cover_file).map_err(|e| e.to_string()))
                .and_then(|data| zip.write_all(&data).map_err(|e| e.to_string()))?;
            on_progress(1, total);
            1 // pages start at 0001
        } else {
            0
        }
    } else {
        0
    };

    for image_path in &all_images {
        // Preserve the original extension (jpg, png, webp, etc.).
        let ext = image_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");

        // {:04} zero-pads to 4 digits: 0000, 0001, ..., 9999.
        // This ensures alphabetical sort in the CBZ reader matches page order.
        let entry_name = format!("{:04}.{}", global_index, ext);

        zip.start_file(&entry_name, options)
            .map_err(|e| e.to_string())
            .and_then(|_| std::fs::read(image_path).map_err(|e| e.to_string()))
            .and_then(|data| zip.write_all(&data).map_err(|e| e.to_string()))?;

        global_index += 1;
        on_progress(global_index, total);
    }

    // Finalise the ZIP file (writes the central directory at the end of the file).
    zip.finish().map_err(|e| e.to_string())?;

    Ok(())
}

// Produces a .cbz file from all non-excluded images across all chapters, in sort order, and
// records the export in `last_export_path`/`last_exported_at` (Export history) so the
// project list can show "Last exported: X days ago" and Kobo sync can tell a fresh export
// apart from a stale one.
//
// Returns Ok(()) immediately — all heavy work runs in a detached background thread.
// Progress and the final result are streamed back through on_event.
#[tauri::command]
pub fn create_cbz(
    project_id: String,
    output_path: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
    on_event: tauri::ipc::Channel<ExportEvent>,
) -> Result<(), String> {
    // Read from the DB while holding the lock, then release it before spawning the thread —
    // the zip write can take several seconds for large projects, and we don't want to block
    // other commands.
    let source = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        collect_cbz_source(&conn, &project_id)?
    };

    if source.chapters.is_empty() {
        let _ = on_event.send(ExportEvent::Error {
            message: "No chapters found for this project".to_string(),
        });
        return Ok(());
    }

    // `move` transfers ownership of all captured variables into the thread. `app_handle` is
    // `Clone` + `'static` (unlike `tauri::State`, which can't cross a thread boundary), so it's
    // how the thread reaches the DB again once the zip write finishes.
    std::thread::spawn(move || {
        let result = write_cbz_archive(&source, &output_path, |current, total| {
            let _ = on_event.send(ExportEvent::Progress { current, total });
        });

        match result {
            Ok(()) => {
                if let Ok(conn) = app_handle.state::<DbState>().0.lock() {
                    let _ = conn.execute(
                        "UPDATE projects SET last_export_path = ?1, last_exported_at = ?2 WHERE id = ?3",
                        params![output_path, now_unix(), project_id],
                    );
                }
                let _ = on_event.send(ExportEvent::Done { output_path });
            }
            Err(message) => {
                let _ = on_event.send(ExportEvent::Error { message });
            }
        }
    });

    // Return Ok(()) immediately — the thread is running in the background.
    Ok(())
}
