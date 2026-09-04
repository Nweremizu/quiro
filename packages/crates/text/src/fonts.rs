use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// Building a `FontSystem` scans and parses every installed system font,
/// which costs hundreds of milliseconds to over a second on macOS. cosmic-text
/// explicitly documents that it should be created once and shared. We
/// previously built three of them per `RendererLayers` (text, captions,
/// keyboard) and a fresh `RendererLayers` per editor/screenshot instance, so
/// every open paid that scan several times over.
///
/// Instead, scan the system fonts a single time per process, then cheaply
/// clone the resulting font database (memory-mapped faces are reference
/// counted) for each new `FontSystem`.
fn font_template() -> &'static (String, cosmic_text::fontdb::Database) {
    static FONT_TEMPLATE: OnceLock<(String, cosmic_text::fontdb::Database)> = OnceLock::new();

    FONT_TEMPLATE.get_or_init(|| {
        let font_system = cosmic_text::FontSystem::new();
        let mut db = font_system.db().clone();
        // Pin the generic families to the fonts the editor webview resolves
        // them to. fontdb's stock defaults (e.g. "Arial") often don't match
        // any installed face, in which case cosmic-text silently shapes with
        // an arbitrary fallback font — and canvas overlays measured in the
        // webview no longer match what the renderer draws.
        #[cfg(target_os = "macos")]
        {
            // WKWebView: sans-serif → Helvetica, serif → Times, monospace →
            // Courier.
            db.set_sans_serif_family("Helvetica");
            db.set_serif_family("Times New Roman");
            db.set_monospace_family("Courier New");
        }
        #[cfg(windows)]
        {
            // WebView2 (Chromium): sans-serif → Arial, serif → Times New
            // Roman, monospace → Consolas.
            db.set_sans_serif_family("Arial");
            db.set_serif_family("Times New Roman");
            db.set_monospace_family("Consolas");
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            db.set_sans_serif_family("DejaVu Sans");
            db.set_serif_family("DejaVu Serif");
            db.set_monospace_family("DejaVu Sans Mono");
        }
        (font_system.locale().to_string(), db)
    })
}

/// Font files registered after the initial system scan — a Google Font the
/// user picked, or any other file they pointed at. Append-only and ordered,
/// which is what keeps `fontdb::ID`s identical across every `FontSystem`
/// this module hands out: each one starts from the same template clone and
/// then loads exactly these, in exactly this order, so the slotmap keys
/// fontdb assigns line up. `plans/text-engine/003`'s `FaceId` registry and
/// glyphon's own glyph cache both depend on that.
static EXTRA_FONTS: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());

/// Bumped whenever `EXTRA_FONTS` grows. A consumer holding a long-lived
/// `FontSystem` (`quiro-text`'s engine, `quiro-rendering`'s `TextLayer`)
/// compares this against the generation it built at, and rebuilds when they
/// differ — otherwise a freshly installed family would resolve in one and
/// not the other.
static FONT_GENERATION: AtomicU64 = AtomicU64::new(0);

/// The current font-set revision. See [`FONT_GENERATION`].
pub fn font_generation() -> u64 {
    FONT_GENERATION.load(Ordering::Acquire)
}

/// A font family the user can pick, as the shaping engine sees it — this is
/// the authoritative list, because a family that isn't in here is one
/// cosmic-text cannot shape with, whatever the webview might manage to
/// render as a preview.
#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    pub name: String,
    /// From `fontdb`'s own per-face flag. The only categorisation the system
    /// font database actually carries — serif vs. sans-serif is not
    /// recorded, so the picker only groups Google families (whose catalogue
    /// does carry a category) beyond this.
    pub monospaced: bool,
}

/// Loads a font file into every `FontSystem` handed out from here on, and
/// re-resolves the ones already in use via [`font_generation`]. Returns the
/// family names the file turned out to contain — a caller that downloaded
/// "Inter" gets to confirm that is what it actually got, rather than
/// trusting the filename.
pub fn register_font_data(data: Vec<u8>) -> Vec<String> {
    // Parsed against a throwaway database first: a file that turns out to
    // contain no usable face must not enter `EXTRA_FONTS`, or every
    // `FontSystem` built afterwards pays to parse it again and the
    // generation bump invalidates caches for nothing.
    let mut probe = cosmic_text::fontdb::Database::new();
    probe.load_font_data(data.clone());
    let families: Vec<String> = probe
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .collect();
    if families.is_empty() {
        return Vec::new();
    }

    let mut extras = EXTRA_FONTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    extras.push(data);
    // Release ordering pairs with `font_generation`'s acquire load, so a
    // consumer that sees the new generation also sees the pushed bytes.
    FONT_GENERATION.fetch_add(1, Ordering::Release);

    let mut unique: Vec<String> = Vec::new();
    for family in families {
        if !unique.contains(&family) {
            unique.push(family);
        }
    }
    unique
}

/// A `FontSystem` carrying the system scan plus every font
/// [`register_font_data`] has taken, and the generation it was built at.
/// Callers that cache anything keyed on a `fontdb::ID` should hold onto the
/// generation and rebuild when [`font_generation`] moves past it.
pub fn new_font_system_at() -> (cosmic_text::FontSystem, u64) {
    let (locale, template) = font_template();
    let mut db = template.clone();

    let extras = EXTRA_FONTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // Read the generation *while still holding the lock*, so it can never
    // describe more fonts than were actually applied.
    let generation = font_generation();
    for data in extras.iter() {
        db.load_font_data(data.clone());
    }
    drop(extras);

    (
        cosmic_text::FontSystem::new_with_locale_and_db(locale.clone(), db),
        generation,
    )
}

pub fn new_font_system() -> cosmic_text::FontSystem {
    new_font_system_at().0
}

/// Every family the shaping engine can resolve, de-duplicated and sorted.
/// Built from `db` rather than a fresh scan so it reflects
/// [`register_font_data`] too.
pub fn families_in(db: &cosmic_text::fontdb::Database) -> Vec<FontFamily> {
    let mut families: Vec<FontFamily> = Vec::new();
    for face in db.faces() {
        let Some((name, _)) = face.families.first() else {
            continue;
        };
        // A family arrives once per face (regular, bold, italic…); the
        // picker wants the family, and `monospaced` is a family-level
        // property in practice, so first face wins.
        if families.iter().any(|existing| &existing.name == name) {
            continue;
        }
        families.push(FontFamily {
            name: name.clone(),
            monospaced: face.monospaced,
        });
    }
    families.sort_by_key(|family| family.name.to_lowercase());
    families
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Text overlays are measured in the editor webview with the CSS generic
    /// `sans-serif`; the renderer must resolve the same generic to a real
    /// (and matching) font or boxes and line wrapping diverge from the
    /// rendered pixels.
    #[test]
    fn generic_families_resolve_to_real_fonts() {
        let font_system = new_font_system();
        for family in [
            cosmic_text::fontdb::Family::SansSerif,
            cosmic_text::fontdb::Family::Serif,
            cosmic_text::fontdb::Family::Monospace,
        ] {
            for weight in [400u16, 700] {
                let query = cosmic_text::fontdb::Query {
                    families: &[family],
                    weight: cosmic_text::fontdb::Weight(weight),
                    ..Default::default()
                };
                let id = font_system.db().query(&query);
                let families = id
                    .and_then(|id| font_system.db().face(id))
                    .map(|face| face.families.clone());
                println!("{family:?} weight {weight}: {families:?}");
                assert!(
                    families.is_some(),
                    "{family:?} (weight {weight}) resolved to no font"
                );
            }
        }
    }

    /// The picker's list is the shaping engine's own list — anything in it
    /// must actually be resolvable, or picking it silently falls back.
    #[test]
    fn listed_families_are_resolvable() {
        let font_system = new_font_system();
        let families = families_in(font_system.db());
        assert!(!families.is_empty(), "no system families found at all");

        // Names are unique and sorted, which the picker relies on to group
        // and to key its list rows.
        for pair in families.windows(2) {
            assert!(
                pair[0].name.to_lowercase() <= pair[1].name.to_lowercase(),
                "families are not sorted: {:?} before {:?}",
                pair[0].name,
                pair[1].name
            );
            assert_ne!(pair[0].name, pair[1].name, "duplicate family listed");
        }
    }

    /// Garbage in must not bump the generation: every consumer holding a
    /// `FontSystem` rebuilds on that, so a file with no usable face would
    /// otherwise invalidate every glyph cache in the process for nothing.
    #[test]
    fn unusable_font_data_is_rejected_without_bumping_the_generation() {
        let before = font_generation();
        let added = register_font_data(b"not a font".to_vec());
        assert!(added.is_empty());
        assert_eq!(font_generation(), before);
    }
}
