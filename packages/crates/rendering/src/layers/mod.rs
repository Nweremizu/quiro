mod annotation;
mod background;
mod blur;
mod camera;
mod captions;
mod cursor;
mod cursor_theme;
mod display;
mod frame;
mod keyboard;
mod mask;
mod text;

/// `glyphon::FontSystem` is `cosmic_text::FontSystem` re-exported verbatim
/// (glyphon's own lib.rs does `pub use cosmic_text::{..., FontSystem, ...}`),
/// so `quiro_text::new_font_system()`'s return type is usable here directly —
/// no conversion, no second implementation. Moved into `quiro-text`
/// (`plans/text-engine/001`) so the layout engine and this renderer share the
/// exact same font resolution instead of building it twice.
pub(crate) use quiro_text::new_font_system;
/// The generation-aware pair, for the one layer that paints user-chosen
/// families (`text`) and so has to notice a font installed mid-session.
/// Captions and the keyboard overlay draw with fixed families and keep the
/// plain constructor.
pub(crate) use quiro_text::{font_generation, new_font_system_at};

pub use annotation::*;
pub use background::*;
pub use blur::*;
pub use camera::*;
pub use captions::*;
pub use cursor::*;
pub use display::*;
pub use frame::*;
pub use keyboard::*;
pub use mask::*;
pub use text::*;
