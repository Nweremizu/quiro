fn main() {
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    if windows {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("windows-common-controls.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    }
    // `option_env!` reads whatever the compiler process saw, and Cargo does
    // not track that as a rebuild trigger on its own — without this, a
    // rebuild after only changing these in `.env`/CI can silently reuse the
    // stale cached object file.
    println!("cargo:rerun-if-env-changed=QUIRO_POSTHOG_API_KEY");
    println!("cargo:rerun-if-env-changed=QUIRO_TRANSCRIPTION_MODELS_BASE_URL");
    let attributes = if windows {
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
    } else {
        tauri_build::Attributes::new()
    };
    tauri_build::try_build(attributes).expect("tauri build failed");
}
