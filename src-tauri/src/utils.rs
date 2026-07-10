use std::path::Path;

use regex::Regex;

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

// Pulls a chapter number out of a folder name for display as "Chapter {n}" — e.g.
// "Ch.033 (2020)" -> 33.0, "Vol.2 Ch.15" -> 15.0, "Chapter 33.5" -> 33.5.
// Two passes, both case-insensitive:
//   1. A number immediately after a "c"/"ch"/"chapter" keyword — preferred, since it
//      disambiguates from volume numbers or a year elsewhere in the name.
//   2. If no keyword match, the first standalone number anywhere in the name (handles
//      folders that are just "033" with no words at all).
// Returns None if the name has no number at all (e.g. "Extras", "Omake") — callers fall
// back to showing the raw folder name in that case rather than a fabricated number.
pub fn extract_chapter_number(name: &str) -> Option<f64> {
    let keyword = Regex::new(r"(?i)\bc(?:h(?:apter)?)?\.?\s*(\d+(?:\.\d+)?)\b").expect("valid regex");
    if let Some(caps) = keyword.captures(name) {
        return caps.get(1)?.as_str().parse().ok();
    }

    let bare_number = Regex::new(r"\d+(?:\.\d+)?").expect("valid regex");
    bare_number.find(name)?.as_str().parse().ok()
}
