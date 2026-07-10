use image::ImageEncoder;
use image::codecs::jpeg::JpegEncoder;
use regex::Regex;
use rusqlite::params;
use serde::Serialize;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Semaphore;

use crate::commands::thumbnails::resize_to_jpeg;
use crate::db::DbState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverResult {
    pub cover_path: String,
    pub cover_thumbnail_path: String,
}

// A single Anilist search hit, trimmed down to what the frontend picker needs.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnilistCandidate {
    pub anilist_id: i64,
    pub title: String,
    // Kept alongside the (English-preferred) display `title` purely for the automatic
    // lookup's similarity check — scanlation folder names are almost always romaji, so
    // comparing only against an English localisation title (which can differ completely,
    // e.g. "Kaoru Hana wa Rin to Saku" vs "The Fragrant Flower Blooms With Dignity") would
    // reject correct matches. Not surfaced in the manual picker UI.
    pub romaji_title: Option<String>,
    pub year: Option<i64>,
    pub thumbnail_url: String,
    pub image_url: String,
}

// Bounds how many Anilist lookups run concurrently, shared across every source of lookups
// (automatic on project discovery, and the manual bulk backfill). Without this, a first-time
// library import of hundreds of manga folders would fire hundreds of simultaneous requests at
// once. Registered as managed state in lib.rs; a permit is held for the duration of one
// lookup's network calls.
pub struct CoverLookupSemaphore(pub Arc<Semaphore>);

const AUTO_APPLY_SIMILARITY_THRESHOLD: f64 = 0.85;

// Resolves the covers directory under AppData, creating it if needed.
fn covers_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("covers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Resolves the cover thumbnail cache directory under AppData, creating it if needed.
// Kept separate from `covers_dir` so `remove_dir_all("covers")` semantics stay simple
// if ever needed, and to mirror the chapter thumbnails/`thumbnails` split.
fn cover_thumbnails_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = covers_dir(app_handle)?.join("thumbnails");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Re-encodes any supported image format to JPEG quality 100 and writes it to `dest` — used
// for locally-uploaded covers, where the source format isn't known to be JPEG. A separate
// 200px-wide thumbnail (for UI display only) is written to `thumb_dest` from the same decoded
// image, avoiding a second decode of `source_bytes`.
fn encode_cover(
    source_bytes: &[u8],
    dest: &std::path::Path,
    thumb_dest: &std::path::Path,
) -> Result<(), String> {
    let img = image::load_from_memory(source_bytes).map_err(|e| e.to_string())?;
    // to_rgba8() normalises any pixel format (grayscale, palette, etc.) to 8-bit RGBA.
    let rgba = img.to_rgba8();
    // JPEG doesn't support an alpha channel, so we must convert RGBA → RGB before encoding.
    // Wrapping in ImageRgba8 and calling to_rgb8() is the idiomatic way to do this with the
    // image crate — it flattens the alpha by compositing over a black background.
    let rgb = image::DynamicImage::ImageRgba8(rgba).to_rgb8();

    // Encode to an in-memory buffer first, then write the buffer to disk in one call.
    // This avoids a partially-written file on disk if encoding fails midway.
    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, 100);
    encoder
        .write_image(
            rgb.as_raw(),  // raw pixel bytes as a flat &[u8]
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8, // tells the encoder each pixel is 3 bytes (R, G, B)
        )
        .map_err(|e| e.to_string())?;

    std::fs::write(dest, &buf).map_err(|e| e.to_string())?;

    // `img` is only moved here (not borrowed) — the master encode above already extracted
    // its own owned pixel buffers via to_rgba8()/to_rgb8(), so this doesn't race with it.
    let thumb_bytes = resize_to_jpeg(img, 200)?;
    std::fs::write(thumb_dest, &thumb_bytes).map_err(|e| e.to_string())?;

    Ok(())
}

/// Copy a locally picked image file as the project cover (JPEG quality 100).
/// Returns the stored cover path for the frontend to update its state.
#[tauri::command]
pub fn set_project_cover(
    project_id: String,
    image_path: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<CoverResult, String> {
    let dest = covers_dir(&app_handle)?.join(format!("{project_id}.jpg"));
    let thumb_dest = cover_thumbnails_dir(&app_handle)?.join(format!("{project_id}.jpg"));

    let source_bytes = std::fs::read(&image_path).map_err(|e| e.to_string())?;
    encode_cover(&source_bytes, &dest, &thumb_dest)?;

    let cover_path = dest.to_string_lossy().to_string();
    let cover_thumbnail_path = thumb_dest.to_string_lossy().to_string();

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Uploading a new local image replaces any previous Anilist association.
    conn.execute(
        "UPDATE projects SET cover_path = ?1, cover_thumbnail_path = ?2, anilist_id = NULL, cover_title = NULL WHERE id = ?3",
        params![cover_path, cover_thumbnail_path, project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(CoverResult {
        cover_path,
        cover_thumbnail_path,
    })
}

// Strips scanlation-folder noise — release-group tags in brackets/parens, and trailing
// volume/chapter range tokens — from a project's folder name so it reads closer to an
// actual series title before being sent to Anilist's title search. Not exhaustive, just
// enough to turn common naming conventions (e.g. "[SomeGroup] One Piece v01-05 (Digital)")
// into something searchable ("One Piece").
fn clean_title(name: &str) -> String {
    // `[^\])]*` matches any run of characters that isn't a closing bracket/paren, so this
    // doesn't over-match across multiple unrelated groups on the same line.
    let bracketed = Regex::new(r"[\[(][^\])]*[\])]").expect("valid regex");
    let without_brackets = bracketed.replace_all(name, " ");

    // (?i) makes the match case-insensitive. Matches tokens like "v01", "vol.12", "ch1-10".
    let volume_range = Regex::new(r"(?i)\b(v|vol|volume|c|ch|chapter)\.?\s*\d+(-\d+)?\b")
        .expect("valid regex");
    let without_ranges = volume_range.replace_all(&without_brackets, " ");

    let whitespace = Regex::new(r"\s+").expect("valid regex");
    whitespace.replace_all(without_ranges.trim(), " ").trim().to_string()
}

// Queries Anilist's public GraphQL API (no API key required) for manga matching `query`,
// returning up to `limit` candidates ranked by Anilist's own search relevance. Candidates
// with no cover image are skipped — `?` inside the `filter_map` closure short-circuits to
// `None` for that one entry when a field is missing, rather than failing the whole search.
async fn search_anilist(query: &str, limit: usize) -> Result<Vec<AnilistCandidate>, String> {
    let client = reqwest::Client::new();

    let graphql_query = r#"
        query ($search: String, $perPage: Int) {
          Page(page: 1, perPage: $perPage) {
            media(search: $search, type: MANGA) {
              id
              title { romaji english }
              coverImage { extraLarge large }
              startDate { year }
            }
          }
        }
    "#;

    let response: serde_json::Value = client
        .post("https://graphql.anilist.co")
        .json(&serde_json::json!({
            "query": graphql_query,
            "variables": { "search": query, "perPage": limit },
        }))
        .send()
        .await
        .map_err(|e| format!("Anilist request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anilist response: {e}"))?;

    let media = response
        .pointer("/data/Page/media")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let candidates = media
        .iter()
        .filter_map(|entry| {
            let anilist_id = entry.get("id")?.as_i64()?;
            let romaji = entry
                .pointer("/title/romaji")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            // Prefer the English title for display, falling back to romaji — same priority
            // order the original single-ID Anilist fetch used.
            let title = entry
                .pointer("/title/english")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or(romaji)?
                .to_string();
            let romaji_title = romaji.map(|s| s.to_string());
            let year = entry.pointer("/startDate/year").and_then(|v| v.as_i64());
            // No fallback here: a candidate with no cover image is useless as a cover.
            let image_url = entry
                .pointer("/coverImage/extraLarge")
                .and_then(|v| v.as_str())?
                .to_string();
            let thumbnail_url = entry
                .pointer("/coverImage/large")
                .and_then(|v| v.as_str())
                .unwrap_or(&image_url)
                .to_string();
            Some(AnilistCandidate {
                anilist_id,
                title,
                romaji_title,
                year,
                thumbnail_url,
                image_url,
            })
        })
        .take(limit)
        .collect();

    Ok(candidates)
}

/// Search Anilist by title, returning up to 5 candidates for the manual picker in
/// `CoverDialog`. The user then confirms one via `apply_anilist_cover`.
#[tauri::command]
pub async fn search_anilist_covers(query: String) -> Result<Vec<AnilistCandidate>, String> {
    search_anilist(&query, 5).await
}

// Shared apply logic: downloads `image_url` and updates the DB. Used both by the
// `apply_anilist_cover` command (manual picker confirmation) and by the automatic/bulk
// lookup paths below, which call this directly as a plain function rather than through
// Tauri's IPC layer.
async fn apply_cover_internal(
    app_handle: &tauri::AppHandle,
    project_id: &str,
    anilist_id: i64,
    title: &str,
    image_url: &str,
) -> Result<CoverResult, String> {
    let client = reqwest::Client::new();
    let img_bytes = client
        .get(image_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download cover: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read cover bytes: {e}"))?;

    let dest = covers_dir(app_handle)?.join(format!("{project_id}.jpg"));
    let thumb_dest = cover_thumbnails_dir(app_handle)?.join(format!("{project_id}.jpg"));

    // Anilist always serves JPEG, so the master is written verbatim — re-encoding through
    // `encode_cover` (as the local-upload path does) would just be a lossy decode→re-encode
    // cycle with no quality gain. The thumbnail still requires its own decode, since there's
    // no way to shrink a JPEG without decoding it first; that decode/resize/encode is CPU-bound,
    // so it's offloaded to a blocking thread (see rust-primer.md's reqwest entry).
    let img_bytes_vec = img_bytes.to_vec();
    let thumb_dest_clone = thumb_dest.clone();
    let thumb_bytes = tauri::async_runtime::spawn_blocking(move || {
        let img = image::load_from_memory(&img_bytes_vec).map_err(|e| e.to_string())?;
        resize_to_jpeg(img, 200)
    })
    .await
    .map_err(|e| e.to_string())??;

    std::fs::write(&dest, &img_bytes).map_err(|e| format!("Failed to save cover: {e}"))?;
    std::fs::write(&thumb_dest_clone, &thumb_bytes).map_err(|e| e.to_string())?;

    let cover_path = dest.to_string_lossy().to_string();
    let cover_thumbnail_path = thumb_dest.to_string_lossy().to_string();

    let db_state = app_handle.state::<DbState>();
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET cover_path = ?1, cover_thumbnail_path = ?2, anilist_id = ?3, cover_title = ?4 WHERE id = ?5",
        params![cover_path, cover_thumbnail_path, anilist_id, title, project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(CoverResult {
        cover_path,
        cover_thumbnail_path,
    })
}

/// Apply an Anilist candidate the user picked in `CoverDialog`'s search results.
#[tauri::command]
pub async fn apply_anilist_cover(
    project_id: String,
    anilist_id: i64,
    image_url: String,
    title: String,
    app_handle: tauri::AppHandle,
) -> Result<CoverResult, String> {
    apply_cover_internal(&app_handle, &project_id, anilist_id, &title, &image_url).await
}

/// Remove the project cover: deletes the file and clears DB fields.
#[tauri::command]
pub fn remove_project_cover(
    project_id: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let dest = covers_dir(&app_handle)?.join(format!("{project_id}.jpg"));
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| e.to_string())?;
    }
    let thumb_dest = cover_thumbnails_dir(&app_handle)?.join(format!("{project_id}.jpg"));
    if thumb_dest.exists() {
        std::fs::remove_file(&thumb_dest).map_err(|e| e.to_string())?;
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET cover_path = NULL, cover_thumbnail_path = NULL, anilist_id = NULL, cover_title = NULL WHERE id = ?1",
        params![project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// Attempts an automatic cover lookup for one project: clean the folder name, take Anilist's
// top search hit, and only apply it if the hit's title is close enough to the cleaned name
// (Jaro-Winkler similarity — favours shared prefixes/short titles, which suits messy manga
// folder names better than raw edit distance). Below the threshold, or if the search/download
// fails for any reason, this silently does nothing: there's no user watching a background
// lookup, so there's nothing useful to surface, and the manual search in `CoverDialog` remains
// available to fix it. Returns whether a cover was applied.
async fn try_auto_apply_cover(app_handle: &tauri::AppHandle, project_id: &str, folder_name: &str) -> bool {
    let cleaned = clean_title(folder_name);
    if cleaned.is_empty() {
        return false;
    }

    let Ok(candidates) = search_anilist(&cleaned, 1).await else {
        return false;
    };
    let Some(top) = candidates.into_iter().next() else {
        return false;
    };

    // Compare against whichever of the (English-preferred) display title and the romaji
    // title is closer — scanlation folder names are almost always romaji, and an English
    // localisation title can differ from it completely (e.g. "Kaoru Hana wa Rin to Saku" vs
    // "The Fragrant Flower Blooms With Dignity"), so comparing only against `top.title`
    // would reject plenty of correct matches.
    let cleaned_lower = cleaned.to_lowercase();
    let mut similarity = strsim::jaro_winkler(&cleaned_lower, &top.title.to_lowercase());
    if let Some(romaji) = &top.romaji_title {
        similarity = similarity.max(strsim::jaro_winkler(&cleaned_lower, &romaji.to_lowercase()));
    }
    if similarity < AUTO_APPLY_SIMILARITY_THRESHOLD {
        return false;
    }

    apply_cover_internal(app_handle, project_id, top.anilist_id, &top.title, &top.image_url)
        .await
        .is_ok()
}

// Spawns a background task that attempts an automatic Anilist cover lookup for one
// newly-discovered project, bounded by `CoverLookupSemaphore` so a bulk import doesn't fire
// unlimited concurrent requests. Called from `insert_new_projects`'s call sites
// (`list_projects`, `set_library_root`, and the library watcher) — never awaited by them,
// since blocking project discovery on a network round-trip per project would make those
// commands as slow as "number of new projects × network latency".
pub fn spawn_auto_cover_lookup(app_handle: &tauri::AppHandle, project_id: String, project_name: String) {
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let semaphore = app_handle.state::<CoverLookupSemaphore>().0.clone();
        // Holding the permit for the whole lookup (search + download + encode) is what
        // actually bounds concurrency — acquiring it is the only thing that queues.
        let Ok(_permit) = semaphore.acquire().await else {
            return;
        };

        if try_auto_apply_cover(&app_handle, &project_id, &project_name).await {
            emit_projects_updated(&app_handle);
        }
    });
}

// Re-queries the full project list and emits it under the same "projects-updated" event the
// library watcher already uses (see watch.rs) — the frontend's `ProjectList` is already
// listening for it, so a background cover resolving in doesn't need its own event contract.
fn emit_projects_updated(app_handle: &tauri::AppHandle) {
    let db_state = app_handle.state::<DbState>();
    let Ok(conn) = db_state.0.lock() else { return };
    if let Ok(projects) = crate::commands::projects::query_all_projects(&conn) {
        let _ = app_handle.emit("projects-updated", projects);
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum BackfillEvent {
    // One project's lookup resolved (matched or skipped) — `current` counts attempts so
    // far, `applied` distinguishes a successful match from a skip in the progress UI.
    Progress {
        current: usize,
        total: usize,
        applied: bool,
    },
    Done {
        applied: usize,
        total: usize,
    },
}

/// Runs the automatic lookup for every project currently missing a cover — the bulk
/// counterpart to the automatic-on-discovery path, for projects that already existed before
/// this feature (and so never got an automatic lookup) or whose lookup was skipped for
/// falling below the similarity threshold. Streams progress over `on_event` for the
/// triggering button's own loading UI; each individual match still goes through
/// `try_auto_apply_cover` → `emit_projects_updated`, so the project list updates live exactly
/// as it does for automatic per-project lookups.
#[tauri::command]
pub async fn auto_fill_missing_covers(
    app_handle: tauri::AppHandle,
    on_event: tauri::ipc::Channel<BackfillEvent>,
) -> Result<(), String> {
    let targets: Vec<(String, String)> = {
        let db_state = app_handle.state::<DbState>();
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name FROM projects WHERE cover_path IS NULL")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let total = targets.len();
    let semaphore = app_handle.state::<CoverLookupSemaphore>().0.clone();

    // Spawn every lookup up front — the semaphore (shared with automatic per-project
    // lookups) is what actually serialises them to a handful at a time, not this loop.
    let mut handles = Vec::with_capacity(total);
    for (project_id, name) in targets {
        let app_handle = app_handle.clone();
        let semaphore = semaphore.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            let Ok(_permit) = semaphore.acquire().await else {
                return false;
            };
            let applied = try_auto_apply_cover(&app_handle, &project_id, &name).await;
            if applied {
                emit_projects_updated(&app_handle);
            }
            applied
        }));
    }

    let mut applied_count = 0;
    for (i, handle) in handles.into_iter().enumerate() {
        let applied = handle.await.unwrap_or(false);
        if applied {
            applied_count += 1;
        }
        let _ = on_event.send(BackfillEvent::Progress {
            current: i + 1,
            total,
            applied,
        });
    }

    let _ = on_event.send(BackfillEvent::Done {
        applied: applied_count,
        total,
    });

    Ok(())
}
