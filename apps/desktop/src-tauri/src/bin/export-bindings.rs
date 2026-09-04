//! Regenerates `apps/desktop/src/utils/tauri.ts` without launching the app.
//!
//! The bindings normally only regenerate inside `run()`'s
//! `#[cfg(debug_assertions)]` block, which means a full desktop launch —
//! a window, a webview and a display. This does the same export and nothing
//! else, so a Rust-side command or type change can be reflected in the
//! frontend from a terminal:
//!
//! ```text
//! cargo run -p quiro-desktop --bin export-bindings
//! ```
//!
//! It is a `[[bin]]` rather than the `--lib` test that used to serve this
//! purpose because a test-harness binary does not load in every environment
//! (`STATUS_ENTRYPOINT_NOT_FOUND` at process start, while the app's own
//! binary runs fine); a plain binary links the way the working app does.

fn main() {
    match quiro_desktop_lib::export_typescript_bindings() {
        Ok(()) => println!("Wrote apps/desktop/src/utils/tauri.ts"),
        Err(error) => {
            eprintln!("Failed to export TypeScript bindings: {error}");
            std::process::exit(1);
        }
    }
}
