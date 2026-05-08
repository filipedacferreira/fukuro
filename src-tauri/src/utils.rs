use std::path::Path;

// Converts a filesystem path to a forward-slash string for consistent cross-platform storage.
pub fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

// Returns true for file extensions the image crate can decode.
// Shared across images.rs, thumbnails.rs, projects.rs, and export.rs.
pub fn is_image_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("jpg") | Some("jpeg") | Some("png") | Some("webp") | Some("gif") | Some("avif")
    )
}

// Splits a filename into alternating text and zero-padded numeric segments.
// This produces a sort key where "ch10.jpg" correctly comes after "ch9.jpg"
// instead of before it (which plain alphabetical sort would do).
//
// Example: "ch9.jpg"  → ["ch", "00000000000000000009", ".jpg"]
//          "ch10.jpg" → ["ch", "00000000000000000010", ".jpg"]
pub fn natural_sort_key(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_num = false;

    for c in s.chars() {
        if c.is_ascii_digit() {
            if !in_num {
                // Switching from text to number — flush the text segment.
                if !current.is_empty() {
                    parts.push(current.clone());
                    current.clear();
                }
                in_num = true;
            }
            current.push(c);
        } else {
            if in_num {
                // Switching from number to text — zero-pad and flush the number segment.
                // Padding to 20 digits ensures numeric segments sort correctly as strings.
                parts.push(format!("{:0>20}", current));
                current.clear();
                in_num = false;
            }
            current.push(c);
        }
    }

    // Flush whatever's left in `current`.
    if !current.is_empty() {
        if in_num {
            parts.push(format!("{:0>20}", current));
        } else {
            parts.push(current);
        }
    }

    parts
}
