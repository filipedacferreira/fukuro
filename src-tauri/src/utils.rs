use std::path::Path;

use regex::Regex;

// Converts a filesystem path to a forward-slash string for consistent cross-platform storage.
pub fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

// Current time as Unix epoch seconds. Used for `created_at` and, more recently,
// `last_exported_at`/`last_synced_at` (see db.rs's v9 migration) — plain epoch integers
// rather than an ISO-8601 string, since nothing in this codebase otherwise needs a
// date/time crate and the client-side "outdated" comparison / "X days ago" display just
// want two numbers to subtract.
pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
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

// Orders two chapter folder names for reading order. Folder names alone can't be
// natural-sorted: scanlation downloaders prefix chapters with a volume ("Vol.01 Ch.0001")
// only once that volume has been released, so the newest chapters ("Ch.0026") have no
// prefix and a plain sort puts them *before* Vol.01 ("C" < "V").
// Instead compare by the extracted chapter number first, then fall back to natural sort for:
//   - ties (the same chapter from two scanlation groups, e.g. two "Ch.0037.5" folders),
//     so the result stays deterministic;
//   - folders with no number at all ("Extras"), which go after every numbered chapter.
pub fn compare_chapter_names(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let by_number = match (extract_chapter_number(a), extract_chapter_number(b)) {
        // f64 has no total order (NaN), so `Ord`/`cmp` aren't available — `total_cmp`
        // is the float method that always returns an Ordering. Parsed chapter numbers
        // are never NaN, so this behaves like ordinary numeric comparison.
        (Some(x), Some(y)) => x.total_cmp(&y),
        // Numbered chapters before un-numbered ones.
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    };

    // `then_with` only runs the closure when `by_number` is Equal — i.e. a tie-breaker.
    by_number.then_with(|| natural_sort_key(a).cmp(&natural_sort_key(b)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(names: &[&str]) -> Vec<String> {
        let mut v: Vec<String> = names.iter().map(|s| s.to_string()).collect();
        v.sort_by(|a, b| compare_chapter_names(a, b));
        v
    }

    // Newer chapters without a volume prefix must come after the volumed ones, not before.
    #[test]
    fn unvolumed_chapters_sort_after_volumed_ones() {
        let result = sorted(&[
            "Ch.0026 (en) [Uwaki Scans]",
            "Vol.03 Ch.0025.5 (en) [Uwaki Scans]",
            "Vol.01 Ch.0001 (en) [Uwaki Scans]",
            "Vol.01 Ch.0009.6 - Volume 1 Magazine Bonus Chapter (en) [Uwaki Scans]",
            "Vol.01 Ch.0009.1 - Volume 1 Extras (en) [Uwaki Scans]",
            "Vol.02 Ch.0010 (en) [Uwaki Scans]",
        ]);
        assert_eq!(
            result,
            [
                "Vol.01 Ch.0001 (en) [Uwaki Scans]",
                "Vol.01 Ch.0009.1 - Volume 1 Extras (en) [Uwaki Scans]",
                "Vol.01 Ch.0009.6 - Volume 1 Magazine Bonus Chapter (en) [Uwaki Scans]",
                "Vol.02 Ch.0010 (en) [Uwaki Scans]",
                "Vol.03 Ch.0025.5 (en) [Uwaki Scans]",
                "Ch.0026 (en) [Uwaki Scans]",
            ]
        );
    }

    // Plain numbered folders still sort numerically (2 before 10), and un-numbered ones go last.
    #[test]
    fn numbers_compare_numerically_and_unnumbered_go_last() {
        assert_eq!(sorted(&["Extras", "Chapter 10", "Chapter 2"]), ["Chapter 2", "Chapter 10", "Extras"]);
    }

    // Two releases of the same chapter tie on number and fall back to natural sort.
    #[test]
    fn same_chapter_number_falls_back_to_name() {
        assert_eq!(
            sorted(&["Ch.0037.5 (en) [Uwaki Scans]", "Ch.0037.5 (en) [jacktherippertransl]"]),
            ["Ch.0037.5 (en) [Uwaki Scans]", "Ch.0037.5 (en) [jacktherippertransl]"]
        );
    }
}
