use rusqlite::params;

use crate::db::DbState;

// Receives the full ordered list of chapter IDs from the frontend after a drag-and-drop.
// Assigns each one a new sort_order equal to its position in the array (0-based).
#[tauri::command]
pub fn reorder_chapters(
    chapter_ids: Vec<String>,
    state: tauri::State<DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // enumerate() gives us (index, value) pairs — `i` becomes the new sort_order.
    for (i, id) in chapter_ids.iter().enumerate() {
        conn.execute(
            "UPDATE chapters SET sort_order = ?1 WHERE id = ?2",
            // rusqlite uses ?1, ?2, ... placeholders (1-based).
            // params![] maps them positionally: ?1 = i, ?2 = id.
            params![i as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Updates only the display label — never touches the folder name on disk.
#[tauri::command]
pub fn rename_chapter(
    id: String,
    name: String,
    state: tauri::State<DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapters SET display_name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
