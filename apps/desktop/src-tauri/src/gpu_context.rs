use std::sync::Arc;
use tokio::sync::OnceCell;

pub struct SharedGpuContext {
    pub device: Arc<wgpu::Device>,
    pub queue: Arc<wgpu::Queue>,
    pub adapter: Arc<wgpu::Adapter>,
    pub instance: Arc<wgpu::Instance>,
    pub is_software_adapter: bool,
    pub background_cache: Arc<quiro_rendering::BackgroundTextureCache>,
}

static GPU: OnceCell<Option<SharedGpuContext>> = OnceCell::const_new();

/// Marks the crash sentinel while GPU adapter/device initialisation is in flight, so
/// a process death inside that window is attributable to graphics bring-up. Dropping
/// the guard (including during unwind from a caught panic) disarms the marker — a
/// survivable failure is not a GPU crash.
struct GpuInitPhaseGuard;

impl GpuInitPhaseGuard {
    fn arm() -> Self {
        crate::crash_sentinel::enter_gpu_init_phase();
        Self
    }
}

impl Drop for GpuInitPhaseGuard {
    fn drop(&mut self) {
        crate::crash_sentinel::exit_gpu_init_phase();
    }
}

async fn init_gpu_inner() -> Option<SharedGpuContext> {
    let _gpu_init_phase = GpuInitPhaseGuard::arm();

    let instance = quiro_rendering::create_wgpu_instance().await;

    let force_software_adapter = quiro_rendering::force_software_wgpu_adapter();
    if force_software_adapter {
        tracing::warn!("Forcing software WGPU adapter for shared context");
    }

    let hardware_adapter = if force_software_adapter {
        None
    } else {
        instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: None,
            })
            .await
            .ok()
    };

    let (adapter, is_software_adapter) = if let Some(adapter) = hardware_adapter {
        let adapter_info = adapter.get_info();
        let is_software_adapter = quiro_rendering::is_software_wgpu_adapter(&adapter_info);

        if is_software_adapter {
            tracing::warn!(
                adapter_name = adapter_info.name,
                adapter_backend = ?adapter_info.backend,
                adapter_device_type = ?adapter_info.device_type,
                "Selected shared-context adapter behaves like a software renderer"
            );
        } else {
            tracing::info!(
                adapter_name = adapter_info.name,
                adapter_backend = ?adapter_info.backend,
                adapter_device_type = ?adapter_info.device_type,
                "Using hardware GPU adapter for shared context"
            );
        }

        (adapter, is_software_adapter)
    } else {
        tracing::warn!(
            "No hardware GPU adapter found, attempting software fallback for shared context"
        );
        let software_adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                force_fallback_adapter: true,
                compatible_surface: None,
            })
            .await
            .ok()?;

        let adapter_info = software_adapter.get_info();

        tracing::info!(
            adapter_name = adapter_info.name,
            adapter_backend = ?adapter_info.backend,
            adapter_device_type = ?adapter_info.device_type,
            "Using software adapter for shared context (CPU rendering - performance may be reduced)"
        );
        (software_adapter, true)
    };

    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("quiro-shared-gpu-device"),
            required_features: wgpu::Features::empty(),
            ..Default::default()
        })
        .await
        .ok()?;

    Some(SharedGpuContext {
        device: Arc::new(device),
        queue: Arc::new(queue),
        adapter: Arc::new(adapter),
        instance: Arc::new(instance),
        is_software_adapter,
        background_cache: Arc::new(quiro_rendering::BackgroundTextureCache::default()),
    })
}

pub async fn get_shared_gpu() -> Option<&'static SharedGpuContext> {
    GPU.get_or_init(|| async {
        let result = tokio::spawn(init_gpu_inner()).await;

        match result {
            Ok(ctx) => ctx,
            Err(e) => {
                if e.is_panic() {
                    tracing::error!(
                        "GPU initialization panicked (wgpu internal error). \
                         The app will continue without GPU acceleration."
                    );
                } else {
                    tracing::error!(
                        error = %e,
                        "GPU initialization task failed"
                    );
                }
                None
            }
        }
    })
    .await
    .as_ref()
}

pub fn prewarm_gpu() {
    tokio::spawn(async {
        get_shared_gpu().await;
    });
}
