use std::path::Path;
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::projects::{
    insert_new_chapters, insert_new_projects, query_all_projects, remove_missing_chapters,
    remove_missing_projects,
};
use crate::commands::settings::read_library_root;
use crate::db::DbState;
use crate::utils::normalize_path;

// Holds the single active filesystem watcher, if any. The whole app only ever watches
// one library root at a time, so we don't need a map keyed by project — just the current
// watcher (dropping a `RecommendedWatcher` stops it, which is how `start_library_watcher`
// tears down the previous one when the root changes).
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

// (Re)starts the single library-root watcher. Called once at app launch (if a library
// root is already configured, see lib.rs `setup()`) and again whenever `set_library_root`
// points the app at a new root.
//
// Watches the library root recursively — on Windows this uses ReadDirectoryChangesW's
// recursive mode, which automatically covers newly-created subfolders at any depth
// without re-registering. So a single `watch()` call covers both levels we care about:
// the manga level (the root's immediate children) and the chapter level (each manga's
// immediate children). The event handler below uses each event path's *parent directory*
// to figure out which of those two levels actually changed, and ignores anything deeper
// (e.g. an image file appearing inside a chapter folder) — the recursive watch will fire
// events for those too, but they simply don't match either level and are dropped.
pub fn start_library_watcher(app: &AppHandle) -> Result<(), String> {
    let watcher_state = app.state::<WatcherState>();

    let library_root = {
        let db_state = app.state::<DbState>();
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        read_library_root(&conn)?
    };

    let Some(library_root) = library_root else {
        // Nothing configured (yet, or not anymore) — make sure no stale watcher lingers.
        let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
        *guard = None;
        return Ok(());
    };

    // `move` closures can't be reused across threads, and the watcher's callback runs on
    // notify's own background thread — clone what it needs before handing it over.
    let app_for_handler = app.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        // We only care about folders appearing or disappearing — ignore modify/access
        // events. notify's Windows backend reports generic `Create(CreateKind::Any)` /
        // `Remove(RemoveKind::Any)` rather than distinguishing files from folders, so we
        // match on the outer variant and let the insert/remove helpers (which read the
        // actual directory listing / check disk state) sort out whether anything relevant
        // actually changed.
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Remove(_)) {
            return;
        }

        let db_state = app_for_handler.state::<DbState>();
        let Ok(conn) = db_state.0.lock() else { return };

        // Re-read the library root and project list on every event rather than capturing
        // them once — both can change over the watcher's lifetime (a root switch drops
        // this whole watcher anyway, but projects are added/removed constantly), and a
        // DB read is cheap next to the filesystem rescans it gates.
        let Ok(Some(library_root)) = read_library_root(&conn) else { return };
        let normalized_root = normalize_path(Path::new(&library_root));

        let Ok(mut stmt) = conn.prepare("SELECT id, root_path FROM projects") else { return };
        let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        else {
            return;
        };
        let project_roots: Vec<(String, String)> = rows.filter_map(|r| r.ok()).collect();
        drop(stmt);

        for path in &event.paths {
            let Some(parent) = path.parent() else { continue };
            let normalized_parent = normalize_path(parent);

            if normalized_parent == normalized_root {
                // A manga folder appeared or disappeared directly under the library root.
                let new_projects = insert_new_projects(&conn, &library_root).unwrap_or_default();
                let removed = remove_missing_projects(&conn, &app_for_handler).unwrap_or(false);
                if !new_projects.is_empty() || removed {
                    if let Ok(projects) = query_all_projects(&conn) {
                        let _ = app_for_handler.emit("projects-updated", projects);
                    }
                }
                // Kick off an automatic cover lookup for each newly-discovered project —
                // see cover.rs::spawn_auto_cover_lookup for why this is fire-and-forget.
                for (project_id, name) in new_projects {
                    crate::commands::cover::spawn_auto_cover_lookup(&app_for_handler, project_id, name);
                }
                continue;
            }

            if let Some((project_id, project_root)) = project_roots
                .iter()
                .find(|(_, root)| normalize_path(Path::new(root)) == normalized_parent)
            {
                // A chapter folder appeared or disappeared directly under one manga's folder.
                let inserted =
                    insert_new_chapters(&conn, project_id, project_root).unwrap_or(false);
                let removed = remove_missing_chapters(&conn, project_id).unwrap_or(false);
                if inserted || removed {
                    let _ = app_for_handler.emit("chapters-updated", project_id);
                }
            }

            // Anything else (e.g. an image file inside a chapter folder) is deeper than
            // the two levels we track — ignored.
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&library_root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(watcher); // dropping the previous watcher (if any) stops it

    Ok(())
}
