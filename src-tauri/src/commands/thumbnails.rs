use rayon::prelude::*;
use rusqlite::params;
use serde::Serialize;
use std::path::Path;
use tauri::Manager;

use crate::db::DbState;
use crate::utils::{is_image_file, natural_sort_key, normalize_path};

// Emitted through the Tauri Channel during thumbnail generation.
// The frontend receives these one by one and swaps each image's src.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailUpdate {
    pub image_path: String,
    pub thumbnail_path: String,
}

// Downscales a decoded image to `target_width` (preserving aspect ratio, never upscaling)
// and returns it JPEG-encoded at quality 75. Shared by chapter-image thumbnails
// (`ensure_thumbnail` below) and project cover thumbnails (`commands::cover`), since both
// are small UI-only previews backed by a separate full-resolution master file.
pub fn resize_to_jpeg(img: image::DynamicImage, target_width: u32) -> Result<Vec<u8>, String> {
    // Convert to RGB8 (3 bytes per pixel, no alpha) — the format fast_image_resize expects.
    // This also normalises PNGs with transparency, grayscale images, etc.
    let rgb = img.to_rgb8();
    let (src_w, src_h) = rgb.dimensions();

    // Scale down to `target_width`, preserving aspect ratio.
    // .min(src_w) avoids upscaling images that are already smaller than the target.
    let dst_w = target_width.min(src_w);
    let dst_h = ((src_h as f64 * dst_w as f64) / src_w as f64).round() as u32;

    // fast_image_resize uses SIMD instructions (AVX2/SSE4 on x86, NEON on ARM)
    // for much faster resizing than the pure-Rust image crate resizer.
    use fast_image_resize::{
        FilterType as FirFilter, ResizeAlg, ResizeOptions, Resizer,
        images::Image as FirImage, PixelType,
    };

    // Wrap the raw pixel bytes in a fast_image_resize view.
    // from_slice_u8 requires &mut because it may need to reinterpret the buffer.
    let mut rgb_raw = rgb.into_raw();
    let src_fir = FirImage::from_slice_u8(src_w, src_h, &mut rgb_raw, PixelType::U8x3)
        .map_err(|e| e.to_string())?;

    // Allocate the destination buffer at the target size.
    let mut dst_fir = FirImage::new(dst_w, dst_h, PixelType::U8x3);

    // Bilinear filter: good balance of speed and quality for downscaling.
    // Lanczos3 would be sharper but ~3× slower — not worth it at this size.
    Resizer::new()
        .resize(
            &src_fir,
            &mut dst_fir,
            &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FirFilter::Bilinear)),
        )
        .map_err(|e| e.to_string())?;

    // Encode the resized buffer as JPEG at quality 75. Quality 75 is indistinguishable
    // from 85+ at these sizes and encodes ~20% faster.
    let mut buf = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 75)
        .encode(dst_fir.buffer(), dst_w, dst_h, image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

// Generates a thumbnail for a single image and writes it to `dest`.
// Skips the work entirely if the thumbnail already exists (cache hit).
// Not a Tauri command — called internally by generate_chapter_thumbnails_stream.
pub fn ensure_thumbnail(source: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        return Ok(()); // already cached, nothing to do
    }

    // Create the thumbnail directory if this is the first image for this chapter.
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Decode the source image into an in-memory pixel buffer.
    let img = image::ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;

    let bytes = resize_to_jpeg(img, 200)?;
    std::fs::write(dest, &bytes).map_err(|e| e.to_string())
}

// Generates thumbnails for all images in a chapter that don't already have one cached.
// Returns immediately — all heavy work runs in a detached background thread.
// Progress is streamed back to the frontend through the Tauri Channel one image at a time.
#[tauri::command]
pub fn generate_chapter_thumbnails_stream(
    chapter_id: String,
    state: tauri::State<DbState>,
    app_handle: tauri::AppHandle,
    on_event: tauri::ipc::Channel<ThumbnailUpdate>,
) -> Result<(), String> {
    // Read the folder path from the DB before spawning the thread,
    // since tauri::State can't be moved across thread boundaries.
    let folder_path = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT folder_path FROM chapters WHERE id = ?1",
            params![chapter_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
    };

    let thumb_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails")
        .join(&chapter_id);

    // `move` transfers ownership of folder_path, thumb_dir, and on_event into the thread.
    // The thread outlives this function, so it must own everything it uses.
    std::thread::spawn(move || {
        let Ok(entries) = std::fs::read_dir(&folder_path) else {
            return; // folder disappeared or unreadable — silently abort
        };

        // Collect and sort before processing so thumbnails stream in page order.
        let mut images: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().map(|t| t.is_file()).unwrap_or(false)
                    && is_image_file(&e.path())
            })
            .collect();

        images.sort_by(|a, b| {
            let ka = natural_sort_key(&a.file_name().to_string_lossy());
            let kb = natural_sort_key(&b.file_name().to_string_lossy());
            ka.cmp(&kb)
        });

        // par_iter() from rayon: runs the closure on all images in parallel,
        // distributing work across all CPU cores automatically.
        images.par_iter().for_each(|entry| {
            let path = normalize_path(&entry.path());
            let filename = entry.file_name().to_string_lossy().to_string();
            let stem = Path::new(&filename)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let thumb = thumb_dir.join(format!("{stem}.jpg"));

            // ensure_thumbnail skips images that already have a cached thumbnail.
            if ensure_thumbnail(Path::new(&path), &thumb).is_ok() {
                let thumbnail_path = normalize_path(&thumb);
                // Send the update through the Channel — the frontend receives it
                // immediately and swaps out the blurred image for the sharp thumbnail.
                let _ = on_event.send(ThumbnailUpdate { image_path: path, thumbnail_path });
            }
        });
    });

    // Return Ok immediately — the thread is running in the background.
    Ok(())
}

// Wipes the entire thumbnail cache directory.
// Exposed as Tools → Clear Thumbnail Cache in the native menu bar (dev utility).
#[tauri::command]
pub fn clear_thumbnail_cache(app_handle: tauri::AppHandle) -> Result<(), String> {
    let thumb_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    if thumb_dir.exists() {
        std::fs::remove_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
