//! Saved editor looks: a `ProjectConfiguration` without its timeline, so
//! applying one restyles a recording without touching its edits.
//!
//! Read and written entirely by the frontend through tauri-plugin-store (see
//! `store.ts`'s `presetsStore`, same "store" file, "presets" key). This module
//! exists so the shape is defined once, in Rust, and exported to TypeScript
//! with every other bound type — Cap keeps a Rust-side accessor API here too,
//! but nothing on this side reads presets.

use quiro_project::ProjectConfiguration;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Type, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PresetsStore {
    presets: Vec<Preset>,
    default: Option<u32>,
}

#[derive(Serialize, Deserialize, Type, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    name: String,
    pub config: ProjectConfiguration,
}
