use tauri::{AppHandle, Wry};
use tauri_plugin_store::StoreExt;

pub fn initialize(app: &AppHandle<Wry>) -> anyhow::Result<()> {
    if let Some(value) =
        std::env::args().find_map(|arg| arg.strip_prefix("--launch-window=").map(str::to_owned))
    {
        anyhow::ensure!(
            matches!(value.as_str(), "classic" | "toolbar"),
            "Use --launch-window=classic or --launch-window=toolbar"
        );
        let store = app.store("store")?;
        store.set("launch_window", serde_json::Value::String(value));
        store.save()?;
    }
    Ok(())
}

pub fn uses_toolbar(app: &AppHandle<Wry>) -> bool {
    app.store("store")
        .ok()
        .and_then(|store| store.get("launch_window"))
        .is_none_or(|value| value.as_str() != Some("classic"))
}
