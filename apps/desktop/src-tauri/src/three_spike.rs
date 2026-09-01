//! Throwaway harness for the "Rust is the media engine, Three.js is the
//! compositor" prototype.
//!
//! The question this exists to answer is whether a frontend-composited export
//! can sustain a useful frame rate end to end: frames out of the existing
//! preview socket, composited and post-processed in Three.js, encoded with
//! WebCodecs, handed back here to be written. Everything here is measurement
//! scaffolding — delete the module and its two commands and nothing else
//! changes.

use std::{
    fs::File,
    io::{BufWriter, Write},
    path::PathBuf,
    sync::Mutex,
    time::Instant,
};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager};

/// One export run's sink. Chunks arrive in decode order from the webview.
#[derive(Default)]
pub struct SpikeSink(Mutex<Option<SpikeRun>>);

struct SpikeRun {
    writer: BufWriter<File>,
    path: PathBuf,
    started_at: Instant,
    chunks: u64,
    bytes: u64,
}

#[derive(Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpikeResult {
    path: String,
    chunks: u64,
    bytes: u64,
    seconds: f64,
    /// Throughput of the JS -> Rust hop alone, which is the part of the
    /// pipeline this prototype can't measure from the webview side.
    megabytes_per_second: f64,
}

#[tauri::command]
#[specta::specta]
pub fn spike_begin_capture(app: AppHandle, name: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("three-spike");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Bare elementary stream: muxing is already solved in this codebase, so
    // the prototype only has to prove the frames arrive fast enough.
    let path = dir.join(format!("{name}.h264"));
    let file = File::create(&path).map_err(|e| e.to_string())?;

    let sink = app.state::<SpikeSink>();
    *sink.0.lock().map_err(|e| e.to_string())? = Some(SpikeRun {
        writer: BufWriter::with_capacity(1 << 20, file),
        path: path.clone(),
        started_at: Instant::now(),
        chunks: 0,
        bytes: 0,
    });

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
#[specta::specta]
pub fn spike_write_chunk(app: AppHandle, chunk: Vec<u8>) -> Result<(), String> {
    let sink = app.state::<SpikeSink>();
    let mut guard = sink.0.lock().map_err(|e| e.to_string())?;
    let run = guard.as_mut().ok_or("No capture in progress")?;

    run.writer.write_all(&chunk).map_err(|e| e.to_string())?;
    run.chunks += 1;
    run.bytes += chunk.len() as u64;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn spike_finish_capture(app: AppHandle) -> Result<SpikeResult, String> {
    let sink = app.state::<SpikeSink>();
    let mut guard = sink.0.lock().map_err(|e| e.to_string())?;
    let mut run = guard.take().ok_or("No capture in progress")?;

    run.writer.flush().map_err(|e| e.to_string())?;
    let seconds = run.started_at.elapsed().as_secs_f64();

    Ok(SpikeResult {
        path: run.path.to_string_lossy().into_owned(),
        chunks: run.chunks,
        bytes: run.bytes,
        seconds,
        megabytes_per_second: if seconds > 0.0 {
            (run.bytes as f64 / (1024.0 * 1024.0)) / seconds
        } else {
            0.0
        },
    })
}
