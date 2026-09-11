use anyhow::Result;
use ffmpeg::{
    ChannelLayout, codec as avcodec,
    format::{self as avformat},
    software::resampling,
};
use futures::StreamExt;
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use parakeet_rs::{ParakeetTDT, TimestampMode, Transcriber};
use quiro_audio::AudioData;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tempfile::tempdir;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;
use tracing::instrument;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub use quiro_project::{CaptionSegment, CaptionWord, CaptionsData as CaptionData};

use crate::{general_settings::GeneralSettingsStore, http_client};

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const PARAKEET_UNSUPPORTED_MESSAGE: &str = "Parakeet transcription is not available on Intel macOS";

#[derive(Debug, Serialize, Deserialize, Type, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptionEngine {
    Whisper,
    Parakeet,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone, Copy)]
pub enum CaptionAudioSource {
    Mixed,
    Microphone,
    System,
}

#[derive(Debug, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptionModelInfo {
    pub id: String,
    pub label: String,
    pub engine: TranscriptionEngine,
    pub size_bytes: u64,
    pub installed: bool,
    pub available: bool,
    pub recommended: bool,
}

fn caption_model_path(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Failed to get app local data directory".to_string())?
        .join("transcription_models");
    match model_id {
        "best" | "best-max" => Ok(root.join(format!("parakeet-{model_id}"))),
        "small" | "medium" => Ok(root.join(format!("{model_id}.bin"))),
        _ => Err(format!("Unknown caption model: {model_id}")),
    }
}

fn parakeet_available() -> bool {
    !cfg!(all(target_os = "macos", target_arch = "x86_64"))
}

fn caption_model_installed(model_id: &str, path: &Path) -> bool {
    match model_id {
        "best" => [
            "encoder-model.int8.onnx",
            "decoder_joint-model.int8.onnx",
            "vocab.txt",
        ]
        .iter()
        .all(|name| path.join(name).is_file()),
        "best-max" => [
            "encoder-model.onnx",
            "encoder-model.onnx.data",
            "decoder_joint-model.onnx",
            "vocab.txt",
        ]
        .iter()
        .all(|name| path.join(name).is_file()),
        "small" | "medium" => path
            .metadata()
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 1_000_000),
        _ => false,
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_caption_models(app: AppHandle) -> Result<Vec<CaptionModelInfo>, String> {
    let definitions = [
        (
            "best",
            "Recommended",
            TranscriptionEngine::Parakeet,
            670_000_000,
        ),
        (
            "best-max",
            "High accuracy",
            TranscriptionEngine::Parakeet,
            2_550_000_000,
        ),
        ("small", "Small", TranscriptionEngine::Whisper, 488_000_000),
        (
            "medium",
            "Medium",
            TranscriptionEngine::Whisper,
            1_570_000_000,
        ),
    ];
    definitions
        .into_iter()
        .map(|(id, label, engine, size_bytes)| {
            let path = caption_model_path(&app, id)?;
            let available = engine != TranscriptionEngine::Parakeet || parakeet_available();
            let installed = caption_model_installed(id, &path);
            Ok(CaptionModelInfo {
                id: id.to_string(),
                label: label.to_string(),
                engine,
                size_bytes,
                installed,
                available,
                recommended: id
                    == if parakeet_available() {
                        "best"
                    } else {
                        "small"
                    },
            })
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub async fn download_caption_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let path = caption_model_path(&app, &model_id)?;
    if matches!(model_id.as_str(), "best" | "best-max") {
        #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
        {
            let key = model_download_key(&path);
            if !begin_model_download(&key, "Preparing model download".to_string()).await {
                return Ok(());
            }
            let download_app = app.clone();
            let download_key = key.clone();
            tauri::async_runtime::spawn(async move {
                let result =
                    download_parakeet_model_to_dir(&download_app, &path, &download_key).await;
                let status = match &result {
                    Ok(()) => model_download_status(
                        ModelDownloadState::Completed,
                        100.0,
                        "Download complete".to_string(),
                    ),
                    Err(error) => model_download_status(
                        ModelDownloadState::Failed,
                        0.0,
                        format!("Download failed: {error}"),
                    ),
                };
                set_model_download_status(&download_app, &download_key, status).await;
            });
            return Ok(());
        }
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        return Err(PARAKEET_UNSUPPORTED_MESSAGE.to_string());
    }
    let key = model_download_key(&path);
    if !begin_model_download(&key, "Preparing model download".to_string()).await {
        return Ok(());
    }
    let download_app = app.clone();
    let download_key = key.clone();
    tauri::async_runtime::spawn(async move {
        let result =
            download_whisper_model_to_path(&download_app, &model_id, &path, &download_key).await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&path).await;
            let _ = tokio::fs::remove_file(path.with_extension("download")).await;
        }
        let status = match &result {
            Ok(()) => model_download_status(
                ModelDownloadState::Completed,
                100.0,
                "Download complete".to_string(),
            ),
            Err(error) => model_download_status(
                ModelDownloadState::Failed,
                0.0,
                format!("Download failed: {error}"),
            ),
        };
        set_model_download_status(&download_app, &download_key, status).await;
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_caption_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let path = caption_model_path(&app, &model_id)?;
    if matches!(model_id.as_str(), "best" | "best-max") {
        return delete_parakeet_model(app, path.to_string_lossy().into_owned()).await;
    }
    delete_whisper_model(app, path.to_string_lossy().into_owned()).await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_caption_model_download(
    app: AppHandle,
    model_id: String,
) -> Result<bool, String> {
    let path = caption_model_path(&app, &model_id)?;
    cancel_model_download(app, path.to_string_lossy().into_owned()).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_caption_model_download_status(
    app: AppHandle,
    model_id: String,
) -> Result<Option<ModelDownloadStatus>, String> {
    let path = caption_model_path(&app, &model_id)?;
    let key = model_download_key(&path);
    let downloads = MODEL_DOWNLOADS.lock().await;
    Ok(downloads.get(&key).map(|entry| entry.status.clone()))
}

#[tauri::command]
#[specta::specta]
pub async fn transcribe_project_audio(
    app: AppHandle,
    project_path: String,
    model_id: String,
    language: String,
    audio_source: CaptionAudioSource,
    job_id: String,
) -> Result<CaptionData, String> {
    let path = caption_model_path(&app, &model_id)?;
    if !caption_model_installed(&model_id, &path) {
        return Err("Caption model is incomplete. Download it again.".to_string());
    }
    let engine = if matches!(model_id.as_str(), "best" | "best-max") {
        TranscriptionEngine::Parakeet
    } else {
        TranscriptionEngine::Whisper
    };
    transcribe_audio(
        app,
        project_path,
        path.to_string_lossy().into_owned(),
        language,
        engine,
        audio_source,
        job_id,
    )
    .await
}

#[derive(Debug, Serialize, Type, tauri_specta::Event, Clone)]
pub struct CaptionGenerationProgress {
    pub job_id: String,
    pub stage: String,
    pub progress: f64,
    pub message: String,
}

fn emit_caption_generation_progress(
    app: &AppHandle,
    job_id: &str,
    stage: &str,
    progress: f64,
    message: &str,
) {
    let _ = CaptionGenerationProgress {
        job_id: job_id.to_string(),
        stage: stage.to_string(),
        progress: progress.clamp(0.0, 100.0),
        message: message.to_string(),
    }
    .emit(app);
}

lazy_static::lazy_static! {
    static ref WHISPER_CONTEXT: Arc<Mutex<Option<Arc<WhisperContext>>>> = Arc::new(Mutex::new(None));
    static ref MODEL_DOWNLOADS: Mutex<HashMap<String, ActiveModelDownload>> = Mutex::new(HashMap::new());
    static ref TRANSCRIPTION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static ref CAPTION_GENERATIONS: std::sync::Mutex<HashMap<String, CancellationToken>> = std::sync::Mutex::new(HashMap::new());
}

struct CaptionGenerationGuard {
    job_id: String,
}

impl Drop for CaptionGenerationGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = CAPTION_GENERATIONS.lock() {
            jobs.remove(&self.job_id);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_caption_generation(job_id: String) -> bool {
    let Ok(jobs) = CAPTION_GENERATIONS.lock() else {
        return false;
    };
    let Some(cancellation) = jobs.get(&job_id) else {
        return false;
    };
    cancellation.cancel();
    true
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
lazy_static::lazy_static! {
    static ref PARAKEET_CONTEXT: Mutex<Option<CachedParakeetContext>> = Mutex::new(None);
}

const WHISPER_SAMPLE_RATE: u32 = 16000;
const TARGET_CAPTION_WORDS_PER_SEGMENT: usize = 6;
const MAX_CAPTION_WORDS_PER_SEGMENT: usize = 8;
const MIN_FINAL_CAPTION_WORDS: usize = 3;
// Whisper/Parakeet sometimes stretch a trailing word's end across a following
// silence (e.g. a 16s "seconds."), which leaves the rendered caption stuck on
// screen and duplicates the word across timeline cuts once projected. Real
// spoken words never approach this, so cap each word's duration to keep timing
// tied to speech rather than silence.
const MAX_CAPTION_WORD_DURATION: f32 = 2.5;

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
struct CachedParakeetContext {
    model_dir: String,
    model: Arc<std::sync::Mutex<ParakeetTDT>>,
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
fn parakeet_model_dir_matches(cached_model_dir: &str, model_dir: &Path) -> bool {
    cached_model_dir == model_dir.to_string_lossy()
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
async fn invalidate_parakeet_cache_for_dir(model_dir: &Path) {
    let mut ctx = PARAKEET_CONTEXT.lock().await;
    if ctx
        .as_ref()
        .is_some_and(|cached| parakeet_model_dir_matches(&cached.model_dir, model_dir))
    {
        tracing::info!(
            "Invalidating cached Parakeet context for {}",
            model_dir.display()
        );
        *ctx = None;
    }
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
async fn invalidate_parakeet_cache_for_dir(_model_dir: &Path) {}

pub async fn release_ml_models() {
    {
        let mut ctx = WHISPER_CONTEXT.lock().await;
        if ctx.is_some() {
            tracing::info!("Releasing Whisper context to free memory");
            *ctx = None;
        }
    }
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    {
        let mut ctx = PARAKEET_CONTEXT.lock().await;
        if ctx.is_some() {
            tracing::info!("Releasing Parakeet context to free memory");
            *ctx = None;
        }
    }
}

fn normalize_relative_components(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Path is outside the app data directory".to_string());
            }
            Component::RootDir => {
                return Err("Path is outside the app data directory".to_string());
            }
            Component::Prefix(_) => {
                return Err("Path is outside the app data directory".to_string());
            }
        }
    }

    Ok(normalized)
}

fn resolve_path_with_base(base_dir: &Path, path: &str) -> Result<PathBuf, String> {
    if !base_dir.exists() {
        std::fs::create_dir_all(base_dir)
            .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    }

    let canonical_base = base_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let requested = PathBuf::from(path);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        canonical_base.join(normalize_relative_components(&requested)?)
    };

    let mut suffix = Vec::new();
    let mut current = candidate.as_path();

    while !current.exists() {
        let file_name = current
            .file_name()
            .ok_or_else(|| "Path is outside the app data directory".to_string())?;
        suffix.push(file_name.to_os_string());
        current = current
            .parent()
            .ok_or_else(|| "Path is outside the app data directory".to_string())?;
    }

    let mut resolved = current
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e}"))?;

    if !resolved.starts_with(&canonical_base) {
        return Err("Path is outside the app data directory".to_string());
    }

    for component in suffix.into_iter().rev() {
        resolved.push(component);
    }

    Ok(resolved)
}

fn validate_model_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Failed to get app local data directory".to_string())?;

    resolve_path_with_base(&app_data_dir, path)
}

enum AudioExtractionSource {
    ProjectDirectory {
        base_path: PathBuf,
        meta_path: PathBuf,
    },
    MediaFile(PathBuf),
}

fn resolve_audio_extraction_source(video_path: &str) -> Result<AudioExtractionSource, String> {
    let path = PathBuf::from(video_path);
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Failed to read video path metadata: {e}"))?;

    if metadata.is_dir() {
        let meta_path = path.join("recording-meta.json");
        if !meta_path.is_file() {
            return Err("Recording directory is missing recording-meta.json".to_string());
        }

        return Ok(AudioExtractionSource::ProjectDirectory {
            base_path: path,
            meta_path,
        });
    }

    if metadata.is_file() {
        return Ok(AudioExtractionSource::MediaFile(path));
    }

    Err("Video path is neither a file nor a recording directory".to_string())
}

async fn extract_audio_from_video(
    video_path: &str,
    output_path: &PathBuf,
    audio_source: CaptionAudioSource,
) -> Result<(), String> {
    log::info!("=== EXTRACT AUDIO START ===");
    log::info!("Attempting to extract audio from: {video_path}");
    log::info!("Output path: {output_path:?}");

    match resolve_audio_extraction_source(video_path)? {
        AudioExtractionSource::ProjectDirectory {
            base_path,
            meta_path,
        } => {
            log::info!("Detected recording project directory");

            let meta_content = std::fs::read_to_string(&meta_path)
                .map_err(|e| format!("Failed to read recording metadata: {e}"))?;

            let meta: serde_json::Value = serde_json::from_str(&meta_content)
                .map_err(|e| format!("Failed to parse recording metadata: {e}"))?;

            struct SegmentAudio {
                sources: Vec<PathBuf>,
                duration_sources: Vec<PathBuf>,
            }

            let mut segment_audios: Vec<SegmentAudio> = Vec::new();

            if let Some(segments) = meta["segments"].as_array() {
                for segment in segments {
                    let mut sources = Vec::new();
                    let mut duration_sources = Vec::new();
                    let mut resolve_source = |path: Option<&str>| {
                        if let Some(path) = path {
                            let full_path = base_path.join(path);
                            if full_path.exists() && !duration_sources.contains(&full_path) {
                                duration_sources.push(full_path.clone());
                            }
                            return Some(full_path);
                        }
                        None
                    };

                    let system_audio = resolve_source(segment["system_audio"]["path"].as_str());
                    let microphone = resolve_source(segment["mic"]["path"].as_str());
                    let legacy_audio = resolve_source(segment["audio"]["path"].as_str());

                    if matches!(
                        audio_source,
                        CaptionAudioSource::Mixed | CaptionAudioSource::System
                    ) && let Some(path) = system_audio
                    {
                        sources.push(path);
                    }
                    if matches!(
                        audio_source,
                        CaptionAudioSource::Mixed | CaptionAudioSource::Microphone
                    ) {
                        if let Some(path) = microphone {
                            sources.push(path);
                        }
                        if let Some(path) = legacy_audio
                            && !sources.contains(&path)
                        {
                            sources.push(path);
                        }
                    }

                    if !duration_sources.is_empty() {
                        segment_audios.push(SegmentAudio {
                            sources,
                            duration_sources,
                        });
                    }
                }
            }

            if segment_audios.is_empty() {
                return Err("No audio sources found in the recording metadata".to_string());
            }

            log::info!("Found {} segments with audio sources", segment_audios.len());

            let mut final_samples: Vec<f32> = Vec::new();

            for (segment_idx, segment_audio) in segment_audios.iter().enumerate() {
                log::info!(
                    "Processing segment {} with {} audio sources",
                    segment_idx,
                    segment_audio.sources.len()
                );

                let mut segment_samples: Vec<f32> = Vec::new();

                for source in &segment_audio.sources {
                    match AudioData::from_file(source) {
                        Ok(audio) => {
                            log::info!(
                                "Processing audio source {:?}: {} channels, {} samples",
                                source,
                                audio.channels(),
                                audio.sample_count()
                            );

                            let mono_samples = if audio.channels() > 1 {
                                convert_to_mono(audio.samples(), audio.channels() as usize)
                            } else {
                                audio.samples().to_vec()
                            };

                            if segment_samples.is_empty() {
                                segment_samples = mono_samples;
                            } else {
                                mix_samples(&mut segment_samples, &mono_samples);
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to process audio source {source:?}: {e}");
                            continue;
                        }
                    }
                }

                if segment_samples.is_empty() {
                    let duration_samples = segment_audio
                        .duration_sources
                        .iter()
                        .filter_map(|source| AudioData::from_file(source).ok())
                        .map(|audio| audio.sample_count() / usize::from(audio.channels().max(1)))
                        .max()
                        .unwrap_or(0);
                    segment_samples.resize(duration_samples, 0.0);
                }

                if !segment_samples.is_empty() {
                    log::info!(
                        "Segment {} produced {} samples, appending to final audio",
                        segment_idx,
                        segment_samples.len()
                    );
                    final_samples.extend(segment_samples);
                }
            }

            let mut mixed_samples = final_samples;
            let channel_count = 1_usize;

            if mixed_samples.is_empty() {
                log::error!("No audio samples after processing all sources");
                return Err("Failed to process any audio sources".to_string());
            }

            let gain = normalize_audio_for_transcription(&mut mixed_samples);
            if (gain - 1.0).abs() > 0.01 {
                log::info!("Applied transcription audio gain: {gain:.2}x");
            }

            log::info!("Final mixed audio: {} samples", mixed_samples.len());
            let mix_rms = (mixed_samples.iter().map(|&s| s * s).sum::<f32>()
                / mixed_samples.len() as f32)
                .sqrt();
            log::info!("Mixed audio RMS: {mix_rms:.4}");

            if mix_rms < 0.001 {
                log::warn!(
                    "WARNING: Mixed audio RMS is very low ({mix_rms:.6}) - audio may be nearly silent!"
                );
            }

            let mut output = avformat::output(&output_path)
                .map_err(|e| format!("Failed to create output file: {e}"))?;

            let codec = avcodec::encoder::find_by_name("pcm_s16le")
                .ok_or_else(|| "PCM encoder not found".to_string())?;

            let mut encoder = avcodec::Context::new()
                .encoder()
                .audio()
                .map_err(|e| format!("Failed to create encoder: {e}"))?;

            encoder.set_rate(WHISPER_SAMPLE_RATE as i32);
            let channel_layout = ChannelLayout::MONO;
            encoder.set_channel_layout(channel_layout);
            encoder.set_format(avformat::Sample::I16(avformat::sample::Type::Packed));

            let mut encoder = encoder
                .open_as(codec)
                .map_err(|e| format!("Failed to open encoder: {e}"))?;

            let mut stream = output
                .add_stream(codec)
                .map_err(|e| format!("Failed to add stream: {e}"))?;
            stream.set_parameters(&encoder);

            output
                .write_header()
                .map_err(|e| format!("Failed to write header: {e}"))?;

            let mut resampler = resampling::Context::get(
                avformat::Sample::F32(avformat::sample::Type::Packed),
                channel_layout,
                AudioData::SAMPLE_RATE,
                avformat::Sample::I16(avformat::sample::Type::Packed),
                channel_layout,
                WHISPER_SAMPLE_RATE,
            )
            .map_err(|e| format!("Failed to create resampler: {e}"))?;

            let frame_size = encoder.frame_size() as usize;
            let frame_size = if frame_size == 0 { 1024 } else { frame_size };

            log::info!(
                "Using frame size: {}, total samples: {}, channel count: {}",
                frame_size,
                mixed_samples.len(),
                channel_count
            );

            let mut frame = ffmpeg::frame::Audio::new(
                avformat::Sample::I16(avformat::sample::Type::Packed),
                frame_size,
                ChannelLayout::MONO,
            );
            frame.set_rate(WHISPER_SAMPLE_RATE);

            if !mixed_samples.is_empty() && frame_size * channel_count > 0 {
                for (chunk_idx, chunk) in
                    mixed_samples.chunks(frame_size * channel_count).enumerate()
                {
                    if chunk_idx % 100 == 0 {
                        log::info!("Processing chunk {}, size: {}", chunk_idx, chunk.len());
                    }

                    let mut input_frame = ffmpeg::frame::Audio::new(
                        avformat::Sample::F32(avformat::sample::Type::Packed),
                        chunk.len() / channel_count,
                        channel_layout,
                    );
                    input_frame.set_rate(AudioData::SAMPLE_RATE);

                    let bytes = unsafe {
                        std::slice::from_raw_parts(
                            chunk.as_ptr() as *const u8,
                            std::mem::size_of_val(chunk),
                        )
                    };
                    input_frame.data_mut(0)[0..bytes.len()].copy_from_slice(bytes);

                    let mut output_frame = ffmpeg::frame::Audio::new(
                        avformat::Sample::I16(avformat::sample::Type::Packed),
                        frame_size,
                        ChannelLayout::MONO,
                    );
                    output_frame.set_rate(WHISPER_SAMPLE_RATE);

                    match resampler.run(&input_frame, &mut output_frame) {
                        Ok(_) => {
                            if chunk_idx % 100 == 0 {
                                log::info!(
                                    "Successfully resampled chunk {}, output samples: {}",
                                    chunk_idx,
                                    output_frame.samples()
                                );
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to resample chunk {chunk_idx}: {e}");
                            continue;
                        }
                    }

                    if let Err(e) = encoder.send_frame(&output_frame) {
                        log::error!("Failed to send frame to encoder: {e}");
                        continue;
                    }

                    loop {
                        let mut packet = ffmpeg::Packet::empty();
                        match encoder.receive_packet(&mut packet) {
                            Ok(_) => {
                                if let Err(e) = packet.write_interleaved(&mut output) {
                                    log::error!("Failed to write packet: {e}");
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            }

            encoder
                .send_eof()
                .map_err(|e| format!("Failed to send EOF: {e}"))?;

            loop {
                let mut packet = ffmpeg::Packet::empty();
                let received = encoder.receive_packet(&mut packet);

                if received.is_err() {
                    break;
                }

                {
                    if let Err(e) = packet.write_interleaved(&mut output) {
                        return Err(format!("Failed to write final packet: {e}"));
                    }
                }
            }

            output
                .write_trailer()
                .map_err(|e| format!("Failed to write trailer: {e}"))?;

            log::info!("=== EXTRACT AUDIO END (from recording project) ===");
            Ok(())
        }
        AudioExtractionSource::MediaFile(video_path) => {
            let mut input = avformat::input(&video_path)
                .map_err(|e| format!("Failed to open video file: {e}"))?;

            let stream = input
                .streams()
                .best(ffmpeg::media::Type::Audio)
                .ok_or_else(|| "No audio stream found".to_string())?;

            let codec_params = stream.parameters();

            let decoder_ctx = avcodec::Context::from_parameters(codec_params.clone())
                .map_err(|e| format!("Failed to create decoder context: {e}"))?;

            let mut decoder = decoder_ctx
                .decoder()
                .audio()
                .map_err(|e| format!("Failed to create decoder: {e}"))?;

            let decoder_format = decoder.format();
            let decoder_channel_layout = decoder.channel_layout();
            let decoder_rate = decoder.rate();

            let channel_layout = ChannelLayout::MONO;

            let mut encoder_ctx = avcodec::Context::new()
                .encoder()
                .audio()
                .map_err(|e| format!("Failed to create encoder: {e}"))?;

            encoder_ctx.set_rate(WHISPER_SAMPLE_RATE as i32);
            encoder_ctx.set_channel_layout(channel_layout);
            encoder_ctx.set_format(avformat::Sample::I16(avformat::sample::Type::Packed));

            let codec = avcodec::encoder::find_by_name("pcm_s16le")
                .ok_or_else(|| "PCM encoder not found".to_string())?;

            let mut encoder = encoder_ctx
                .open_as(codec)
                .map_err(|e| format!("Failed to open encoder: {e}"))?;

            let mut output = avformat::output(&output_path)
                .map_err(|e| format!("Failed to create output file: {e}"))?;

            let stream_params = {
                let mut output_stream = output
                    .add_stream(codec)
                    .map_err(|e| format!("Failed to add stream: {e}"))?;

                output_stream.set_parameters(&encoder);

                (output_stream.index(), output_stream.id())
            };

            output
                .write_header()
                .map_err(|e| format!("Failed to write header: {e}"))?;

            let mut resampler = resampling::Context::get(
                decoder_format,
                decoder_channel_layout,
                decoder_rate,
                avformat::Sample::I16(avformat::sample::Type::Packed),
                channel_layout,
                WHISPER_SAMPLE_RATE,
            )
            .map_err(|e| format!("Failed to create resampler: {e}"))?;

            let mut decoded_frame = ffmpeg::frame::Audio::empty();
            let mut resampled_frame = ffmpeg::frame::Audio::new(
                avformat::Sample::I16(avformat::sample::Type::Packed),
                encoder.frame_size() as usize,
                channel_layout,
            );

            let input_stream_index = stream.index();

            let mut packet_queue = Vec::new();

            {
                for (stream_idx, packet) in input.packets() {
                    if stream_idx.index() == input_stream_index
                        && let Some(data) = packet.data()
                    {
                        let mut cloned_packet = ffmpeg::Packet::copy(data);
                        if let Some(pts) = packet.pts() {
                            cloned_packet.set_pts(Some(pts));
                        }
                        if let Some(dts) = packet.dts() {
                            cloned_packet.set_dts(Some(dts));
                        }
                        packet_queue.push(cloned_packet);
                    }
                }
            }

            for packet_res in packet_queue {
                if let Err(e) = decoder.send_packet(&packet_res) {
                    log::warn!("Failed to send packet to decoder: {e}");
                    continue;
                }

                while decoder.receive_frame(&mut decoded_frame).is_ok() {
                    if let Err(e) = resampler.run(&decoded_frame, &mut resampled_frame) {
                        log::warn!("Failed to resample audio: {e}");
                        continue;
                    }

                    if let Err(e) = encoder.send_frame(&resampled_frame) {
                        log::warn!("Failed to send frame to encoder: {e}");
                        continue;
                    }

                    loop {
                        let mut packet = ffmpeg::Packet::empty();
                        match encoder.receive_packet(&mut packet) {
                            Ok(_) => {
                                packet.set_stream(stream_params.0);

                                if let Err(e) = packet.write_interleaved(&mut output) {
                                    log::error!("Failed to write packet: {e}");
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            }

            decoder
                .send_eof()
                .map_err(|e| format!("Failed to send EOF to decoder: {e}"))?;

            while decoder.receive_frame(&mut decoded_frame).is_ok() {
                resampler
                    .run(&decoded_frame, &mut resampled_frame)
                    .map_err(|e| format!("Failed to resample final audio: {e}"))?;

                encoder
                    .send_frame(&resampled_frame)
                    .map_err(|e| format!("Failed to send final frame: {e}"))?;

                loop {
                    let mut packet = ffmpeg::Packet::empty();
                    let received = encoder.receive_packet(&mut packet);

                    if received.is_err() {
                        break;
                    }

                    packet
                        .write_interleaved(&mut output)
                        .map_err(|e| format!("Failed to write final packet: {e}"))?;
                }
            }

            output
                .write_trailer()
                .map_err(|e| format!("Failed to write trailer: {e}"))?;

            log::info!("=== EXTRACT AUDIO END (from video) ===");
            Ok(())
        }
    }
}

fn lock_transcription_worker_slot() -> std::sync::MutexGuard<'static, ()> {
    TRANSCRIPTION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn get_whisper_context_blocking(model_path: &str) -> Result<Arc<WhisperContext>, String> {
    let mut context_guard = WHISPER_CONTEXT.blocking_lock();

    if let Some(ref existing) = *context_guard {
        log::info!("Reusing cached Whisper context");
        return Ok(existing.clone());
    }

    log::info!("Initializing Whisper context with model: {model_path}");
    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

    let ctx_arc = Arc::new(ctx);
    *context_guard = Some(ctx_arc.clone());

    Ok(ctx_arc)
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn release_whisper_context_after_transcription() {
    let mut ctx = WHISPER_CONTEXT.blocking_lock();
    *ctx = None;
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn release_whisper_context_after_transcription() {}

fn is_special_token(token_text: &str) -> bool {
    let trimmed = token_text.trim();
    if trimmed.is_empty() {
        return true;
    }

    let is_special = trimmed.contains('[')
        || trimmed.contains(']')
        || trimmed.contains("_TT_")
        || trimmed.contains("_BEG_")
        || trimmed.contains("<|");

    if is_special {
        log::debug!("Filtering special token: {token_text:?}");
    }

    is_special
}

fn caption_token_attaches_to_previous(text: &str) -> bool {
    let Some(first_char) = text.trim().chars().next() else {
        return false;
    };

    caption_char_attaches_to_previous(first_char)
}

fn caption_char_attaches_to_previous(value: char) -> bool {
    matches!(
        value,
        ',' | '.'
            | '!'
            | '?'
            | ';'
            | ':'
            | '%'
            | ')'
            | ']'
            | '}'
            | '\''
            | '’'
            | '、'
            | '。'
            | '！'
            | '？'
            | '；'
            | '：'
            | '，'
    )
}

fn caption_boundary_word_is_weak(word: &CaptionWord) -> bool {
    let normalized = word
        .text
        .trim()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase();

    normalized.len() <= 1
        || matches!(
            normalized.as_str(),
            "an" | "as"
                | "at"
                | "be"
                | "by"
                | "do"
                | "he"
                | "if"
                | "in"
                | "is"
                | "it"
                | "me"
                | "my"
                | "of"
                | "on"
                | "or"
                | "so"
                | "to"
                | "up"
                | "we"
        )
}

fn normalize_caption_words(words: Vec<CaptionWord>) -> Vec<CaptionWord> {
    let mut normalized: Vec<CaptionWord> = Vec::with_capacity(words.len());

    for word in words {
        let text = word.text.trim();
        if text.is_empty() {
            continue;
        }

        if caption_token_attaches_to_previous(text)
            && let Some(previous) = normalized.last_mut()
        {
            previous.text.push_str(text);
            previous.end = word.end;
        } else {
            normalized.push(CaptionWord {
                text: text.to_string(),
                start: word.start,
                end: word.end,
            });
        }
    }

    for word in &mut normalized {
        word.end = word.end.min(word.start + MAX_CAPTION_WORD_DURATION);
    }

    normalized
}

fn caption_text_from_words<'a>(words: impl IntoIterator<Item = &'a CaptionWord>) -> String {
    let mut text = String::new();

    for word in words {
        let word_text = word.text.trim();
        if word_text.is_empty() {
            continue;
        }

        if !text.is_empty() && !caption_token_attaches_to_previous(word_text) {
            text.push(' ');
        }
        text.push_str(word_text);
    }

    text
}

fn caption_word_chunks(words: &[CaptionWord]) -> Vec<&[CaptionWord]> {
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < words.len() {
        let remaining = words.len() - start;
        if remaining <= TARGET_CAPTION_WORDS_PER_SEGMENT {
            chunks.push(&words[start..]);
            break;
        }

        let mut end = (start + TARGET_CAPTION_WORDS_PER_SEGMENT).min(words.len());
        while end < words.len()
            && caption_boundary_word_is_weak(&words[end - 1])
            && end - start < MAX_CAPTION_WORDS_PER_SEGMENT
        {
            end += 1;
        }

        let remaining_after = words.len() - end;
        if remaining_after > 0
            && remaining_after < MIN_FINAL_CAPTION_WORDS
            && caption_boundary_word_is_weak(&words[end])
        {
            end = words.len();
        }

        chunks.push(&words[start..end]);
        start = end;
    }

    chunks
}

fn normalize_audio_for_transcription(samples: &mut [f32]) -> f32 {
    if samples.is_empty() {
        return 1.0;
    }

    let peak = samples
        .iter()
        .fold(0.0_f32, |max, sample| max.max(sample.abs()));
    if peak <= f32::EPSILON {
        return 1.0;
    }

    let rms =
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt();
    if rms <= f32::EPSILON {
        return 1.0;
    }

    let target_rms = 0.08_f32;
    let desired_gain = (target_rms / rms).clamp(1.0, 8.0);
    let peak_limited_gain = 0.98 / peak;
    let gain = desired_gain.min(peak_limited_gain);

    if (gain - 1.0).abs() > 0.01 {
        for sample in samples {
            *sample = (*sample * gain).clamp(-0.98, 0.98);
        }
    }

    gain
}

fn process_with_whisper(
    audio_path: &PathBuf,
    context: Arc<WhisperContext>,
    language: &str,
    transcription_hints: &[String],
) -> Result<CaptionData, String> {
    log::info!("=== WHISPER TRANSCRIPTION START ===");
    log::info!("Processing audio file: {audio_path:?}");
    log::info!("Language setting: {language}");

    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: 1.0,
    });

    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_token_timestamps(true);
    params.set_language((language != "auto").then_some(language));
    params.set_max_len(i32::MAX);

    if let Some(initial_prompt) = build_initial_prompt(transcription_hints) {
        params.set_initial_prompt(&initial_prompt);
    }

    log::info!(
        "Whisper params - translate: false, token_timestamps: true, beam_size: 5, max_len: MAX"
    );

    let mut audio_file = File::open(audio_path)
        .map_err(|e| format!("Failed to open audio file: {e} at path: {audio_path:?}"))?;
    let mut audio_data = Vec::new();
    audio_file
        .read_to_end(&mut audio_data)
        .map_err(|e| format!("Failed to read audio file: {e}"))?;

    log::info!("Processing audio file of size: {} bytes", audio_data.len());

    let mut audio_data_f32 = Vec::new();
    for i in (0..audio_data.len()).step_by(2) {
        if i + 1 < audio_data.len() {
            let sample = i16::from_le_bytes([audio_data[i], audio_data[i + 1]]) as f32 / 32768.0;
            audio_data_f32.push(sample);
        }
    }

    let gain = normalize_audio_for_transcription(&mut audio_data_f32);
    if (gain - 1.0).abs() > 0.01 {
        log::info!("Applied Whisper input gain: {gain:.2}x");
    }

    let duration_seconds = audio_data_f32.len() as f32 / WHISPER_SAMPLE_RATE as f32;
    log::info!(
        "Converted {} samples to f32 format (duration: {:.2}s at {}Hz)",
        audio_data_f32.len(),
        duration_seconds,
        WHISPER_SAMPLE_RATE
    );

    if !audio_data_f32.is_empty() {
        let min_sample = audio_data_f32.iter().fold(f32::MAX, |a, &b| a.min(b));
        let max_sample = audio_data_f32.iter().fold(f32::MIN, |a, &b| a.max(b));
        let avg_sample = audio_data_f32.iter().sum::<f32>() / audio_data_f32.len() as f32;
        let rms = (audio_data_f32.iter().map(|&s| s * s).sum::<f32>()
            / audio_data_f32.len() as f32)
            .sqrt();
        log::info!(
            "Audio samples - min: {min_sample:.4}, max: {max_sample:.4}, avg: {avg_sample:.6}, RMS: {rms:.4}"
        );

        if rms < 0.001 {
            log::warn!("WARNING: Audio RMS is very low ({rms:.6}) - audio may be nearly silent!");
        }

        log::info!("First 20 audio samples:");
        for (i, sample) in audio_data_f32.iter().take(20).enumerate() {
            log::info!("  Sample[{i}] = {sample:.6}");
        }
    }

    let mut state = context
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {e}"))?;

    state
        .full(params, &audio_data_f32[..])
        .map_err(|e| format!("Failed to run Whisper transcription: {e}"))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Failed to get number of segments: {e}"))?;

    log::info!("Found {num_segments} segments");

    let mut segments = Vec::new();

    for i in 0..num_segments {
        let raw_text = state
            .full_get_segment_text(i)
            .map_err(|e| format!("Failed to get segment text: {e}"))?;

        let start_i64 = state
            .full_get_segment_t0(i)
            .map_err(|e| format!("Failed to get segment start time: {e}"))?;
        let end_i64 = state
            .full_get_segment_t1(i)
            .map_err(|e| format!("Failed to get segment end time: {e}"))?;

        let start_time = (start_i64 as f32) / 100.0;
        let end_time = (end_i64 as f32) / 100.0;

        log::info!(
            "=== Segment {}: start={:.2}s, end={:.2}s, raw_text='{}'",
            i,
            start_time,
            end_time,
            raw_text.trim()
        );

        let mut words = Vec::new();
        let num_tokens = state
            .full_n_tokens(i)
            .map_err(|e| format!("Failed to get token count: {e}"))?;

        log::info!("  Segment {i} has {num_tokens} tokens");

        let mut current_word = String::new();
        let mut word_start: Option<f32> = None;
        let mut word_end: f32 = start_time;

        for t in 0..num_tokens {
            let token_text = state.full_get_token_text(i, t).unwrap_or_default();
            let token_id = state.full_get_token_id(i, t).unwrap_or(0);
            let token_prob = state.full_get_token_prob(i, t).unwrap_or(0.0);

            if is_special_token(&token_text) {
                log::debug!(
                    "  Token[{t}]: id={token_id}, text={token_text:?} -> SKIPPED (special)"
                );
                continue;
            }

            let token_data = state.full_get_token_data(i, t).ok();

            if let Some(data) = token_data {
                let token_start = (data.t0 as f32) / 100.0;
                let token_end = (data.t1 as f32) / 100.0;

                log::info!(
                    "  Token[{t}]: id={token_id}, text={token_text:?}, t0={token_start:.2}s, t1={token_end:.2}s, prob={token_prob:.4}"
                );

                if token_text.starts_with(' ') || token_text.starts_with('\n') {
                    if !current_word.is_empty()
                        && let Some(ws) = word_start
                    {
                        log::info!(
                            "    -> Completing word: '{}' ({:.2}s - {:.2}s)",
                            current_word.trim(),
                            ws,
                            word_end
                        );
                        words.push(CaptionWord {
                            text: current_word.trim().to_string(),
                            start: ws,
                            end: word_end,
                        });
                    }
                    current_word = token_text.trim().to_string();
                    word_start = Some(token_start);
                    log::debug!("    -> Starting new word: '{current_word}' at {token_start:.2}s");
                } else {
                    if word_start.is_none() {
                        word_start = Some(token_start);
                        log::debug!("    -> Word start set to {token_start:.2}s");
                    }
                    current_word.push_str(&token_text);
                    log::debug!("    -> Appending to word: '{current_word}'");
                }
                word_end = token_end;
            } else {
                log::warn!("  Token[{t}]: id={token_id}, text={token_text:?} -> NO TIMING DATA");
            }
        }

        if !current_word.trim().is_empty()
            && let Some(ws) = word_start
        {
            log::info!(
                "    -> Final word: '{}' ({:.2}s - {:.2}s)",
                current_word.trim(),
                ws,
                word_end
            );
            words.push(CaptionWord {
                text: current_word.trim().to_string(),
                start: ws,
                end: word_end,
            });
        }

        let words = normalize_caption_words(words);

        log::info!("  Segment {} produced {} words", i, words.len());
        for (w_idx, word) in words.iter().enumerate() {
            log::info!(
                "    Word[{}]: '{}' ({:.2}s - {:.2}s)",
                w_idx,
                word.text,
                word.start,
                word.end
            );
        }

        if words.is_empty() {
            log::warn!("  Segment {i} has no words, skipping");
            continue;
        }

        for (chunk_idx, chunk_words) in caption_word_chunks(&words).into_iter().enumerate() {
            let segment_text = caption_text_from_words(chunk_words);

            let segment_start = chunk_words
                .first()
                .map(|word| word.start)
                .unwrap_or(start_time);
            let segment_end = chunk_words.last().map(|word| word.end).unwrap_or(end_time);

            segments.push(CaptionSegment {
                id: format!("segment-{i}-{chunk_idx}"),
                start: segment_start,
                end: segment_end,
                text: segment_text,
                words: chunk_words.to_vec(),
            });
        }
    }

    log::info!("=== WHISPER TRANSCRIPTION COMPLETE ===");
    log::info!("Total segments: {}", segments.len());

    let total_words: usize = segments.iter().map(|s| s.words.len()).sum();
    log::info!("Total words: {total_words}");

    log::info!("=== FINAL TRANSCRIPTION SUMMARY ===");
    for segment in &segments {
        log::info!(
            "Segment '{}' ({:.2}s - {:.2}s): {}",
            segment.id,
            segment.start,
            segment.end,
            segment.text
        );
    }
    log::info!("=== END SUMMARY ===");

    Ok(CaptionData {
        segments,
        settings: quiro_project::CaptionSettings::default(),
        source_timed: true,
    })
}

fn build_initial_prompt(transcription_hints: &[String]) -> Option<String> {
    let mut normalized = Vec::new();

    for hint in transcription_hints {
        let value = hint.replace('\0', "").trim().to_string();
        if value.is_empty() || normalized.contains(&value) {
            continue;
        }
        normalized.push(value);
    }

    if normalized.is_empty() {
        None
    } else {
        Some(format!(
            "Preferred spellings, names, and capitalization for this transcript: {}",
            normalized.join("; ")
        ))
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
fn process_with_parakeet(
    audio_path: &std::path::Path,
    model_dir: &str,
) -> Result<CaptionData, String> {
    tracing::info!("Processing audio file: {audio_path:?}");
    tracing::info!("Model directory: {model_dir}");

    let cached_model = {
        let guard = PARAKEET_CONTEXT.blocking_lock();
        guard.as_ref().and_then(|cached| {
            if cached.model_dir == model_dir {
                Some(Arc::clone(&cached.model))
            } else {
                None
            }
        })
    };

    let model_arc = if let Some(model) = cached_model {
        tracing::info!("Reusing cached Parakeet TDT model");
        model
    } else {
        tracing::info!("Loading Parakeet TDT model from: {model_dir}");
        let model = ParakeetTDT::from_pretrained(model_dir, None).map_err(|e| format!("{e}"))?;
        let loaded_model = Arc::new(std::sync::Mutex::new(model));

        let mut guard = PARAKEET_CONTEXT.blocking_lock();
        if let Some(cached) = guard
            .as_ref()
            .filter(|cached| cached.model_dir == model_dir)
        {
            tracing::info!("Reusing cached Parakeet TDT model");
            Arc::clone(&cached.model)
        } else {
            *guard = Some(CachedParakeetContext {
                model_dir: model_dir.to_string(),
                model: Arc::clone(&loaded_model),
            });
            tracing::info!("Parakeet TDT model loaded successfully");
            loaded_model
        }
    };

    let result = {
        let mut parakeet = model_arc
            .lock()
            .map_err(|e| format!("Failed to lock Parakeet model: {e}"))?;
        parakeet
            .transcribe_file(audio_path, Some(TimestampMode::Words))
            .map_err(|e| format!("Parakeet transcription failed: {e}"))?
    };

    tracing::info!("Transcription text: {}", result.text);
    tracing::info!("Got {} timed tokens", result.tokens.len());

    let words = normalize_caption_words(
        result
            .tokens
            .iter()
            .filter(|t| !t.text.trim().is_empty())
            .map(|t| CaptionWord {
                text: t.text.trim().to_string(),
                start: t.start,
                end: t.end,
            })
            .collect(),
    );

    if words.is_empty() {
        tracing::warn!("Parakeet produced no words");
        return Err("No speech detected in the audio".to_string());
    }

    let mut segments = Vec::new();

    for (chunk_idx, chunk) in caption_word_chunks(&words).into_iter().enumerate() {
        let segment_text = caption_text_from_words(chunk);
        let segment_start = chunk.first().map(|w| w.start).unwrap_or(0.0);
        let segment_end = chunk.last().map(|w| w.end).unwrap_or(0.0);

        segments.push(CaptionSegment {
            id: format!("segment-{chunk_idx}"),
            start: segment_start,
            end: segment_end,
            text: segment_text,
            words: chunk.to_vec(),
        });
    }

    tracing::info!("Total segments: {}", segments.len());
    tracing::info!(
        "Total words: {}",
        segments.iter().map(|s| s.words.len()).sum::<usize>()
    );

    Ok(CaptionData {
        segments,
        settings: quiro_project::CaptionSettings::default(),
        source_timed: true,
    })
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn process_with_parakeet(
    _audio_path: &std::path::Path,
    _model_dir: &str,
) -> Result<CaptionData, String> {
    Err(PARAKEET_UNSUPPORTED_MESSAGE.to_string())
}

#[tauri::command]
#[specta::specta]
#[instrument]
pub async fn transcribe_audio(
    app: AppHandle,
    video_path: String,
    model_path: String,
    language: String,
    engine: TranscriptionEngine,
    audio_source: CaptionAudioSource,
    job_id: String,
) -> Result<CaptionData, String> {
    log::info!("=== TRANSCRIBE AUDIO COMMAND START ===");
    log::info!("Video path: {}", video_path);
    log::info!("Model path: {}", model_path);
    log::info!("Language: {}", language);

    let validated_model_path = validate_model_path(&app, &model_path)?;

    if !std::path::Path::new(&video_path).exists() {
        log::error!("Video file not found at path: {video_path}");
        return Err(format!("Video file not found at path: {video_path}"));
    }

    if !validated_model_path.exists() {
        log::error!("Model file not found at path: {model_path}");
        return Err(format!("Model file not found at path: {model_path}"));
    }

    let model_path = validated_model_path.to_string_lossy().to_string();
    let cancellation = CancellationToken::new();
    CAPTION_GENERATIONS
        .lock()
        .map_err(|_| "Caption generation state is unavailable".to_string())?
        .insert(job_id.clone(), cancellation.clone());
    let _generation_guard = CaptionGenerationGuard {
        job_id: job_id.clone(),
    };
    emit_caption_generation_progress(&app, &job_id, "extracting", 5.0, "Preparing recorded audio");

    let temp_dir = tempdir().map_err(|e| format!("Failed to create temporary directory: {e}"))?;
    let audio_path = temp_dir.path().join("audio.wav");
    log::info!("Temp audio path: {:?}", audio_path);

    match extract_audio_from_video(&video_path, &audio_path, audio_source).await {
        Ok(_) => log::info!("Successfully extracted audio to {audio_path:?}"),
        Err(e) => {
            log::error!("Failed to extract audio: {e}");
            return Err(format!("Failed to extract audio from video: {e}"));
        }
    }

    if !audio_path.exists() {
        log::error!("Audio file was not created at {audio_path:?}");
        return Err("Failed to create audio file for transcription".to_string());
    }
    if cancellation.is_cancelled() {
        return Err("Caption generation cancelled".to_string());
    }
    emit_caption_generation_progress(
        &app,
        &job_id,
        "loading-model",
        30.0,
        "Loading transcription model",
    );

    let audio_metadata = std::fs::metadata(&audio_path).ok();
    if let Some(meta) = &audio_metadata {
        log::info!(
            "Audio file created at: {:?}, size: {} bytes",
            audio_path,
            meta.len()
        );
    }

    let transcription_result = match engine {
        TranscriptionEngine::Parakeet => {
            emit_caption_generation_progress(
                &app,
                &job_id,
                "transcribing",
                45.0,
                "Transcribing with Parakeet",
            );
            log::info!("Using Parakeet TDT engine");
            let model_dir = model_path.clone();
            tokio::task::spawn_blocking(move || {
                let _guard = lock_transcription_worker_slot();
                process_with_parakeet(&audio_path, &model_dir)
            })
            .await
            .map_err(|e| format!("Parakeet task panicked: {e}"))?
        }
        TranscriptionEngine::Whisper => {
            emit_caption_generation_progress(
                &app,
                &job_id,
                "transcribing",
                45.0,
                "Transcribing with Whisper",
            );
            let transcription_hints = GeneralSettingsStore::get(&app)
                .ok()
                .flatten()
                .map(|settings| settings.transcription_hints)
                .unwrap_or_default();

            log::info!("Starting Whisper transcription in blocking task...");
            tokio::task::spawn_blocking(move || {
                let _guard = lock_transcription_worker_slot();
                let context = match get_whisper_context_blocking(&model_path) {
                    Ok(ctx) => {
                        log::info!("Whisper context ready");
                        ctx
                    }
                    Err(e) => {
                        log::error!("Failed to initialize Whisper context: {e}");
                        return Err(format!("Failed to initialize transcription model: {e}"));
                    }
                };
                let result =
                    process_with_whisper(&audio_path, context, &language, &transcription_hints);
                release_whisper_context_after_transcription();
                result
            })
            .await
            .map_err(|e| format!("Whisper task panicked: {e}"))?
        }
    };

    match transcription_result {
        Ok(captions) => {
            if cancellation.is_cancelled() {
                return Err("Caption generation cancelled".to_string());
            }
            log::info!("=== TRANSCRIBE AUDIO RESULT ===");
            log::info!(
                "Transcription produced {} segments",
                captions.segments.len()
            );

            for (idx, segment) in captions.segments.iter().enumerate() {
                log::info!(
                    "  Result Segment[{}]: '{}' ({} words)",
                    idx,
                    segment.text,
                    segment.words.len()
                );
            }

            if captions.segments.is_empty() {
                log::warn!("No caption segments were generated");
                return Err("No speech detected in the audio".to_string());
            }

            emit_caption_generation_progress(
                &app,
                &job_id,
                "complete",
                100.0,
                "Captions are ready",
            );

            log::info!("=== TRANSCRIBE AUDIO COMMAND END (success) ===");
            Ok(captions)
        }
        Err(e) => {
            log::error!("Failed to process audio with Whisper: {e}");
            log::info!("=== TRANSCRIBE AUDIO COMMAND END (error) ===");
            Err(format!("Failed to transcribe audio: {e}"))
        }
    }
}

#[derive(Debug, Serialize, Type, tauri_specta::Event, Clone)]
pub struct DownloadProgress {
    pub progress: f64,
    pub message: String,
}

#[derive(Debug, Serialize, Type, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelDownloadState {
    Downloading,
    Completed,
    Failed,
}

#[derive(Debug, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadStatus {
    pub state: ModelDownloadState,
    pub progress: f64,
    pub message: String,
}

#[derive(Clone)]
struct ActiveModelDownload {
    status: ModelDownloadStatus,
    notify: Arc<Notify>,
    cancellation: CancellationToken,
}

fn model_download_key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn model_download_status(
    state: ModelDownloadState,
    progress: f64,
    message: String,
) -> ModelDownloadStatus {
    ModelDownloadStatus {
        state,
        progress: progress.clamp(0.0, 100.0),
        message,
    }
}

async fn begin_model_download(key: &str, message: String) -> bool {
    let mut downloads = MODEL_DOWNLOADS.lock().await;
    if downloads
        .get(key)
        .is_some_and(|entry| entry.status.state == ModelDownloadState::Downloading)
    {
        return false;
    }

    downloads.insert(
        key.to_string(),
        ActiveModelDownload {
            status: model_download_status(ModelDownloadState::Downloading, 0.0, message),
            notify: Arc::new(Notify::new()),
            cancellation: CancellationToken::new(),
        },
    );
    true
}

async fn model_download_cancelled(key: &str) -> bool {
    let downloads = MODEL_DOWNLOADS.lock().await;
    downloads
        .get(key)
        .is_some_and(|entry| entry.cancellation.is_cancelled())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_model_download(app: AppHandle, target_path: String) -> Result<bool, String> {
    let validated_path = validate_model_path(&app, &target_path)?;
    let key = model_download_key(&validated_path);
    let cancellation = {
        let downloads = MODEL_DOWNLOADS.lock().await;
        downloads.get(&key).map(|entry| entry.cancellation.clone())
    };
    let Some(cancellation) = cancellation else {
        return Ok(false);
    };
    cancellation.cancel();
    Ok(true)
}

async fn set_model_download_status(app: &AppHandle, key: &str, status: ModelDownloadStatus) {
    let notify = {
        let mut downloads = MODEL_DOWNLOADS.lock().await;
        downloads.get_mut(key).map(|entry| {
            let mut next_status = status.clone();
            if next_status.state == ModelDownloadState::Downloading
                && entry.status.state == ModelDownloadState::Downloading
            {
                next_status.progress = next_status.progress.max(entry.status.progress);
            }
            entry.status = next_status;
            entry.notify.clone()
        })
    };

    let _ = DownloadProgress {
        progress: status.progress,
        message: status.message.clone(),
    }
    .emit(app);

    if status.state != ModelDownloadState::Downloading
        && let Some(notify) = notify
    {
        notify.notify_waiters();
    }
}

async fn set_model_download_progress(app: &AppHandle, key: &str, progress: f64, message: String) {
    set_model_download_status(
        app,
        key,
        model_download_status(ModelDownloadState::Downloading, progress, message),
    )
    .await;
}

async fn clear_model_download_status(path: &Path) {
    let key = model_download_key(path);
    let mut downloads = MODEL_DOWNLOADS.lock().await;
    let _ = downloads.remove(&key);
}

async fn download_whisper_model_to_path(
    app: &AppHandle,
    model_name: &str,
    validated_path: &Path,
    download_key: &str,
) -> Result<(), String> {
    let model_parts: &[&str] = match model_name {
        "tiny" => &[
            "https://github.com/CapSoftware/transcription-models/releases/download/whisper-v1/ggml-tiny.bin",
        ],
        "base" => &[
            "https://github.com/CapSoftware/transcription-models/releases/download/whisper-v1/ggml-base.bin",
        ],
        "small" => &[
            "https://github.com/CapSoftware/transcription-models/releases/download/whisper-v1/ggml-small.bin",
        ],
        "medium" => &[
            "https://github.com/CapSoftware/transcription-models/releases/download/whisper-v1/ggml-medium.bin.part0",
            "https://github.com/CapSoftware/transcription-models/releases/download/whisper-v1/ggml-medium.bin.part1",
        ],
        _ => &[
            "https://github.com/CapSoftware/transcription-models/releases/download/whisper-v1/ggml-tiny.bin",
        ],
    };

    if let Some(parent) = validated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {e}"))?;
    }

    let http_client = app.state::<http_client::HttpClient>();
    let total_size = total_content_length(&http_client, model_parts).await;

    let staging_path = validated_path.with_extension("download");
    let mut file = tokio::fs::File::create(&staging_path)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;

    let mut downloaded: u64 = 0;
    let part_count = model_parts.len() as f64;

    for (idx, url) in model_parts.iter().enumerate() {
        let response = request_model_file(&http_client, url).await?;

        let part_size = response.content_length().unwrap_or(0);
        let mut downloaded_part: u64 = 0;
        let mut stream = response.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            if model_download_cancelled(download_key).await {
                return Err("Model download cancelled".to_string());
            }
            let chunk = chunk_result.map_err(|e| format!("Error while downloading: {e}"))?;

            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Error while writing to file: {e}"))?;

            downloaded = downloaded.saturating_add(chunk.len() as u64);
            downloaded_part = downloaded_part.saturating_add(chunk.len() as u64);

            let progress = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else if part_size > 0 {
                ((idx as f64 + downloaded_part as f64 / part_size as f64) / part_count) * 100.0
            } else {
                (idx as f64 / part_count) * 100.0
            };

            set_model_download_progress(
                app,
                download_key,
                progress,
                format!("Downloading model: {progress:.0}%"),
            )
            .await;
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    drop(file);
    if validated_path.exists() {
        tokio::fs::remove_file(validated_path)
            .await
            .map_err(|e| format!("Failed to replace existing model: {e}"))?;
    }
    tokio::fs::rename(&staging_path, validated_path)
        .await
        .map_err(|e| format!("Failed to finalize model download: {e}"))?;

    Ok(())
}

async fn total_content_length(client: &reqwest::Client, urls: &[&str]) -> u64 {
    let mut total: u64 = 0;
    for url in urls {
        let Ok(resp) = client
            .head(*url)
            .timeout(Duration::from_secs(30))
            .send()
            .await
        else {
            return 0;
        };
        if !resp.status().is_success() {
            return 0;
        }
        match resp.content_length() {
            Some(size) => total = total.saturating_add(size),
            None => return 0,
        }
    }
    total
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub async fn delete_whisper_model(app: AppHandle, model_path: String) -> Result<(), String> {
    let validated_path = validate_model_path(&app, &model_path)?;

    if !validated_path.exists() {
        return Err(format!("Model file not found: {model_path}"));
    }

    clear_model_download_status(&validated_path).await;

    tokio::fs::remove_file(&validated_path)
        .await
        .map_err(|e| format!("Failed to delete model file: {e}"))?;

    Ok(())
}

const MODEL_DOWNLOAD_REQUEST_TIMEOUT: Duration = Duration::from_secs(60 * 60);

fn model_url_candidates(fallback_url: &str) -> Vec<String> {
    let Some(base_url) = option_env!("QUIRO_TRANSCRIPTION_MODELS_BASE_URL") else {
        return vec![fallback_url.to_string()];
    };
    let suffix = fallback_url.split_once("/releases/download/").map_or_else(
        || fallback_url.rsplit('/').next().unwrap_or(fallback_url),
        |(_, suffix)| suffix,
    );
    vec![
        format!("{}/{}", base_url.trim_end_matches('/'), suffix),
        fallback_url.to_string(),
    ]
}

async fn request_model_file(
    client: &reqwest::Client,
    fallback_url: &str,
) -> Result<reqwest::Response, String> {
    let mut last_error = "No model download URL was available".to_string();
    for url in model_url_candidates(fallback_url) {
        match client
            .get(&url)
            .timeout(MODEL_DOWNLOAD_REQUEST_TIMEOUT)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response) => last_error = format!("{url} returned HTTP {}", response.status()),
            Err(error) => last_error = format!("{url}: {error}"),
        }
    }
    Err(format!("Failed to download model: {last_error}"))
}

const PARAKEET_TDT_INT8_MODEL_FILES: &[(&str, &[&str])] = &[
    (
        "encoder-model.int8.onnx",
        &[
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/encoder-model.int8.onnx",
        ],
    ),
    (
        "decoder_joint-model.int8.onnx",
        &[
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/decoder_joint-model.int8.onnx",
        ],
    ),
    (
        "vocab.txt",
        &[
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/vocab.txt",
        ],
    ),
];

const PARAKEET_TDT_FULL_MODEL_FILES: &[(&str, &[&str])] = &[
    (
        "encoder-model.onnx",
        &[
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/encoder-model.onnx",
        ],
    ),
    (
        "encoder-model.onnx.data",
        &[
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/encoder-model.onnx.data.part0",
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/encoder-model.onnx.data.part1",
        ],
    ),
    (
        "decoder_joint-model.onnx",
        &[
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/decoder_joint-model.onnx",
        ],
    ),
    (
        "vocab.txt",
        &[
            "https://github.com/CapSoftware/transcription-models/releases/download/parakeet-tdt-v1/vocab.txt",
        ],
    ),
];

const PARAKEET_MODEL_CLEANUP_FILES: &[&str] = &[
    "encoder-model.onnx",
    "encoder-model.onnx.data",
    "decoder_joint-model.onnx",
    "encoder-model.int8.onnx",
    "decoder_joint-model.int8.onnx",
    "nemo128.onnx",
    "vocab.txt",
];

const PARAKEET_KNOWN_PART_SIZES: &[(&str, u64)] = &[
    ("encoder-model.int8.onnx", 652_183_999),
    ("decoder_joint-model.int8.onnx", 18_202_004),
    ("encoder-model.onnx", 41_770_866),
    ("encoder-model.onnx.data.part0", 1_300_000_000),
    ("encoder-model.onnx.data.part1", 1_135_420_160),
    ("decoder_joint-model.onnx", 72_520_893),
    ("vocab.txt", 93_939),
];

fn parakeet_known_part_size(url: &str) -> Option<u64> {
    PARAKEET_KNOWN_PART_SIZES.iter().find_map(|(name, size)| {
        if url.ends_with(name) {
            Some(*size)
        } else {
            None
        }
    })
}

fn parakeet_model_files_for_dir(
    output_dir: &std::path::Path,
) -> &'static [(&'static str, &'static [&'static str])] {
    let dir_name = output_dir.file_name().and_then(|name| name.to_str());

    match dir_name {
        Some("parakeet-best-max") => PARAKEET_TDT_FULL_MODEL_FILES,
        _ => PARAKEET_TDT_INT8_MODEL_FILES,
    }
}

fn parakeet_staging_dir(validated_dir: &std::path::Path) -> PathBuf {
    validated_dir.with_file_name(format!(
        "{}.downloading",
        validated_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("model")
    ))
}

async fn parakeet_model_file_sizes(
    http_client: &reqwest::Client,
    model_files: &'static [(&'static str, &'static [&'static str])],
) -> Result<Vec<(&'static str, u64)>, String> {
    let mut sizes = Vec::with_capacity(model_files.len());
    for (filename, urls) in model_files {
        let mut file_size = 0_u64;
        for url in *urls {
            let resp = http_client
                .head(*url)
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .map_err(|e| format!("Failed to get size for {filename}: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!(
                    "Failed to get size for {filename}: HTTP {}",
                    resp.status()
                ));
            }

            let part_size = resp
                .content_length()
                .filter(|size| *size > 0)
                .or_else(|| parakeet_known_part_size(url))
                .unwrap_or(0);
            file_size = file_size.saturating_add(part_size);
        }
        sizes.push((*filename, file_size));
    }
    Ok(sizes)
}

fn parakeet_model_files_match(dir: &std::path::Path, expected_files: &[(&str, u64)]) -> bool {
    expected_files.iter().all(|(filename, expected_size)| {
        let Ok(metadata) = std::fs::metadata(dir.join(filename)) else {
            return false;
        };

        metadata.is_file() && (*expected_size == 0 || metadata.len() == *expected_size)
    })
}

fn finalize_parakeet_model_download(
    validated_dir: &std::path::Path,
    staging_dir: &std::path::Path,
    model_files: &'static [(&'static str, &'static [&'static str])],
) -> Result<(), String> {
    std::fs::create_dir_all(validated_dir)
        .map_err(|e| format!("Failed to create model directory: {e}"))?;

    for filename in PARAKEET_MODEL_CLEANUP_FILES {
        let file_path = validated_dir.join(filename);
        if file_path.exists() {
            let _ = std::fs::remove_file(&file_path);
        }
    }

    for (filename, _) in model_files {
        let src = staging_dir.join(filename);
        let dst = validated_dir.join(filename);
        std::fs::rename(&src, &dst)
            .map_err(|e| format!("Failed to move {filename} to final location: {e}"))?;
    }

    let _ = std::fs::remove_dir_all(staging_dir);

    Ok(())
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
async fn download_parakeet_model_to_dir(
    app: &AppHandle,
    validated_dir: &Path,
    download_key: &str,
) -> Result<(), String> {
    std::fs::create_dir_all(validated_dir)
        .map_err(|e| format!("Failed to create model directory: {e}"))?;

    let http_client = app.state::<http_client::HttpClient>();
    let model_files = parakeet_model_files_for_dir(validated_dir);
    let expected_file_sizes = parakeet_model_file_sizes(&http_client, model_files).await?;

    let staging_dir = parakeet_staging_dir(validated_dir);
    if parakeet_model_files_match(&staging_dir, &expected_file_sizes) {
        tracing::info!("Finalizing previously completed Parakeet model download");
        finalize_parakeet_model_download(validated_dir, &staging_dir, model_files)?;
        invalidate_parakeet_cache_for_dir(validated_dir).await;
        return Ok(());
    }

    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir)
            .map_err(|e| format!("Failed to clean staging directory: {e}"))?;
    }
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create staging directory: {e}"))?;

    let total_size = expected_file_sizes
        .iter()
        .fold(0_u64, |acc, (_, size)| acc.saturating_add(*size));

    let mut downloaded_total: u64 = 0;

    let download_result: Result<(), String> = async {
        for (idx, (filename, urls)) in model_files.iter().enumerate() {
            let file_path = staging_dir.join(filename);
            let mut file = tokio::fs::File::create(&file_path)
                .await
                .map_err(|e| format!("Failed to create {filename}: {e}"))?;

            for url in *urls {
                tracing::info!("Downloading {filename} part from {url}");

                let response = request_model_file(&http_client, url)
                    .await
                    .map_err(|error| format!("Failed to download {filename}: {error}"))?;

                let mut stream = response.bytes_stream();
                while let Some(chunk_result) = stream.next().await {
                    if model_download_cancelled(download_key).await {
                        return Err("Model download cancelled".to_string());
                    }
                    let chunk =
                        chunk_result.map_err(|e| format!("Download error for {filename}: {e}"))?;
                    file.write_all(&chunk)
                        .await
                        .map_err(|e| format!("Write error for {filename}: {e}"))?;

                    downloaded_total = downloaded_total.saturating_add(chunk.len() as u64);

                    let progress = if total_size > 0 {
                        (downloaded_total as f64 / total_size as f64) * 100.0
                    } else {
                        ((idx as f64 + 0.5) / model_files.len() as f64) * 100.0
                    };

                    set_model_download_progress(
                        app,
                        download_key,
                        progress,
                        format!("Downloading {filename}: {progress:.0}%"),
                    )
                    .await;
                }
            }

            file.flush()
                .await
                .map_err(|e| format!("Failed to flush {filename}: {e}"))?;

            tracing::info!("Finished downloading {filename}");
        }
        Ok(())
    }
    .await;

    if let Err(e) = &download_result {
        tracing::warn!("Download failed, cleaning up staging directory: {e}");
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(e.clone());
    }

    if !parakeet_model_files_match(&staging_dir, &expected_file_sizes) {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err("Downloaded model files did not match expected sizes".to_string());
    }

    finalize_parakeet_model_download(validated_dir, &staging_dir, model_files)?;

    invalidate_parakeet_cache_for_dir(validated_dir).await;

    Ok(())
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub async fn delete_parakeet_model(app: AppHandle, model_dir: String) -> Result<(), String> {
    let validated_dir = validate_model_path(&app, &model_dir)?;

    if !validated_dir.exists() {
        return Err(format!("Model directory not found: {model_dir}"));
    }

    invalidate_parakeet_cache_for_dir(&validated_dir).await;
    clear_model_download_status(&validated_dir).await;

    tokio::fs::remove_dir_all(&validated_dir)
        .await
        .map_err(|e| format!("Failed to delete model directory: {e}"))?;

    Ok(())
}

fn convert_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels == 1 {
        return samples.to_vec();
    }

    let sample_count = samples.len() / channels;
    let mut mono_samples = Vec::with_capacity(sample_count);

    for i in 0..sample_count {
        let mut sample_sum = 0.0;
        for c in 0..channels {
            sample_sum += samples[i * channels + c];
        }
        mono_samples.push(sample_sum / channels as f32);
    }

    mono_samples
}

fn mix_samples(dest: &mut Vec<f32>, source: &[f32]) -> usize {
    for (dest_sample, source_sample) in dest.iter_mut().zip(source) {
        *dest_sample = (*dest_sample + *source_sample) * 0.5;
    }
    let previous_length = dest.len();
    if source.len() > previous_length {
        dest.extend_from_slice(&source[previous_length..]);
    }
    dest.len()
}

#[cfg(test)]
mod tests {
    use super::{
        AudioExtractionSource, CaptionWord, caption_text_from_words, caption_word_chunks,
        mix_samples, model_url_candidates, normalize_caption_words,
        resolve_audio_extraction_source, resolve_path_with_base,
    };
    use tempfile::tempdir;

    fn word(text: &str, index: usize) -> CaptionWord {
        CaptionWord {
            text: text.to_string(),
            start: index as f32,
            end: index as f32 + 0.5,
        }
    }

    #[test]
    fn resolve_path_with_base_rejects_parent_dir_escape() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("app-data");
        std::fs::create_dir_all(base.join("models")).unwrap();

        let escaped = base.join("..").join("outside.bin");

        let result = resolve_path_with_base(&base, escaped.to_string_lossy().as_ref());

        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_with_base_allows_nested_model_path() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("app-data");
        std::fs::create_dir_all(base.join("models")).unwrap();

        let target = base.join("models").join("nested").join("model.bin");
        let expected = base
            .canonicalize()
            .unwrap()
            .join("models")
            .join("nested")
            .join("model.bin");

        let resolved = resolve_path_with_base(&base, target.to_string_lossy().as_ref()).unwrap();

        assert_eq!(resolved, expected);
    }

    #[test]
    fn audio_extraction_source_accepts_project_directory_without_cap_extension() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("recording");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("recording-meta.json"), "{}").unwrap();

        match resolve_audio_extraction_source(project_dir.to_string_lossy().as_ref()).unwrap() {
            AudioExtractionSource::ProjectDirectory {
                base_path,
                meta_path,
            } => {
                assert_eq!(base_path, project_dir);
                assert_eq!(meta_path, base_path.join("recording-meta.json"));
            }
            AudioExtractionSource::MediaFile(_) => panic!("expected project directory"),
        }
    }

    #[test]
    fn audio_extraction_source_rejects_directory_without_recording_metadata() {
        let dir = tempdir().unwrap();
        let result = resolve_audio_extraction_source(dir.path().to_string_lossy().as_ref());

        match result {
            Ok(_) => panic!("expected missing metadata error"),
            Err(error) => assert_eq!(error, "Recording directory is missing recording-meta.json"),
        }
    }

    #[test]
    fn audio_extraction_source_accepts_media_file() {
        let dir = tempdir().unwrap();
        let media_file = dir.path().join("recording.mp4");
        std::fs::write(&media_file, []).unwrap();

        match resolve_audio_extraction_source(media_file.to_string_lossy().as_ref()).unwrap() {
            AudioExtractionSource::MediaFile(path) => assert_eq!(path, media_file),
            AudioExtractionSource::ProjectDirectory { .. } => panic!("expected media file"),
        }
    }

    #[test]
    fn normalize_caption_words_attaches_punctuation() {
        let words = normalize_caption_words(vec![
            word("test", 0),
            word(",", 1),
            word("test", 2),
            word(".", 3),
        ]);

        assert_eq!(caption_text_from_words(&words), "test, test.");
        assert_eq!(words.len(), 2);
    }

    #[test]
    fn normalize_caption_words_clamps_inflated_trailing_word() {
        let words = normalize_caption_words(vec![CaptionWord {
            text: "seconds.".to_string(),
            start: 53.92,
            end: 70.16,
        }]);

        assert_eq!(words.len(), 1);
        assert!((words[0].end - (53.92 + super::MAX_CAPTION_WORD_DURATION)).abs() < 1e-4);
    }

    #[test]
    fn normalize_caption_words_keeps_normal_word_durations() {
        let words = normalize_caption_words(vec![CaptionWord {
            text: "hello".to_string(),
            start: 1.0,
            end: 1.4,
        }]);

        assert_eq!(words.len(), 1);
        assert!((words[0].end - 1.4).abs() < 1e-4);
    }

    #[test]
    fn mixing_preserves_the_longer_source_tail() {
        let mut destination = vec![1.0, 1.0];
        mix_samples(&mut destination, &[0.0, 0.0, 0.75]);
        assert_eq!(destination, vec![0.5, 0.5, 0.75]);
    }

    #[test]
    fn model_urls_always_keep_the_public_fallback() {
        let fallback = "https://example.com/releases/download/v1/model.bin";
        let candidates = model_url_candidates(fallback);
        assert_eq!(candidates.last().map(String::as_str), Some(fallback));
    }

    #[test]
    fn caption_word_chunks_do_not_end_on_short_connector_when_more_words_follow() {
        let words = [
            "This", "is", "where", "we", "record", "I", "want", "clean", "captions",
        ]
        .iter()
        .enumerate()
        .map(|(index, text)| word(text, index))
        .collect::<Vec<_>>();

        let chunks = caption_word_chunks(&words);

        assert_eq!(
            caption_text_from_words(chunks[0]),
            "This is where we record I want"
        );
        assert_eq!(caption_text_from_words(chunks[1]), "clean captions");
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    mod parakeet {
        use super::super::parakeet_model_dir_matches;
        use tempfile::tempdir;

        #[test]
        fn parakeet_model_dir_match_uses_full_directory_path() {
            let dir = tempdir().unwrap();
            let model_dir = dir.path().join("models").join("parakeet-best");

            assert!(parakeet_model_dir_matches(
                model_dir.to_string_lossy().as_ref(),
                &model_dir
            ));
            assert!(!parakeet_model_dir_matches(
                dir.path()
                    .join("models")
                    .join("parakeet-best-max")
                    .to_string_lossy()
                    .as_ref(),
                &model_dir
            ));
        }
    }
}
