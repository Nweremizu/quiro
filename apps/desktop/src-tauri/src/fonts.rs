use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Font management for the text pickers (`plans/text-engine/004`'s panel, and
// its follow-up). Two sources feed one list:
//
//   - the machine's own installed fonts, which `quiro-text`'s `FontSystem`
//     already scanned at startup and is the authority on, and
//   - Google Fonts, downloaded on demand into `<app data>/fonts` and loaded
//     into that same `FontSystem` so cosmic-text can actually shape with
//     them.
//
// The second half is what makes the picker honest: a family the renderer
// cannot resolve is one the webview must not offer, so nothing is listed as
// available until its bytes are in `fontdb`. Everything downstream —
// `measure_text`, `Fragment::font_face`, `font_face_bytes` shipping the face
// to the webview (`plans/text-engine/003`) — then works unchanged.

/// Google's own catalogue endpoint. Public, no API key, and the same one
/// fonts.google.com itself calls; the response is JSON behind an XSSI
/// guard prefix, stripped in `fetch_google_catalog`.
const GOOGLE_METADATA_URL: &str = "https://fonts.google.com/metadata/fonts";

/// Where the actual font files come from. Google's CSS endpoints no longer
/// serve anything `fontdb` can read: with a modern `User-Agent` they return
/// woff2, and the old trick of asking as a decade-old browser now returns an
/// extensionless `/l/font?kit=…` URL whose bytes are neither TrueType nor
/// OpenType (verified: `Content-Type: text/html`, magic `b4f50400`). The
/// upstream repository the whole catalogue is built from serves the real
/// `.ttf`, and needs no API key.
const GOOGLE_FONTS_REPO: &str = "https://api.github.com/repos/google/fonts/contents";
/// GitHub rejects API requests without one.
const USER_AGENT: &str = "quiro-desktop";
/// Where a family sits depends on its licence, and the catalogue does not say
/// which — so try each. Ordered by how much of the library each holds.
const LICENCE_DIRS: [&str; 3] = ["ofl", "apache", "ufl"];

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GoogleFont {
    pub family: String,
    /// `sans-serif`, `serif`, `display`, `handwriting` or `monospace`, as
    /// Google categorises it — the picker groups by this.
    pub category: String,
}

fn fonts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data directory: {e}"))?
        .join("fonts");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {dir:?}: {e}"))?;
    Ok(dir)
}

/// Loads every font previously downloaded into `<app data>/fonts` back into
/// the shaping engine. Called once during startup, before any window opens,
/// so a project referencing a downloaded family renders correctly on the
/// first frame rather than after the picker happens to be opened.
///
/// Sorted by file name: `quiro-text` assigns `fontdb::ID`s in registration
/// order, and keeping that order stable across runs keeps ids comparable
/// with what a previous run handed the webview.
pub fn load_installed_fonts(app: &AppHandle) {
    let Ok(dir) = fonts_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };

    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            matches!(
                path.extension()
                    .and_then(|e| e.to_str())
                    .map(str::to_lowercase)
                    .as_deref(),
                Some("ttf" | "otf" | "ttc")
            )
        })
        .collect();
    files.sort();

    let mut loaded = 0usize;
    for path in files {
        let Ok(data) = std::fs::read(&path) else {
            continue;
        };
        if quiro_text::install_font(data).is_empty() {
            tracing::warn!("Ignoring unreadable font file {path:?}");
        } else {
            loaded += 1;
        }
    }
    if loaded > 0 {
        tracing::info!(count = loaded, "Loaded downloaded fonts");
    }
}

/// Every family the shaping engine can resolve right now — the system scan
/// plus anything already downloaded. The picker's "available" list.
#[tauri::command]
#[specta::specta]
pub async fn list_font_families() -> Vec<quiro_text::FontFamily> {
    quiro_text::list_font_families()
}

/// Google's catalogue, for the picker's browse-and-search half. Cached to
/// `<app data>/fonts/catalog.json` on first success, and served from there
/// when the network is unavailable — a picker that empties itself offline
/// would be worse than one showing a slightly stale list.
#[tauri::command]
#[specta::specta]
pub async fn google_font_catalog(app: AppHandle) -> Result<Vec<GoogleFont>, String> {
    let cache_path = fonts_dir(&app)?.join("catalog.json");

    match fetch_google_catalog().await {
        Ok(fonts) => {
            if let Ok(json) = serde_json::to_string(&fonts) {
                let _ = std::fs::write(&cache_path, json);
            }
            Ok(fonts)
        }
        Err(error) => {
            let cached = std::fs::read_to_string(&cache_path)
                .ok()
                .and_then(|json| serde_json::from_str::<Vec<GoogleFont>>(&json).ok());
            match cached {
                Some(fonts) => {
                    tracing::warn!("Using cached font catalogue: {error}");
                    Ok(fonts)
                }
                None => Err(error),
            }
        }
    }
}

async fn fetch_google_catalog() -> Result<Vec<GoogleFont>, String> {
    let body = reqwest::get(GOOGLE_METADATA_URL)
        .await
        .map_err(|e| format!("Could not reach Google Fonts: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Could not read the Google Fonts catalogue: {e}"))?;

    // The response opens with an XSSI guard (`)]}'`) that is not JSON.
    let json = body
        .find('{')
        .map(|start| &body[start..])
        .ok_or_else(|| "Google Fonts returned no JSON".to_string())?;

    #[derive(Deserialize)]
    struct Metadata {
        #[serde(rename = "familyMetadataList")]
        family_metadata_list: Vec<FamilyMetadata>,
    }
    #[derive(Deserialize)]
    struct FamilyMetadata {
        family: String,
        category: String,
    }

    let metadata: Metadata = serde_json::from_str(json)
        .map_err(|e| format!("Could not parse the Google Fonts catalogue: {e}"))?;

    Ok(metadata
        .family_metadata_list
        .into_iter()
        .map(|entry| GoogleFont {
            family: entry.family,
            // Google prints "Sans Serif" — title case, with a space. The
            // picker groups by "sans-serif", so lowercasing alone left every
            // family in a category no group matched, and the whole catalogue
            // rendered as nothing at all. Hyphenate as well as lowercase.
            category: entry.category.to_lowercase().replace(' ', "-"),
        })
        .collect())
}

/// Downloads one Google family and loads it into the shaping engine, so it
/// becomes usable everywhere a system font is. Returns the family names the
/// downloaded file actually contained — normally just the one asked for.
///
/// Idempotent: a family already on disk is loaded from there rather than
/// re-fetched.
#[tauri::command]
#[specta::specta]
pub async fn install_google_font(app: AppHandle, family: String) -> Result<Vec<String>, String> {
    if family.trim().is_empty() {
        return Err("No font family given".to_string());
    }

    // Already resolvable (a system install, or downloaded in an earlier
    // session and loaded at startup) — nothing to do.
    if quiro_text::list_font_families()
        .iter()
        .any(|f| f.name.eq_ignore_ascii_case(&family))
    {
        return Ok(vec![family]);
    }

    let path = fonts_dir(&app)?.join(format!("{}.ttf", sanitize_file_name(&family)));
    let data = match std::fs::read(&path) {
        Ok(data) => data,
        Err(_) => {
            let data = download_google_font(&family).await?;
            std::fs::write(&path, &data)
                .map_err(|e| format!("Could not save {family} to {path:?}: {e}"))?;
            data
        }
    };

    let installed = quiro_text::install_font(data);
    if installed.is_empty() {
        // Don't leave a file behind that will fail to load again on every
        // startup.
        let _ = std::fs::remove_file(&path);
        return Err(format!("{family} downloaded, but held no usable font face"));
    }
    Ok(installed)
}

/// Filenames are ours, not the user's — but a family name reaches this from
/// a catalogue fetched over the network, so it never becomes a path segment
/// unfiltered.
fn sanitize_file_name(family: &str) -> String {
    family
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// A family's directory in the repository: "Noto Sans JP" -> "notosansjp".
/// Verified against the live repo for single- and multi-word families.
fn repo_slug(family: &str) -> String {
    family
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

async fn download_google_font(family: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Could not build an HTTP client: {e}"))?;

    let slug = repo_slug(family);
    if slug.is_empty() {
        return Err(format!("{family:?} has no usable directory name"));
    }

    #[derive(Deserialize)]
    struct Entry {
        name: String,
        download_url: Option<String>,
    }

    let mut last_error = format!("{family} is not in the Google Fonts repository");
    for dir in LICENCE_DIRS {
        let listing = client
            .get(format!("{GOOGLE_FONTS_REPO}/{dir}/{slug}"))
            .send()
            .await
            .map_err(|e| format!("Could not reach the font repository: {e}"))?;

        if listing.status() == reqwest::StatusCode::FORBIDDEN {
            // Unauthenticated GitHub allows 60 requests an hour, and a bare
            // 403 would otherwise read as "this font does not exist".
            return Err(
                "The font repository is rate limiting this machine — try again shortly".to_string(),
            );
        }
        if !listing.status().is_success() {
            continue;
        }

        let entries: Vec<Entry> = listing
            .json()
            .await
            .map_err(|e| format!("Could not read the font listing for {family}: {e}"))?;

        // Prefer the upright face: a family's directory holds italics too, and
        // installing those as the family would render everything slanted. A
        // variable font (`Inter[opsz,wght].ttf`) is a perfectly good TrueType
        // and is what most families ship now.
        let file = entries
            .iter()
            .filter(|entry| {
                let lower = entry.name.to_lowercase();
                (lower.ends_with(".ttf") || lower.ends_with(".otf")) && !lower.contains("italic")
            })
            .min_by_key(|entry| entry.name.len())
            .and_then(|entry| entry.download_url.clone());

        let Some(url) = file else {
            last_error = format!("{family} has no usable font file in the repository");
            continue;
        };

        let bytes = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Could not download {family}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Could not download {family}: {e}"))?
            .bytes()
            .await
            .map_err(|e| format!("Could not read {family}: {e}"))?;

        return Ok(bytes.to_vec());
    }

    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_slugs_match_the_repository_layout() {
        // Checked against the live repo: ofl/opensans, ofl/notosansjp,
        // ofl/playfairdisplay all resolve.
        assert_eq!(repo_slug("Open Sans"), "opensans");
        assert_eq!(repo_slug("Noto Sans JP"), "notosansjp");
        assert_eq!(repo_slug("Playfair Display"), "playfairdisplay");
        assert_eq!(repo_slug("Inter"), "inter");
    }

    /// Punctuation and non-ASCII are dropped rather than escaped — the
    /// repository's own directories are alphanumeric only.
    #[test]
    fn repo_slugs_drop_everything_that_is_not_alphanumeric() {
        assert_eq!(repo_slug("Libre Baskerville!"), "librebaskerville");
        assert_eq!(repo_slug("  Roboto  "), "roboto");
        assert_eq!(repo_slug("///"), "");
    }

    /// The catalogue prints "Sans Serif"; the picker groups by "sans-serif".
    /// Lowercasing alone left the two unable to match, which is what made the
    /// whole Google half of the picker render empty.
    #[test]
    fn catalogue_categories_become_the_pickers_ids() {
        let normalise = |c: &str| c.to_lowercase().replace(' ', "-");
        assert_eq!(normalise("Sans Serif"), "sans-serif");
        assert_eq!(normalise("Serif"), "serif");
        assert_eq!(normalise("Display"), "display");
        assert_eq!(normalise("Handwriting"), "handwriting");
        assert_eq!(normalise("Monospace"), "monospace");
    }

    /// A catalogue entry is remote input; it must not be able to walk out of
    /// the fonts directory when it becomes a file name.
    #[test]
    fn family_names_cannot_escape_the_fonts_directory() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "------etc-passwd");
        assert_eq!(sanitize_file_name("Noto Sans JP"), "Noto-Sans-JP");
    }
}
