use std::path::Path;
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::params;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::projects::{insert_new_chapters, remove_missing_chapters};
use crate::db::DbState;

// Holds the single active filesystem watcher, if any. Only one project's chapter list
// is ever open in the editor at a time, so we don't need a map keyed by project — just
// the current watcher (dropping a `RecommendedWatcher` stops it, which is how
// `stop_watching_project` and re-calling `start_watching_project` tear the old one down).
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

// Starts watching a project's root folder for new chapter subfolders while the editor
// is open. Any prior watcher is dropped first, since only one project is watched at once.
// On a filesystem `Create` event, the handler rescans the root (reusing the same
// dedup-by-folder_path logic as `get_project_chapters`) and, if new chapters were
// inserted, emits a `chapters-updated` event so the frontend can refresh without a
// manual reload.
#[tauri::command]
pub fn start_watching_project(
    project_id: String,
    app: AppHandle,
    db_state: tauri::State<DbState>,
    watcher_state: tauri::State<WatcherState>,
) -> Result<(), String> {
    let root_path: String = {
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT root_path FROM projects WHERE id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    // `move` closures can't be reused across threads, and the watcher's callback runs on
    // notify's own background thread — clone what it needs before handing it over.
    let app_for_handler = app.clone();
    let project_id_for_handler = project_id.clone();
    let root_path_for_handler = root_path.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        // We only care about folders appearing or disappearing — ignore modify/access
        // events. notify's Windows backend reports generic `Create(CreateKind::Any)` /
        // `Remove(RemoveKind::Any)` rather than distinguishing files from folders, so we
        // match on the outer variant and let `insert_new_chapters` / `remove_missing_chapters`
        // (which read the actual directory listing / check disk state) sort out whether
        // anything relevant actually changed.
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Remove(_)) {
            return;
        }

        let db_state = app_for_handler.state::<DbState>();
        let Ok(conn) = db_state.0.lock() else { return };

        let inserted =
            insert_new_chapters(&conn, &project_id_for_handler, &root_path_for_handler)
                .unwrap_or(false);
        let removed =
            remove_missing_chapters(&conn, &project_id_for_handler).unwrap_or(false);

        if inserted || removed {
            let _ = app_for_handler.emit("chapters-updated", &project_id_for_handler);
        }
    })
    .map_err(|e| e.to_string())?;

    // NonRecursive: we only care about subfolders appearing directly under the project
    // root, not changes deep inside existing chapter folders.
    watcher
        .watch(Path::new(&root_path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(watcher); // dropping the previous watcher (if any) stops it

    Ok(())
}

// Stops the active watcher, if any. Called when the editor closes so we don't keep
// watching a folder the user has navigated away from.
#[tauri::command]
pub fn stop_watching_project(watcher_state: tauri::State<WatcherState>) -> Result<(), String> {
    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *guard = None; // Drop stops the watcher
    Ok(())
}
