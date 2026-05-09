use image::ImageEncoder;
use image::codecs::jpeg::JpegEncoder;
use rusqlite::params;
use serde::Serialize;
use tauri::Manager;

use crate::db::DbState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnilistResult {
    pub title: String,
    pub cover_path: String,
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

// Re-encodes any supported image format to JPEG quality 100 and writes it to `dest`.
fn encode_cover(source_bytes: &[u8], dest: &std::path::Path) -> Result<(), String> {
    let img = image::load_from_memory(source_bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    // Convert to RGB for JPEG (JPEG doesn't support alpha)
    let rgb = image::DynamicImage::ImageRgba8(rgba).to_rgb8();

    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, 100);
    encoder
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| e.to_string())?;

    std::fs::write(dest, &buf).map_err(|e| e.to_string())?;
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
) -> Result<String, String> {
    let dest = covers_dir(&app_handle)?.join(format!("{project_id}.jpg"));

    let source_bytes = std::fs::read(&image_path).map_err(|e| e.to_string())?;
    encode_cover(&source_bytes, &dest)?;

    let cover_path = dest.to_string_lossy().to_string();

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET cover_path = ?1 WHERE id = ?2",
        params![cover_path, project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(cover_path)
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

    let media = gql_resp
        .pointer("/data/Media")
        .ok_or("Manga not found on Anilist")?;

    // Prefer English title, fall back to romaji
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

    // Step 3: re-encode and store (CPU-bound — run on a blocking thread so we
    // don't stall the async executor during image decoding/encoding)
    let dest = covers_dir(&app_handle)?.join(format!("{project_id}.jpg"));
    let dest_clone = dest.clone();
    let img_bytes_vec = img_bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || encode_cover(&img_bytes_vec, &dest_clone))
        .await
        .map_err(|e| format!("Encoding task failed: {e}"))??;

    let cover_path = dest.to_string_lossy().to_string();

    // Step 4: persist to DB
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET cover_path = ?1, anilist_id = ?2 WHERE id = ?3",
        params![cover_path, anilist_id, project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(AnilistResult { title, cover_path })
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

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET cover_path = NULL, anilist_id = NULL WHERE id = ?1",
        params![project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
