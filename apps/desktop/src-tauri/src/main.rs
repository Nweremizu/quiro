// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tracing_subscriber::{EnvFilter, fmt};

/// Tauri's default runtime gives its workers 2 MB of stack, which the export
/// path overflows: rendering a frame nests decoder, compositor and encoder
/// futures, and an async state machine that deep is large — much larger in a
/// debug build, where nothing is inlined away. Building the runtime here
/// instead, with room to spare, is the same fix Cap applies.
const TOKIO_WORKER_THREAD_STACK_SIZE: usize = 16 * 1024 * 1024;

/// The recording, rendering and export crates are full of `tracing` output —
/// decode retries, frame timeouts, render profiles — and without a subscriber
/// installed every one of those was being discarded. `info` for our own
/// crates, `warn` for everything else, overridable with `RUST_LOG`.
const DEFAULT_LOG_FILTER: &str = "warn,quiro=info,quiro_rendering=info,quiro_editor=info,quiro_export=info,quiro_desktop=info,quiro_desktop_lib=info,quiro_recording=info";

/// Windows' default timer granularity is ~15.6ms, so a `sleep(1ms)` really
/// costs a full quantum. The renderer's GPU readback waits are built on short
/// sleeps, and paying a quantum on a wait the GPU satisfies in 3ms measured as
/// 28ms per frame — the difference between 18 and 31 fps on a frame stream.
///
/// `quiro_editor::playback` already does this for the duration of playback;
/// this covers export and preview rendering too. The calls refcount, so both
/// can hold it at once.
#[cfg(target_os = "windows")]
fn raise_timer_resolution() {
    unsafe {
        windows::Win32::Media::timeBeginPeriod(1);
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    raise_timer_resolution();

    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER)),
        )
        .with_target(true)
        .init();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(TOKIO_WORKER_THREAD_STACK_SIZE)
        .build()
        .expect("Failed to build the multi-threaded tokio runtime");

    // Hand the runtime to Tauri so commands and `async_runtime::spawn` land on
    // these workers. Only the handle is installed — `run()` must not be called
    // from inside the runtime, because its setup hook calls
    // `async_runtime::block_on`, which panics on a thread already driving
    // tasks.
    tauri::async_runtime::set(runtime.handle().clone());

    quiro_desktop_lib::run();

    // `run()` returns when the app is closing. Dropping the runtime here would
    // block until every remaining task finished; a recording or export still
    // winding down would stall the exit, so let them go instead.
    runtime.shutdown_background();
}
