use image::ImageEncoder;
use image::codecs::jpeg::JpegEncoder;
use rusqlite::params;
use serde::Serialize;
use tauri::Manager;

use crate::commands::thumbnails::resize_to_jpeg;
use crate::db::DbState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverResult {
    pub cover_path: String,
    pub cover_thumbnail_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnilistResult {
    pub title: String,
    pub cover_path: String,
    pub cover_thumbnail_path: String,
}

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

// Re-encodes any supported image format to JPEG quality 100 and writes it to `dest` — this
// is the master file, later embedded verbatim as page 0000 in CBZ exports, so it keeps full
// resolution. A separate 200px-wide thumbnail (for UI display only) is written to
// `thumb_dest` from the same decoded image, avoiding a second decode of `source_bytes`.
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

/// Fetch the cover image from the Anilist GraphQL API using a manga ID.
/// Downloads, re-encodes to JPEG quality 100, and stores it.
/// Returns the manga title (for confirmation) and the stored cover path.
///
/// This command is async so it runs inside Tauri's Tokio runtime — required
/// because reqwest's async client cannot be used from a blocking context, and
/// reqwest::blocking would panic by trying to nest a second runtime inside Tauri's.
#[tauri::command]
pub async fn fetch_anilist_cover(
    project_id: String,
    anilist_id: i64,
    // tauri::State<'_, DbState>: the '_ is an inferred lifetime annotation. Rust requires
    // async functions to name the lifetimes of references in their parameters. The underscore
    // tells Rust to infer the lifetime automatically — it's equivalent to a named lifetime
    // but without having to spell it out.
    state: tauri::State<'_, DbState>,
    app_handle: tauri::AppHandle,
) -> Result<AnilistResult, String> {
    let query = r#"
        query ($id: Int) {
          Media(id: $id, type: MANGA) {
            title { romaji english }
            coverImage { extraLarge }
          }
        }
    "#;

    let client = reqwest::Client::new();

    // Step 1: query Anilist GraphQL
    let gql_body = serde_json::json!({
        "query": query,
        "variables": { "id": anilist_id }
    });

    let gql_resp: serde_json::Value = client
        .post("https://graphql.anilist.co")
        .json(&gql_body)
        .send()
        .await
        .map_err(|e| format!("Anilist request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anilist response: {e}"))?;

    // .pointer() navigates a serde_json Value using a JSON Pointer (RFC 6901).
    // "/data/Media" means: descend into key "data", then key "Media".
    // Returns None if any key is missing, so .ok_or() converts that to an Err.
    let media = gql_resp
        .pointer("/data/Media")
        .ok_or("Manga not found on Anilist")?;

    // Build the display title by trying fields in priority order:
    //   .pointer("/title/english") — navigate to the english title field
    //   .and_then(|v| v.as_str()) — extract as &str (returns None if the JSON value isn't a string)
    //   .filter(|s| !s.is_empty()) — treat empty string the same as missing
    //   .or_else(|| ...) — if english was None/empty, try romaji instead
    //   .unwrap_or("Unknown") — final fallback if both fields are absent
    let title = media
        .pointer("/title/english")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| media.pointer("/title/romaji").and_then(|v| v.as_str()))
        .unwrap_or("Unknown")
        .to_string();

    let cover_url = media
        .pointer("/coverImage/extraLarge")
        .and_then(|v| v.as_str())
        .ok_or("No cover image available")?
        .to_string();

    // Step 2: download the cover image
    let img_bytes = client
        .get(&cover_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download cover: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read cover bytes: {e}"))?;

    // Step 3: store raw bytes.
    // Anilist always serves JPEG; writing the bytes directly avoids a lossy decode→re-encode
    // cycle that would inflate file size without any quality gain.
    let dest = covers_dir(&app_handle)?.join(format!("{project_id}.jpg"));
    std::fs::write(&dest, &img_bytes).map_err(|e| format!("Failed to save cover: {e}"))?;

    let cover_path = dest.to_string_lossy().to_string();

    // Step 4: generate the small UI-display thumbnail. Unlike the master above, this does
    // require a decode — there's no way to shrink a JPEG without decoding it first.
    let thumb_dest = cover_thumbnails_dir(&app_handle)?.join(format!("{project_id}.jpg"));
    let img = image::load_from_memory(&img_bytes).map_err(|e| e.to_string())?;
    let thumb_bytes = resize_to_jpeg(img, 200)?;
    std::fs::write(&thumb_dest, &thumb_bytes).map_err(|e| e.to_string())?;
    let cover_thumbnail_path = thumb_dest.to_string_lossy().to_string();

    // Step 5: persist to DB
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET cover_path = ?1, cover_thumbnail_path = ?2, anilist_id = ?3, cover_title = ?4 WHERE id = ?5",
        params![cover_path, cover_thumbnail_path, anilist_id, title, project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(AnilistResult {
        title,
        cover_path,
        cover_thumbnail_path,
    })
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
