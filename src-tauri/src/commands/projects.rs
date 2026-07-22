use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::commands::settings::read_library_root;
use crate::db::DbState;
use crate::utils::{extract_chapter_number, is_image_file, natural_sort_key, normalize_path};

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
    pub cover_thumbnail_path: Option<String>,
    pub anilist_id: Option<i64>,
    pub cover_title: Option<String>,
    // Where/when the user's own "Export CBZ" file was last written (Export history) — set by
    // `create_cbz`, cleared together by `list_projects` if that file is deleted externally
    // (see `clear_stale_export_paths` below).
    pub last_export_path: Option<String>,
    pub last_exported_at: Option<i64>,
    // Kobo sync's own state: when its independent AppData cache was last (re)written, and
    // when that cache was last copied onto a device. Both are entirely separate from the two
    // fields above — see kobo.rs's `kobo_cache_path` for why sync keeps its own copy instead
    // of reusing the user's exported file.
    pub last_kobo_export_at: Option<i64>,
    pub last_synced_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub project_id: String,
    pub folder_path: String,
    pub display_name: String,
    // Derived from display_name at read time (not stored) — see extract_chapter_number.
    // None means the folder name has no number to show as a "Chapter N" label.
    pub chapter_number: Option<f64>,
    pub sort_order: i64,
    pub image_count: i64,
    pub excluded_count: i64,
}

// Counts how many image files are directly inside a directory (not recursive).
// Used both when inserting a new chapter and by recompute_image_counts to refresh
// existing chapters' cached counts against what's actually on disk.
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

// Shared SELECT behind both `list_projects` and `set_library_root` — factors out the
// join/count query so it's written once instead of duplicated at every call site.
pub(crate) fn query_all_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.root_path, p.name, p.created_at, COUNT(c.id) as chapter_count,
                    p.cover_path, p.anilist_id, p.cover_title, p.cover_thumbnail_path,
                    p.last_export_path, p.last_exported_at, p.last_kobo_export_at, p.last_synced_at
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
                cover_title: row.get(7)?,
                cover_thumbnail_path: row.get(8)?,
                last_export_path: row.get(9)?,
                last_exported_at: row.get(10)?,
                last_kobo_export_at: row.get(11)?,
                last_synced_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

// Clears `last_export_path`/`last_exported_at` for any project whose manually-exported file
// has been deleted externally (while the app was open or closed) — otherwise the DB would
// keep pointing the "Last exported" display at a file that no longer exists. Called at the
// top of `list_projects` so this is checked fresh every time the list loads, mirroring how
// `remove_missing_projects`/`remove_missing_chapters` reconcile disk state one level down.
// Doesn't touch `last_kobo_export_at`/`last_synced_at` — Kobo sync's own AppData cache file
// isn't user-facing, so `sync_project` (kobo.rs) already handles a missing cache file itself
// by just regenerating it, the same way chapter thumbnails regenerate on demand.
fn clear_stale_export_paths(conn: &Connection) -> Result<(), String> {
    let paths: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, last_export_path FROM projects WHERE last_export_path IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    for (project_id, last_export_path) in paths {
        if !Path::new(&last_export_path).is_file() {
            conn.execute(
                "UPDATE projects SET last_export_path = NULL, last_exported_at = NULL WHERE id = ?1",
                params![project_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// Returns all projects, rescanning the configured library root first so the list always
// reflects the current state of disk (mirrors the rescan-on-read pattern `get_project_chapters`
// already uses one level down for chapters). Returns an empty list if no library root has
// been configured yet — the frontend shows the onboarding empty state in that case.
#[tauri::command]
pub fn list_projects(
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let Some(library_root) = read_library_root(&conn)? else {
        return Ok(Vec::new());
    };

    let new_projects = insert_new_projects(&conn, &library_root)?;
    remove_missing_projects(&conn, &app_handle)?;
    clear_stale_export_paths(&conn)?;

    // Reconcile every project's chapters against disk too, not just the project level above.
    // The library watcher catches chapter folders added/removed while the app is running, but
    // a chapter downloaded while the app was closed would otherwise go unnoticed until the user
    // opened that project's editor (`get_project_chapters`). Doing it here means simply opening
    // the app is enough to notice it — and, crucially, to invalidate the affected project's
    // cached exports so the Kobo pill reports it as out-of-sync. Each project is one cheap
    // read_dir; the reconciliation helpers dedupe against the DB and no-op when nothing changed.
    let project_roots: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, root_path FROM projects")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };
    for (project_id, root_path) in &project_roots {
        let inserted = insert_new_chapters(&conn, project_id, root_path)?;
        let removed = remove_missing_chapters(&conn, project_id)?;
        if inserted || removed {
            recompute_sort_order(&conn, project_id)?;
            crate::commands::images::invalidate_export_by_project(&conn, project_id)?;
        }
    }

    let projects = query_all_projects(&conn)?;
    drop(conn); // release the lock before spawning lookups, which will re-acquire it later

    // Fire-and-forget: each spawned task does its own network/DB work on its own schedule,
    // bounded by CoverLookupSemaphore. See cover.rs::spawn_auto_cover_lookup.
    for (project_id, name) in new_projects {
        crate::commands::cover::spawn_auto_cover_lookup(&app_handle, project_id, name);
    }

    Ok(projects)
}

// Permanently deletes a manga: removes its folder (and everything in it) from disk, then
// its DB row (cascading to chapters/excluded_images). A DB-only delete would just be
// undone by the next rescan/watch event, since the folder would still exist under the
// watched library root — so this mirrors `hard_delete_image`'s permanent-delete behaviour
// one level up.
//
// If the folder can't be removed (e.g. a file inside is open elsewhere), the error is
// returned and the DB row is left untouched, so the project doesn't vanish from the list
// while its files are still on disk.
#[tauri::command]
pub fn delete_project(
    id: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let (root_path, cover_path, cover_thumbnail_path): (String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT root_path, cover_path, cover_thumbnail_path FROM projects WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    std::fs::remove_dir_all(&root_path).map_err(|e| e.to_string())?;

    cleanup_project_assets(
        &conn,
        &app_handle,
        &id,
        cover_path.as_deref(),
        cover_thumbnail_path.as_deref(),
    )?;
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

// Permanently deletes a single chapter: removes its folder (and every page inside) from
// disk, then its cached thumbnails and DB row. A DB-only delete would just be re-inserted
// by the next rescan/watch event since the folder would still exist under the watched
// library root — so this mirrors `delete_project`'s disk-first permanent-delete contract
// one level down.
//
// If the folder can't be removed (e.g. a page is open elsewhere), the error is returned and
// the DB row is left untouched, so the chapter doesn't vanish from the list while its files
// are still on disk.
#[tauri::command]
pub fn delete_chapter(
    chapter_id: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Read the folder to remove. (project_id isn't needed here — `invalidate_export`
    // resolves it from the chapter row itself, which must still exist when it runs.)
    let folder_path: String = conn
        .query_row(
            "SELECT folder_path FROM chapters WHERE id = ?1",
            params![chapter_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Disk first — if this fails, bail before touching the DB so the list stays truthful.
    std::fs::remove_dir_all(&folder_path).map_err(|e| e.to_string())?;

    // Drop this chapter's cached thumbnail directory (mirrors the per-chapter cleanup in
    // `cleanup_project_assets`), so AppData doesn't retain thumbnails for a gone chapter.
    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        let thumb_dir = data_dir.join("thumbnails").join(&chapter_id);
        let _ = std::fs::remove_dir_all(thumb_dir); // ignore error if already gone
    }

    // Deleting a chapter changes what any CBZ would contain, so both cached-export
    // timestamps must be nulled — same reasoning as excluding/deleting a page. Run this
    // BEFORE the DELETE below, while the chapter row still exists for the subquery to find.
    crate::commands::images::invalidate_export(&conn, &chapter_id)?;

    // ON DELETE CASCADE removes this chapter's excluded_images rows too. No
    // recompute_sort_order needed — `get_project_chapters` re-derives sort_order from folder
    // names on every read, so the remaining chapters' now-gapped orders are harmless.
    conn.execute("DELETE FROM chapters WHERE id = ?1", params![chapter_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

// Deletes a project's cached cover image, per-chapter thumbnail cache directories, and Kobo
// sync cache file. Called before a project's DB row is removed — whether by an explicit
// `delete_project`, by `remove_missing_projects` noticing its folder vanished, or by
// `set_library_root` wiping out projects that belonged to the previous root — so AppData
// doesn't accumulate files for projects that no longer exist in the DB.
pub(crate) fn cleanup_project_assets(
    conn: &Connection,
    app_handle: &AppHandle,
    project_id: &str,
    cover_path: Option<&str>,
    cover_thumbnail_path: Option<&str>,
) -> Result<(), String> {
    if let Some(cover_path) = cover_path {
        let _ = std::fs::remove_file(cover_path); // ignore error if already gone
    }
    if let Some(cover_thumbnail_path) = cover_thumbnail_path {
        let _ = std::fs::remove_file(cover_thumbnail_path); // ignore error if already gone
    }

    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        let kobo_cache = data_dir.join("kobo-exports").join(format!("{project_id}.cbz"));
        let _ = std::fs::remove_file(kobo_cache); // ignore error if already gone
    }

    let chapter_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM chapters WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let result: Vec<String> = stmt
            .query_map(params![project_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        for chapter_id in chapter_ids {
            let thumb_dir = data_dir.join("thumbnails").join(chapter_id);
            let _ = std::fs::remove_dir_all(thumb_dir); // ignore error if already gone
        }
    }

    Ok(())
}

// Scans the library root's immediate subdirectories not yet in the DB and inserts them
// as projects (mangas), each with its own chapters scanned immediately — a manga folder
// can already contain chapter subfolders the first time we see it (e.g. it existed on
// disk before the library root was configured, or was just copied in wholesale).
// Shared by `list_projects` (rescan on read), `set_library_root`, and the library watcher
// in `watch.rs` (rescan on filesystem change). Returns the (id, name) of every project just
// inserted, so callers can both decide whether to notify the frontend and kick off an
// automatic cover lookup for each one (see cover.rs::spawn_auto_cover_lookup).
pub(crate) fn insert_new_projects(
    conn: &Connection,
    library_root: &str,
) -> Result<Vec<(String, String)>, String> {
    // Collect the root_paths of projects already in the DB into a HashSet for O(1) lookup.
    let existing: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT root_path FROM projects")
            .map_err(|e| e.to_string())?;
        let result: HashSet<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|p: String| normalize_path(Path::new(&p)))
            .collect();
        result
    };

    // Find subdirectories on disk that aren't in the DB yet.
    let mut new_dirs: Vec<_> = std::fs::read_dir(library_root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| !existing.contains(&normalize_path(&e.path())))
        .collect();
    new_dirs.sort_by_key(|e| e.file_name());

    let mut inserted = Vec::with_capacity(new_dirs.len());

    for entry in &new_dirs {
        let root_path = normalize_path(&entry.path());
        let name = entry.file_name().to_string_lossy().to_string();
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

        if insert_new_chapters(conn, &project_id, &root_path)? {
            recompute_sort_order(conn, &project_id)?;
        }
        inserted.push((project_id, name));
    }

    Ok(inserted)
}

// Deletes projects whose root_path no longer exists on disk, cleaning up their cached
// cover/thumbnails first. The DB schema's ON DELETE CASCADE takes care of that project's
// chapters and excluded_images rows. Shared by `list_projects` (rescan on read) and the
// library watcher in `watch.rs` (rescan on filesystem change), mirroring
// `insert_new_projects`. Returns whether any projects were removed, so callers can decide
// whether to notify the frontend.
pub(crate) fn remove_missing_projects(
    conn: &Connection,
    app_handle: &AppHandle,
) -> Result<bool, String> {
    let projects: Vec<(String, String, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT id, root_path, cover_path, cover_thumbnail_path FROM projects")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String, Option<String>, Option<String>)> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    let missing: Vec<(String, Option<String>, Option<String>)> = projects
        .into_iter()
        .filter(|(_, root_path, _, _)| !Path::new(root_path).is_dir())
        .map(|(id, _, cover_path, cover_thumbnail_path)| (id, cover_path, cover_thumbnail_path))
        .collect();

    let removed_any = !missing.is_empty();

    for (project_id, cover_path, cover_thumbnail_path) in &missing {
        cleanup_project_assets(
            conn,
            app_handle,
            project_id,
            cover_path.as_deref(),
            cover_thumbnail_path.as_deref(),
        )?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
            .map_err(|e| e.to_string())?;
    }

    Ok(removed_any)
}

// Rescans a project's root folder for subdirectories not yet in the DB and inserts
// them as new chapters, appended after the existing ones by sort_order.
// Shared by `get_project_chapters` (rescan on open) and the library watcher in
// `watch.rs` (rescan on filesystem change) so both paths dedupe against the DB the
// same way. Returns whether any new chapters were inserted, so callers can decide
// whether to notify the frontend.
pub(crate) fn insert_new_chapters(
    conn: &rusqlite::Connection,
    project_id: &str,
    root_path: &str,
) -> Result<bool, String> {
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
    let mut new_dirs: Vec<_> = std::fs::read_dir(root_path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| {
            !existing.contains(&normalize_path(&e.path())) // keep only folders not already in the DB
        })
        .collect();
    new_dirs.sort_by_key(|e| e.file_name());

    let inserted_any = !new_dirs.is_empty();

    // Insert the new subdirectories as chapters, appended after the existing ones.
    if inserted_any {
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

    Ok(inserted_any)
}

// Deletes chapters whose folder_path no longer exists on disk. The DB schema's
// ON DELETE CASCADE takes care of that chapter's excluded_images rows too.
// Shared by `get_project_chapters` (rescan on open) and the library watcher in
// `watch.rs` (rescan on filesystem change), mirroring `insert_new_chapters`.
// Returns whether any chapters were removed, so callers can decide whether to
// notify the frontend.
pub(crate) fn remove_missing_chapters(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<bool, String> {
    let chapters: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, folder_path FROM chapters WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String)> = stmt
            .query_map(params![project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    let missing_ids: Vec<String> = chapters
        .into_iter()
        .filter(|(_, folder_path)| !Path::new(folder_path).is_dir())
        .map(|(id, _)| id)
        .collect();

    let removed_any = !missing_ids.is_empty();

    for id in &missing_ids {
        conn.execute("DELETE FROM chapters WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }

    Ok(removed_any)
}

// Re-derives every chapter's sort_order from its folder name, so the list always reads
// in natural-sort order (Chapter 2 before Chapter 10) with no manual drag-to-reorder
// involved. SQLite has no natural-sort collation, so this sorts in Rust and writes the
// resulting rank back to sort_order — called after insert_new_chapters/remove_missing_chapters
// actually change the chapter set, by both `get_project_chapters` and the watcher in
// `watch.rs`, so the two never drift out of sync with disk.
pub(crate) fn recompute_sort_order(conn: &rusqlite::Connection, project_id: &str) -> Result<(), String> {
    let mut chapters: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, folder_path FROM chapters WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String)> = stmt
            .query_map(params![project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    // Sort by the folder's base name (the part after the last '/'), not the full path —
    // every chapter in a project shares the same parent prefix, but comparing basenames
    // directly is clearer about intent than relying on that being true.
    chapters.sort_by_key(|(_, folder_path)| {
        let basename = Path::new(folder_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| folder_path.clone());
        natural_sort_key(&basename)
    });

    for (i, (id, _)) in chapters.iter().enumerate() {
        conn.execute(
            "UPDATE chapters SET sort_order = ?1 WHERE id = ?2",
            params![i as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Re-counts every chapter's image files from disk and writes any changed count back to
// image_count. Unlike insert_new_chapters/remove_missing_chapters (which only fire when a
// chapter folder itself appears/disappears), this catches pages arriving into or vanishing
// from an *existing* chapter's folder after it was first discovered — e.g. a scanlation
// downloader that creates the chapter folder before it finishes writing pages into it, which
// would otherwise leave image_count permanently stuck at whatever was on disk the moment the
// chapter was first scanned. Called unconditionally by get_project_chapters, mirroring how
// recompute_sort_order and extract_chapter_number are re-derived on every read rather than
// trusted from a cache.
fn recompute_image_counts(conn: &rusqlite::Connection, project_id: &str) -> Result<(), String> {
    let chapters: Vec<(String, String, i64)> = {
        let mut stmt = conn
            .prepare("SELECT id, folder_path, image_count FROM chapters WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, String, i64)> = stmt
            .query_map(params![project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    for (id, folder_path, cached_count) in chapters {
        let current_count = count_images_in_dir(Path::new(&folder_path));
        if current_count != cached_count {
            conn.execute(
                "UPDATE chapters SET image_count = ?1 WHERE id = ?2",
                params![current_count, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// Returns all chapters for a project, ordered by sort_order.
// Also rescans the project's root folder: new subdirectories are inserted as chapters,
// and chapters whose folder was deleted on disk are removed from the DB.
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

    let inserted = insert_new_chapters(&conn, &project_id, &root_path)?;
    let removed = remove_missing_chapters(&conn, &project_id)?;
    if inserted || removed {
        recompute_sort_order(&conn, &project_id)?;
        // A chapter appeared/disappeared on disk since we last looked, so any cached CBZ
        // (the user's export and Kobo sync's own copy) no longer matches — mark both stale.
        crate::commands::images::invalidate_export_by_project(&conn, &project_id)?;
    }
    // Independent of whether chapters were added/removed: an existing chapter's own page
    // count may have drifted from its cached image_count (see recompute_image_counts).
    recompute_image_counts(&conn, &project_id)?;

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
            let display_name: String = row.get(3)?;
            let chapter_number = extract_chapter_number(&display_name);
            Ok(Chapter {
                id: row.get(0)?,
                project_id: row.get(1)?,
                folder_path: row.get(2)?,
                display_name,
                chapter_number,
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
