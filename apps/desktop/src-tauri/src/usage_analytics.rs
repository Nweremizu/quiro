//! Anonymous install/launch counts sent to PostHog, disclosed in the privacy
//! policy alongside crash reporting. No-ops entirely when the build has no
//! `QUIRO_POSTHOG_API_KEY` (e.g. local dev builds).

use tauri::Manager;

use crate::http_client::HttpClient;

const POSTHOG_HOST: &str = "https://eu.i.posthog.com";
const INSTALL_ID_FILE: &str = "usage-install-id.txt";

pub fn init(app: &tauri::AppHandle) {
    // CI expands an unset secret to `""` rather than leaving the env var
    // unset, so `option_env!` alone would see `Some("")`.
    let Some(api_key) = option_env!("QUIRO_POSTHOG_API_KEY").filter(|key| !key.is_empty()) else {
        return;
    };

    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&data_dir);
    let (install_id, is_new_install) = load_or_create_install_id(&data_dir.join(INSTALL_ID_FILE));

    let client = HttpClient::default();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let os = std::env::consts::OS.to_string();

    tauri::async_runtime::spawn(async move {
        if is_new_install {
            capture_event(
                &client,
                api_key,
                &install_id,
                "app_installed",
                &app_version,
                &os,
            )
            .await;
        }
        capture_event(
            &client,
            api_key,
            &install_id,
            "app_launched",
            &app_version,
            &os,
        )
        .await;
    });
}

fn load_or_create_install_id(path: &std::path::Path) -> (String, bool) {
    if let Ok(existing) = std::fs::read_to_string(path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            return (existing.to_string(), false);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Err(error) = std::fs::write(path, &id) {
        tracing::warn!(%error, "Failed to persist anonymous install id");
    }
    (id, true)
}

async fn capture_event(
    client: &HttpClient,
    api_key: &str,
    distinct_id: &str,
    event: &str,
    app_version: &str,
    os: &str,
) {
    let body = serde_json::json!({
        "api_key": api_key,
        "event": event,
        "distinct_id": distinct_id,
        "properties": {
            "app_version": app_version,
            "os": os,
            "$process_person_profile": false,
        },
    });
    if let Err(error) = client
        .post(format!("{POSTHOG_HOST}/capture/"))
        .json(&body)
        .send()
        .await
    {
        tracing::warn!(%error, event, "Failed to send usage analytics event");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_creates_and_persists_a_new_id() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(INSTALL_ID_FILE);

        let (id, is_new) = load_or_create_install_id(&path);

        assert!(is_new);
        assert!(!id.is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), id);
    }

    #[test]
    fn later_runs_reuse_the_persisted_id() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(INSTALL_ID_FILE);
        let (first_id, _) = load_or_create_install_id(&path);

        let (second_id, is_new) = load_or_create_install_id(&path);

        assert!(!is_new);
        assert_eq!(first_id, second_id);
    }

    #[test]
    fn a_blank_file_is_treated_as_no_id_yet() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(INSTALL_ID_FILE);
        std::fs::write(&path, "  \n").unwrap();

        let (id, is_new) = load_or_create_install_id(&path);

        assert!(is_new);
        assert!(!id.is_empty());
    }
}
