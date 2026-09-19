fn main() {
    // `option_env!` reads whatever the compiler process saw, and Cargo does
    // not track that as a rebuild trigger on its own — without this, a
    // rebuild after only changing these in `.env`/CI can silently reuse the
    // stale cached object file.
    println!("cargo:rerun-if-env-changed=QUIRO_POSTHOG_API_KEY");
    println!("cargo:rerun-if-env-changed=QUIRO_TRANSCRIPTION_MODELS_BASE_URL");
    tauri_build::build()
}
