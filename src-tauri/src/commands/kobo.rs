use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetVolumeInformationW};
use windows::core::PCWSTR;

use crate::commands::export::{collect_cbz_source, write_cbz_archive};
use crate::db::DbState;
use crate::utils::now_unix;

// How the current Kobo connection state is shared between the background poller thread
// (started once at app launch, see `start_kobo_watcher`) and `get_kobo_device` — the same
// "poll into a Mutex, expose a snapshot" shape `WatcherState` uses for the library watcher,
// except here the Mutex holds the *result* of polling rather than the poller itself.
pub struct KoboDeviceState(pub Mutex<Option<KoboDevice>>);

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KoboDevice {
    pub drive_path: String, // e.g. "E:\\"
    pub label: Option<String>,
    pub free_bytes: u64,
    pub total_bytes: u64,
}

// The folder every synced .cbz is written into on the device, kept separate from anything
// else already on the drive (existing sideloaded books, another tool's own folder structure)
// so `sync_all_to_kobo`'s "does this project already have a file on the device" scan only
// ever has to look in one place.
pub const KOBO_SYNC_FOLDER: &str = "fukuro";

// Encodes a Rust string as a null-terminated UTF-16 buffer — the string form Win32's *W
// (wide/Unicode) functions expect. PCWSTR (used below) is just a pointer into a buffer like
// this one; the buffer must outlive the PCWSTR, which is why callers keep it alive in a
// local variable rather than constructing it inline.
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// Checks one drive letter for a `.kobo` marker directory (the reliable cross-model signal
// that a mounted drive is a Kobo e-reader, not just any USB stick) and, if present, reads its
// volume label and free/total space via raw Win32 calls — the `windows` crate is the only way
// to reach these, since std has no cross-platform disk-info API.
fn probe_drive(letter: char) -> Option<KoboDevice> {
    let drive_path = format!("{letter}:\\");
    if !Path::new(&drive_path).join(".kobo").is_dir() {
        return None;
    }

    let wide_path = to_wide(&drive_path);
    let path_ptr = PCWSTR(wide_path.as_ptr());

    // GetVolumeInformationW fills this buffer with the volume label (e.g. "KOBOeReader").
    // 256 UTF-16 units comfortably exceeds Windows' actual volume-label limit (32 chars).
    let mut label_buf = [0u16; 256];
    // SAFETY: `path_ptr` points at `wide_path`, which outlives this call; `label_buf` is a
    // valid, correctly-sized buffer the call is allowed to write into. All other output
    // parameters are `None`, which windows-rs represents as null pointers to Win32 — we
    // don't need serial number, max component length, or filesystem flags.
    let label = unsafe {
        GetVolumeInformationW(path_ptr, Some(&mut label_buf), None, None, None, None)
    }
    .is_ok()
    .then(|| {
        // Find the first NUL terminator the call wrote and decode only up to there.
        let end = label_buf.iter().position(|&c| c == 0).unwrap_or(0);
        String::from_utf16_lossy(&label_buf[..end])
    })
    .filter(|s| !s.is_empty());

    let mut free_bytes: u64 = 0;
    let mut total_bytes: u64 = 0;
    // SAFETY: same `path_ptr` validity as above; the two out-pointers point at local `u64`s
    // that live for the duration of this call.
    let has_space = unsafe {
        GetDiskFreeSpaceExW(
            path_ptr,
            Some(&mut free_bytes),
            Some(&mut total_bytes),
            None,
        )
    }
    .is_ok();

    if !has_space {
        return None; // drive vanished between the .kobo check and here — treat as not connected
    }

    Some(KoboDevice {
        drive_path,
        label,
        free_bytes,
        total_bytes,
    })
}

// Scans every drive letter for a connected Kobo. Only one is ever reported — if somehow more
// than one is plugged in at once, the first found (alphabetically) wins; this is a deliberate
// simplification, not a limitation anyone is expected to hit in practice.
fn detect_kobo_device() -> Option<KoboDevice> {
    ('A'..='Z').find_map(probe_drive)
}

// Starts the background thread that keeps `KoboDeviceState` current for the whole app
// session. Polls every 3 seconds (device connect/disconnect via USB has no filesystem-watcher
// equivalent to hook into, unlike the library watcher in watch.rs, so polling is the only
// option) and only touches the Mutex / emits an event when the detected device actually
// changes, so a connected Kobo sitting idle doesn't spam the frontend every 3s.
pub fn start_kobo_watcher(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            let detected = detect_kobo_device();

            let changed = {
                let state = app.state::<KoboDeviceState>();
                let mut guard = match state.0.lock() {
                    Ok(guard) => guard,
                    Err(_) => break, // poisoned mutex — another thread already panicked
                };
                if *guard != detected {
                    *guard = detected.clone();
                    true
                } else {
                    false
                }
            };

            if changed {
                let _ = app.emit("kobo-device-changed", detected);
            }

            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

// Returns the currently-known device state without waiting for the next poll tick — read
// from the same Mutex the background thread writes into. Called once on frontend mount so
// the badge doesn't start blank for up to 3s after launch even if a Kobo is already plugged
// in; `kobo-device-changed` covers every update after that.
#[tauri::command]
pub fn get_kobo_device(state: tauri::State<KoboDeviceState>) -> Result<Option<KoboDevice>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

// Resolves where a project's synced .cbz belongs on a connected device, creating the
// dedicated sync folder if this is the first file ever written there.
pub(crate) fn resolve_device_path(device: &KoboDevice, filename: &str) -> Result<PathBuf, String> {
    let dir = Path::new(&device.drive_path).join(KOBO_SYNC_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(filename))
}

// Resolves the local cache path Kobo sync writes its own .cbz to — deliberately separate
// from `last_export_path` (the file the user's own "Export CBZ" button saves, wherever they
// picked). Syncing should never need a save-location prompt, so it always has a fixed,
// hidden location to write to, the same way chapter thumbnails and cover images live under
// AppData rather than anywhere the user chooses. Creates the cache directory if this is the
// first sync for any project.
fn kobo_cache_path(app_handle: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("kobo-exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{project_id}.cbz")))
}

// Copies `src` to `dest` in 1 MiB chunks (rather than a single `std::fs::copy` call),
// reporting bytes-copied-so-far after each chunk — the byte-level progress bar shown during
// a Kobo sync, unlike `create_cbz`'s export (which reports per-page/per-file progress since
// there's no equivalent finer-grained signal for writing a zip entry).
fn copy_with_progress(
    src: &str,
    dest: &Path,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    let mut src_file = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let total = src_file.metadata().map_err(|e| e.to_string())?.len();
    let mut dest_file = std::fs::File::create(dest).map_err(|e| e.to_string())?;

    let mut buf = [0u8; 1024 * 1024];
    let mut copied: u64 = 0;
    on_progress(0, total);

    loop {
        let n = src_file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        dest_file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        copied += n as u64;
        on_progress(copied, total);
    }

    Ok(())
}

// The project fields `sync_project` needs, read once up front (outside the background
// thread — mirrors `create_cbz` releasing its DB lock before spawning).
struct SyncTarget {
    project_id: String,
    project_name: String,
    // Null whenever the Kobo-sync cache (see `kobo_cache_path`) is known-stale: either it's
    // never been generated, or `invalidate_export` (images.rs) cleared it after an exclusion
    // toggle/page delete. Independent of `last_exported_at` — that column tracks only the
    // user's own manual "Export CBZ" file, a completely different file on disk now.
    last_kobo_export_at: Option<i64>,
}

fn fetch_sync_target(conn: &Connection, project_id: &str) -> Result<SyncTarget, String> {
    conn.query_row(
        "SELECT name, last_kobo_export_at FROM projects WHERE id = ?1",
        params![project_id],
        |r| {
            Ok(SyncTarget {
                project_id: project_id.to_string(),
                project_name: r.get(0)?,
                last_kobo_export_at: r.get(1)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

// Ensures a fresh local .cbz exists in Kobo sync's own AppData cache for `target` —
// re-running `write_cbz_archive` whenever that cache file is missing/never existed *or* its
// content is known-stale (`target.last_kobo_export_at` is null — see its doc comment) — then
// chunked-copies it onto `device`. Returns the resulting on-device path. Shared by
// `sync_project_to_kobo` (per-project button) and `sync_all_to_kobo` (bulk backfill, via
// `run_sync_all`), both of which forward the two progress callbacks to the frontend, so
// the "ensure export, then copy" sequence has one implementation instead of two.
fn sync_project(
    app_handle: &AppHandle,
    device: &KoboDevice,
    target: &SyncTarget,
    mut on_export_progress: impl FnMut(u32, u32),
    mut on_copy_progress: impl FnMut(u64, u64),
) -> Result<PathBuf, String> {
    let local_path = kobo_cache_path(app_handle, &target.project_id)?;
    let db_state = app_handle.state::<DbState>();

    let needs_export = target.last_kobo_export_at.is_none() || !local_path.is_file();
    if needs_export {
        let source = {
            let conn = db_state.0.lock().map_err(|e| e.to_string())?;
            collect_cbz_source(&conn, &target.project_id)?
        };
        if source.chapters.is_empty() {
            return Err("No chapters found for this project".to_string());
        }

        write_cbz_archive(&source, &local_path.to_string_lossy(), |current, total| {
            on_export_progress(current, total)
        })?;

        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE projects SET last_kobo_export_at = ?1 WHERE id = ?2",
            params![now_unix(), target.project_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let filename = format!("{}.cbz", target.project_name);
    let device_path = resolve_device_path(device, &filename)?;
    copy_with_progress(&local_path.to_string_lossy(), &device_path, |current, total| {
        on_copy_progress(current, total)
    })?;

    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET last_synced_at = ?1 WHERE id = ?2",
        params![now_unix(), target.project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(device_path)
}

// Events streamed through the Tauri Channel during a single project's Kobo sync. `Exporting`
// only ever fires when the local .cbz needed to be (re-)written first — most syncs go
// straight to `Copying` since the file is usually already up to date on disk.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum SyncEvent {
    Exporting { current: u32, total: u32 },
    Copying { current: u64, total: u64 },
    Done { device_path: String },
    Error { message: String },
}

// Syncs one project to the currently-connected Kobo: ensures a fresh local .cbz in Kobo
// sync's own AppData cache (exporting first if needed — see `sync_project`), then copies it
// onto the device. Never prompts for a save location — `kobo_cache_path` is fixed and hidden,
// independent of wherever the user's own "Export CBZ" button last saved.
#[tauri::command]
pub fn sync_project_to_kobo(
    project_id: String,
    state: tauri::State<DbState>,
    device_state: tauri::State<KoboDeviceState>,
    app_handle: tauri::AppHandle,
    on_event: tauri::ipc::Channel<SyncEvent>,
) -> Result<(), String> {
    let device = {
        let guard = device_state.0.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let Some(device) = device else {
        let _ = on_event.send(SyncEvent::Error {
            message: "No Kobo device connected".to_string(),
        });
        return Ok(());
    };

    let target = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        fetch_sync_target(&conn, &project_id)?
    };

    let app_handle = app_handle.clone();
    std::thread::spawn(move || {
        let result = sync_project(
            &app_handle,
            &device,
            &target,
            |current, total| {
                let _ = on_event.send(SyncEvent::Exporting { current, total });
            },
            |current, total| {
                let _ = on_event.send(SyncEvent::Copying { current, total });
            },
        );

        match result {
            Ok(device_path) => {
                let _ = on_event.send(SyncEvent::Done {
                    device_path: device_path.to_string_lossy().to_string(),
                });
            }
            Err(message) => {
                let _ = on_event.send(SyncEvent::Error { message });
            }
        }
    });

    Ok(())
}

// Which half of a project's sync a `SyncAllEvent::ProjectProgress` describes. Serialized as
// the plain strings "exporting" / "copying" (a unit-only enum with `rename_all` becomes a
// string, not an object), matching `SyncEvent`'s variant names so the frontend can feed both
// streams into the same `SyncProgress` shape.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncPhase {
    Exporting,
    Copying,
}

// Events streamed while `sync_all_to_kobo` works through its queue.
//
// This used to be deliberately coarse — one event per finished project, "not a progress bar
// per file". That decision is reversed: with large projects (hundreds of MB, sometimes needing
// a re-export first) the coarse view sat on a spinner for minutes and looked stuck. Bulk sync
// now forwards the same export/copy progress a single send gets, as `ProjectProgress`.
//
// Per project the order is always: `Started` → zero or more `ProjectProgress` (any
// `Exporting` ones always before any `Copying` ones) → `Finished`. A single `Done` closes the
// run. The frontend needs `Started` to light up the active row: it can't predict which project
// is next on its own, since the candidate set is computed here (it includes the device-missing
// scan below, which the UI can't replicate) and the DB query imposes no ordering to mirror.
//
// Units in `ProjectProgress` match `SyncEvent`: Pages when exporting, bytes when copying.
// Both fit in u64, so one variant carries either (`u32` page counts widen losslessly).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum SyncAllEvent {
    Started {
        project_id: String,
    },
    ProjectProgress {
        project_id: String,
        phase: SyncPhase,
        current: u64,
        total: u64,
    },
    // Named `Finished` (was `Progress`) so "progress" only ever means within-project progress.
    Finished {
        current: usize,
        total: usize,
        project_id: String,
        project_name: String,
        success: bool,
        error: Option<String>,
    },
    Done {
        synced: usize,
        total: usize,
    },
}

// Runs `sync_project` for every project that's outdated or missing on the device, in
// sequence (not concurrently — a Kobo is a single USB mass-storage device, so parallel
// writes to it buy nothing and only risk contention). "Outdated" mirrors the project-row
// marker's logic: `last_kobo_export_at > last_synced_at`, `last_kobo_export_at` set with
// `last_synced_at` null, or `last_kobo_export_at` null with a prior sync (content changed via
// `invalidate_export` since that sync — see images.rs). Every project is a candidate — unlike
// the old design, there's no "never exported" case to skip, since Kobo sync's cache never
// needs a save-location prompt (see `kobo_cache_path`).
#[tauri::command]
pub fn sync_all_to_kobo(
    state: tauri::State<DbState>,
    device_state: tauri::State<KoboDeviceState>,
    app_handle: tauri::AppHandle,
    on_event: tauri::ipc::Channel<SyncAllEvent>,
) -> Result<(), String> {
    let device = {
        let guard = device_state.0.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let Some(device) = device else {
        return Err("No Kobo device connected".to_string());
    };

    // Filenames already present in the device's sync folder — a project can look "up to
    // date" by timestamp yet have had its device copy deleted directly on the Kobo, so this
    // check catches that case in addition to the timestamp comparison below.
    let existing_on_device: HashSet<String> = {
        let dir = Path::new(&device.drive_path).join(KOBO_SYNC_FOLDER);
        std::fs::read_dir(&dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    };

    let targets: Vec<SyncTarget> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, last_kobo_export_at, last_synced_at FROM projects")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, Option<i64>, Option<i64>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        rows.into_iter()
            .filter(|(_, name, kobo_exported_at, synced_at)| {
                let outdated = match (kobo_exported_at, synced_at) {
                    (Some(exported), Some(synced)) => exported > synced,
                    (Some(_), None) => true,
                    // `last_kobo_export_at` null with a prior sync means the cache is
                    // known-stale (see `invalidate_export` in images.rs), not "never
                    // synced" — still needs a fresh sync, not to be skipped.
                    (None, Some(_)) => true,
                    (None, None) => false,
                };
                outdated || !existing_on_device.contains(&format!("{name}.cbz"))
            })
            .map(|(id, name, kobo_exported_at, _)| SyncTarget {
                project_id: id,
                project_name: name,
                last_kobo_export_at: kobo_exported_at,
            })
            .collect()
    };

    let app_handle = app_handle.clone();

    std::thread::spawn(move || {
        run_sync_all(
            &targets,
            // The real per-project operation: the shared `sync_project`, with its two progress
            // callbacks forwarded to whatever `run_sync_all` hands in. The on-device path it
            // returns isn't needed for bulk sync, so `.map(|_| ())` drops it. A `&mut dyn FnMut`
            // is itself an `FnMut`, so the callbacks can be passed straight through.
            |target, on_export, on_copy| {
                sync_project(&app_handle, &device, target, on_export, on_copy).map(|_| ())
            },
            // The real event sink: the Tauri Channel. A send error only means the frontend
            // stopped listening (e.g. window closed), which is no reason to abort the run.
            |event| {
                let _ = on_event.send(event);
            },
        );
    });

    Ok(())
}

// The body of a Sync all run, pulled out of `sync_all_to_kobo` so it can be unit-tested
// without Tauri. Both of its dependencies come in as closures:
//
// - `sync_one` performs one project's sync. It receives the target plus two progress
//   callbacks (export Pages, copy bytes) to call as it goes, and returns success/failure.
//   The command passes the real `sync_project`; tests pass a fake that calls the callbacks a
//   fixed number of times and can be told to fail.
// - `emit` receives every `SyncAllEvent`. The command passes the Tauri Channel; tests collect
//   into a Vec.
//
// `emit` is `Fn` (not `FnMut`) on purpose: it's called both here in the loop *and* from inside
// the two progress callbacks handed to `sync_one`, which means three places hold a reference
// to it at once. Rust only allows that for shared (`&`) borrows, and only `Fn` can be called
// through a shared borrow. `Channel::send` takes `&self`, so the real sink is naturally `Fn`;
// a test sink gets mutation back via `RefCell`.
//
// The progress callbacks are `&mut dyn FnMut` rather than `impl FnMut` because `sync_one` is
// itself a generic closure: a closure's parameter types must be concrete, so there's no way to
// say "any callback type" there — a trait object is the one-type-fits-all stand-in.
//
// Returns the number of projects that synced successfully (also reported in `Done`).
fn run_sync_all<S, E>(targets: &[SyncTarget], mut sync_one: S, emit: E) -> usize
where
    S: FnMut(
        &SyncTarget,
        &mut dyn FnMut(u32, u32), // export progress: Pages written / total Pages
        &mut dyn FnMut(u64, u64), // copy progress: bytes copied / total bytes
    ) -> Result<(), String>,
    E: Fn(SyncAllEvent),
{
    let total = targets.len();
    let mut synced = 0;

    for (i, target) in targets.iter().enumerate() {
        // Tell the UI this row is now the active one — see `SyncAllEvent`'s doc comment for
        // why the frontend can't infer this itself.
        emit(SyncAllEvent::Started {
            project_id: target.project_id.clone(),
        });

        // Forward export progress (Pages) as live `ProjectProgress` events. `u64::from` widens
        // the u32 page counts so both phases share one variant's field types.
        let mut on_export = |current: u32, total: u32| {
            emit(SyncAllEvent::ProjectProgress {
                project_id: target.project_id.clone(),
                phase: SyncPhase::Exporting,
                current: u64::from(current),
                total: u64::from(total),
            });
        };
        // Same for copy progress (bytes), which are already u64.
        let mut on_copy = |current: u64, total: u64| {
            emit(SyncAllEvent::ProjectProgress {
                project_id: target.project_id.clone(),
                phase: SyncPhase::Copying,
                current,
                total,
            });
        };

        let result = sync_one(target, &mut on_export, &mut on_copy);
        let success = result.is_ok();
        if success {
            synced += 1;
        }

        // One `Finished` per project, success or not — a failure partway through still ends
        // that project's events here, and the loop carries on with the next one.
        emit(SyncAllEvent::Finished {
            current: i + 1,
            total,
            project_id: target.project_id.clone(),
            project_name: target.project_name.clone(),
            success,
            error: result.err(),
        });
    }

    emit(SyncAllEvent::Done { synced, total });
    synced
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    // Builds a target with only the fields the loop itself reads (id + name); the cache
    // timestamp is irrelevant here since the fake sync operation decides whether to "export".
    fn target(id: &str) -> SyncTarget {
        SyncTarget {
            project_id: id.to_string(),
            project_name: format!("Project {id}"),
            last_kobo_export_at: None,
        }
    }

    #[test]
    fn zero_targets_emits_only_done() {
        let events = RefCell::new(Vec::new());
        run_sync_all(&[], |_, _, _| Ok(()), |e| events.borrow_mut().push(e));
        assert_eq!(
            events.into_inner(),
            vec![SyncAllEvent::Done {
                synced: 0,
                total: 0
            }]
        );
    }

    // Shorthand for the expected `ProjectProgress` events, to keep the assertions readable.
    fn progress(id: &str, phase: SyncPhase, current: u64, total: u64) -> SyncAllEvent {
        SyncAllEvent::ProjectProgress {
            project_id: id.to_string(),
            phase,
            current,
            total,
        }
    }

    fn started(id: &str) -> SyncAllEvent {
        SyncAllEvent::Started {
            project_id: id.to_string(),
        }
    }

    fn finished(id: &str, current: usize, total: usize, error: Option<&str>) -> SyncAllEvent {
        SyncAllEvent::Finished {
            current,
            total,
            project_id: id.to_string(),
            project_name: format!("Project {id}"),
            success: error.is_none(),
            error: error.map(str::to_string),
        }
    }

    #[test]
    fn project_needing_export_streams_export_then_copy_progress() {
        let events = RefCell::new(Vec::new());
        let synced = run_sync_all(
            &[target("a")],
            // Fake sync: 2 Pages exported, then 2 MiB copied in two chunks.
            |_, on_export, on_copy| {
                on_export(1, 2);
                on_export(2, 2);
                on_copy(0, 2048);
                on_copy(1024, 2048);
                on_copy(2048, 2048);
                Ok(())
            },
            |e| events.borrow_mut().push(e),
        );

        assert_eq!(synced, 1);
        assert_eq!(
            events.into_inner(),
            vec![
                started("a"),
                progress("a", SyncPhase::Exporting, 1, 2),
                progress("a", SyncPhase::Exporting, 2, 2),
                progress("a", SyncPhase::Copying, 0, 2048),
                progress("a", SyncPhase::Copying, 1024, 2048),
                progress("a", SyncPhase::Copying, 2048, 2048),
                finished("a", 1, 1, None),
                SyncAllEvent::Done {
                    synced: 1,
                    total: 1
                },
            ]
        );
    }

    #[test]
    fn project_with_fresh_cache_streams_copy_progress_only() {
        let events = RefCell::new(Vec::new());
        run_sync_all(
            &[target("a")],
            // Fake sync whose cache is fresh: no export callback at all, straight to copying.
            |_, _, on_copy| {
                on_copy(0, 10);
                on_copy(10, 10);
                Ok(())
            },
            |e| events.borrow_mut().push(e),
        );

        assert_eq!(
            events.into_inner(),
            vec![
                started("a"),
                progress("a", SyncPhase::Copying, 0, 10),
                progress("a", SyncPhase::Copying, 10, 10),
                finished("a", 1, 1, None),
                SyncAllEvent::Done {
                    synced: 1,
                    total: 1
                },
            ]
        );
    }

    #[test]
    fn failure_partway_finishes_that_project_and_continues_with_the_next() {
        let events = RefCell::new(Vec::new());
        let synced = run_sync_all(
            &[target("a"), target("b")],
            // "a" fails halfway through copying; "b" succeeds.
            |t, _, on_copy| {
                on_copy(0, 10);
                if t.project_id == "a" {
                    on_copy(5, 10);
                    return Err("device full".to_string());
                }
                on_copy(10, 10);
                Ok(())
            },
            |e| events.borrow_mut().push(e),
        );

        assert_eq!(synced, 1);
        assert_eq!(
            events.into_inner(),
            vec![
                started("a"),
                progress("a", SyncPhase::Copying, 0, 10),
                progress("a", SyncPhase::Copying, 5, 10),
                finished("a", 1, 2, Some("device full")),
                started("b"),
                progress("b", SyncPhase::Copying, 0, 10),
                progress("b", SyncPhase::Copying, 10, 10),
                finished("b", 2, 2, None),
                SyncAllEvent::Done {
                    synced: 1,
                    total: 2
                },
            ]
        );
    }

    #[test]
    fn several_projects_stay_grouped_and_count_up() {
        let events = RefCell::new(Vec::new());
        run_sync_all(
            &[target("a"), target("b"), target("c")],
            // "b" needs an export first; the others go straight to copying.
            |t, on_export, on_copy| {
                if t.project_id == "b" {
                    on_export(1, 1);
                }
                on_copy(1, 1);
                Ok(())
            },
            |e| events.borrow_mut().push(e),
        );

        assert_eq!(
            events.into_inner(),
            vec![
                started("a"),
                progress("a", SyncPhase::Copying, 1, 1),
                finished("a", 1, 3, None),
                started("b"),
                progress("b", SyncPhase::Exporting, 1, 1),
                progress("b", SyncPhase::Copying, 1, 1),
                finished("b", 2, 3, None),
                started("c"),
                progress("c", SyncPhase::Copying, 1, 1),
                finished("c", 3, 3, None),
                SyncAllEvent::Done {
                    synced: 3,
                    total: 3
                },
            ]
        );
    }

    // Guards the `rename_all_fields` gotcha (see CLAUDE.md): without it, the fields inside
    // each variant would silently ship as snake_case.
    #[test]
    fn events_serialize_with_camel_case_fields() {
        let json = serde_json::to_value(progress("a", SyncPhase::Exporting, 3, 9)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "type": "projectProgress",
                "projectId": "a",
                "phase": "exporting",
                "current": 3,
                "total": 9,
            })
        );

        let json = serde_json::to_value(finished("a", 1, 2, Some("boom"))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "type": "finished",
                "current": 1,
                "total": 2,
                "projectId": "a",
                "projectName": "Project a",
                "success": false,
                "error": "boom",
            })
        );
    }
}
