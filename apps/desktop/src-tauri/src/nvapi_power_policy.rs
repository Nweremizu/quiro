//! Registers this process with the NVIDIA driver's "Prefer maximum
//! performance" power management mode via the Driver Settings (DRS) API —
//! the same setting NVIDIA Control Panel's "Power management mode" dropdown
//! writes. Root cause: on a bursty ~60fps render workload (short GPU work
//! then idle waiting for the next frame), the driver's adaptive clocking
//! repeatedly downclocks memory to its idle P-state (810 MHz) between our
//! frames and doesn't always reclock in time for the next one, starving the
//! GPU readback the preview pipeline depends on. `nvidia-smi` traces showed
//! `clocks.memory` flickering between 810 MHz and 5501 MHz mid-playback,
//! landing exactly on the frames where `render_ms`/`prepare_ms` spiked.
//!
//! The driver only reads DRS settings when it first initializes for a
//! process (NVIDIA's Driver Settings Programming Guide, "Setting Application
//! Behavior"), so writing this has no effect on the process that writes it —
//! it takes effect starting the *next* launch. Every step here is best-effort
//! and silently gives up on any failure (missing DLL, non-NVIDIA GPU, any
//! unexpected driver status): this is a performance nicety, never something
//! that should be able to affect startup or crash the app.
//!
//! Struct layouts and interface IDs below are cross-checked against two
//! independent sources: NVIDIA's own published interface ID table
//! (github.com/NVIDIA/nvapi/nvapi_interface.h) and the widely-used,
//! MIT-licensed NvAPIWrapper project's byte-verified native structs
//! (github.com/falahati/NvAPIWrapper), which agree exactly. NVAPI's DRS
//! struct/function bodies aren't in NVIDIA's public GitHub repo (only in the
//! gated SDK download), so this is the best available verification without
//! that download.

#![cfg(target_os = "windows")]

use std::ffi::c_void;

use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::core::PCWSTR;

type QueryInterfaceFn = unsafe extern "C" fn(u32) -> *const c_void;

// Interface IDs, verified against NVIDIA/nvapi's nvapi_interface.h.
const ID_NVAPI_INITIALIZE: u32 = 0x0150_E828;
const ID_DRS_CREATE_SESSION: u32 = 0x0694_D52E;
const ID_DRS_DESTROY_SESSION: u32 = 0xDAD9_CFF8;
const ID_DRS_LOAD_SETTINGS: u32 = 0x375D_BD6B;
const ID_DRS_SAVE_SETTINGS: u32 = 0xFCBC_7E14;
const ID_DRS_FIND_PROFILE_BY_NAME: u32 = 0x7E4A_9A0B;
const ID_DRS_CREATE_PROFILE: u32 = 0xCC17_6068;
const ID_DRS_FIND_APPLICATION_BY_NAME: u32 = 0xEEE5_66B2;
const ID_DRS_CREATE_APPLICATION: u32 = 0x4347_A9DE;
const ID_DRS_SET_SETTING: u32 = 0x577D_D202;

const NVAPI_OK: i32 = 0;

// From NvApiDriverSettings.h.
const PREFERRED_PSTATE_ID: u32 = 0x1057_EB71;
const PREFERRED_PSTATE_PREFER_MAX: u32 = 0x0000_0001;

const DRS_SETTING_TYPE_INTEGER: u32 = 0;

const UNICODE_STRING_LEN: usize = 2048;

/// Mirrors `NvAPIWrapper.Native.General.Structures.UnicodeString`: a fixed
/// 2048-`u16` NUL-terminated buffer. `#[repr(C)]` on a single array field
/// reproduces the same layout as the source's `[StructLayout(Sequential)]`.
#[repr(C)]
#[derive(Clone, Copy)]
struct UnicodeString([u16; UNICODE_STRING_LEN]);

impl UnicodeString {
    fn empty() -> Self {
        Self([0; UNICODE_STRING_LEN])
    }

    fn from_str(s: &str) -> Self {
        let mut buf = [0u16; UNICODE_STRING_LEN];
        for (dst, src) in buf.iter_mut().zip(s.encode_utf16().take(UNICODE_STRING_LEN - 1)) {
            *dst = src;
        }
        Self(buf)
    }
}

/// `struct_size_in_bytes | (version_number << 16)` — NVIDIA's
/// `MAKE_NVAPI_VERSION` macro, cross-checked against
/// `NvAPIWrapper.Native.General.Structures.StructureVersion`.
const fn make_version(struct_size: usize, version_number: u32) -> u32 {
    (struct_size as u32) | (version_number << 16)
}

/// Mirrors `NvAPIWrapper.Native.DRS.Structures.DRSSettingValue`: NVAPI packs
/// every setting value type into one fixed 4100-byte union-like buffer
/// (max(4096 binary bytes + 4-byte length prefix, 2048 UTF-16 code units)).
/// We only ever write the DWORD case: first 4 bytes as a little-endian u32,
/// the rest zeroed.
#[repr(C)]
#[derive(Clone, Copy)]
struct DrsSettingValue([u8; 4100]);

impl DrsSettingValue {
    fn zero() -> Self {
        Self([0; 4100])
    }

    fn from_u32(value: u32) -> Self {
        let mut buf = [0u8; 4100];
        buf[0..4].copy_from_slice(&value.to_le_bytes());
        Self(buf)
    }
}

/// Mirrors `NvAPIWrapper.Native.DRS.Structures.DRSSettingV1`.
#[repr(C)]
#[derive(Clone, Copy)]
struct DrsSettingV1 {
    version: u32,
    setting_name: UnicodeString,
    setting_id: u32,
    setting_type: u32,
    setting_location: u32,
    is_current_predefined: u32,
    is_predefined_valid: u32,
    predefined_value: DrsSettingValue,
    current_value: DrsSettingValue,
}

/// Mirrors `NvAPIWrapper.Native.DRS.Structures.DRSApplicationV1`.
#[repr(C)]
#[derive(Clone, Copy)]
struct DrsApplicationV1 {
    version: u32,
    is_predefined: u32,
    application_name: UnicodeString,
    friendly_name: UnicodeString,
    launcher_name: UnicodeString,
}

/// Mirrors `NvAPIWrapper.Native.DRS.Structures.DRSProfileV1`. NVIDIA's
/// `NVDRS_GPU_SUPPORT` (`DRSGPUSupport` in the reference wrapper) is a single
/// `u32` bitflag: bit 0 GeForce, bit 1 Quadro, bit 2 NVS.
#[repr(C)]
#[derive(Clone, Copy)]
struct DrsProfileV1 {
    version: u32,
    profile_name: UnicodeString,
    gpu_support: u32,
    is_predefined: u32,
    number_of_applications: u32,
    number_of_settings: u32,
}

const GPU_SUPPORT_GEFORCE: u32 = 1 << 0;
const GPU_SUPPORT_QUADRO: u32 = 1 << 1;
const GPU_SUPPORT_NVS: u32 = 1 << 2;
const GPU_SUPPORT_ALL: u32 = GPU_SUPPORT_GEFORCE | GPU_SUPPORT_QUADRO | GPU_SUPPORT_NVS;

type SessionHandle = *mut c_void;
type ProfileHandle = *mut c_void;

type FnInitialize = unsafe extern "C" fn() -> i32;
type FnDrsCreateSession = unsafe extern "C" fn(*mut SessionHandle) -> i32;
type FnDrsDestroySession = unsafe extern "C" fn(SessionHandle) -> i32;
type FnDrsLoadSettings = unsafe extern "C" fn(SessionHandle) -> i32;
type FnDrsSaveSettings = unsafe extern "C" fn(SessionHandle) -> i32;
type FnDrsFindProfileByName =
    unsafe extern "C" fn(SessionHandle, UnicodeString, *mut ProfileHandle) -> i32;
type FnDrsCreateProfile =
    unsafe extern "C" fn(SessionHandle, *const DrsProfileV1, *mut ProfileHandle) -> i32;
type FnDrsFindApplicationByName = unsafe extern "C" fn(
    SessionHandle,
    UnicodeString,
    *mut ProfileHandle,
    *mut DrsApplicationV1,
) -> i32;
type FnDrsCreateApplication =
    unsafe extern "C" fn(SessionHandle, ProfileHandle, *const DrsApplicationV1) -> i32;
type FnDrsSetSetting =
    unsafe extern "C" fn(SessionHandle, ProfileHandle, *const DrsSettingV1) -> i32;

fn load_query_interface() -> Option<QueryInterfaceFn> {
    unsafe {
        let name: Vec<u16> = "nvapi64.dll".encode_utf16().chain(std::iter::once(0)).collect();
        let module = LoadLibraryW(PCWSTR(name.as_ptr())).ok()?;
        let proc = GetProcAddress(module, windows::core::s!("nvapi_QueryInterface"))?;
        Some(std::mem::transmute::<
            unsafe extern "system" fn() -> isize,
            QueryInterfaceFn,
        >(proc))
    }
}

/// Resolves one NVAPI function by interface ID, transmuting the returned
/// pointer to the caller-specified function-pointer type. Every NVAPI
/// function beyond `nvapi_QueryInterface` itself is reached this way — the
/// DLL exports nothing else by name.
fn resolve<T: Copy>(query: QueryInterfaceFn, id: u32) -> Result<T, &'static str> {
    let ptr = unsafe { query(id) };
    if ptr.is_null() {
        return Err("interface not available");
    }
    debug_assert_eq!(std::mem::size_of::<T>(), std::mem::size_of::<*const c_void>());
    Ok(unsafe { std::mem::transmute_copy(&ptr) })
}

/// Best-effort: sets this process's NVIDIA driver power-management profile to
/// "prefer maximum performance". Never panics, never blocks startup on
/// failure — every early return just means the next launch stays on the
/// driver's default adaptive clocking, exactly as if this function didn't
/// exist. Must run before any GPU device is created (see module docs), so
/// call this as early as possible in `run()`.
pub fn ensure_max_performance_profile() {
    let Some(query) = load_query_interface() else {
        tracing::debug!("nvapi64.dll not found; skipping GPU power policy setup (no NVIDIA driver?)");
        return;
    };

    let Ok(initialize) = resolve::<FnInitialize>(query, ID_NVAPI_INITIALIZE) else {
        tracing::debug!("NvAPI_Initialize unavailable; skipping GPU power policy setup");
        return;
    };
    if unsafe { initialize() } != NVAPI_OK {
        tracing::debug!("NvAPI_Initialize failed; skipping GPU power policy setup");
        return;
    }

    let Ok(create_session) = resolve::<FnDrsCreateSession>(query, ID_DRS_CREATE_SESSION) else {
        tracing::debug!("NvAPI_DRS_CreateSession unavailable; skipping GPU power policy setup");
        return;
    };
    let mut session: SessionHandle = std::ptr::null_mut();
    if unsafe { create_session(&mut session) } != NVAPI_OK || session.is_null() {
        tracing::debug!("NvAPI_DRS_CreateSession failed; skipping GPU power policy setup");
        return;
    }

    // Every path from here must still reach DestroySession — DRS sessions
    // hold driver-side resources until explicitly torn down.
    match try_set_max_performance(query, session) {
        Ok(()) => tracing::info!(
            "Registered 'prefer maximum performance' GPU power policy for this app \
             (takes effect on the next launch)"
        ),
        Err(reason) => tracing::debug!(reason, "GPU power policy setup skipped"),
    }

    if let Ok(destroy_session) = resolve::<FnDrsDestroySession>(query, ID_DRS_DESTROY_SESSION) {
        unsafe { destroy_session(session) };
    }
}

fn try_set_max_performance(query: QueryInterfaceFn, session: SessionHandle) -> Result<(), &'static str> {
    let load_settings: FnDrsLoadSettings = resolve(query, ID_DRS_LOAD_SETTINGS)?;
    if unsafe { load_settings(session) } != NVAPI_OK {
        return Err("LoadSettings failed");
    }

    let exe_name = current_exe_file_name().ok_or("could not determine current exe name")?;
    let exe_name_unicode = UnicodeString::from_str(&exe_name);

    let find_application: FnDrsFindApplicationByName = resolve(query, ID_DRS_FIND_APPLICATION_BY_NAME)?;
    let mut profile: ProfileHandle = std::ptr::null_mut();
    let mut found_application = DrsApplicationV1 {
        version: make_version(std::mem::size_of::<DrsApplicationV1>(), 1),
        is_predefined: 0,
        application_name: UnicodeString::empty(),
        friendly_name: UnicodeString::empty(),
        launcher_name: UnicodeString::empty(),
    };
    let already_registered = unsafe {
        find_application(session, exe_name_unicode, &mut profile, &mut found_application)
    } == NVAPI_OK
        && !profile.is_null();

    if !already_registered {
        const PROFILE_NAME: &str = "quiro-desktop (max performance)";
        let find_profile: FnDrsFindProfileByName = resolve(query, ID_DRS_FIND_PROFILE_BY_NAME)?;
        let profile_name_unicode = UnicodeString::from_str(PROFILE_NAME);
        let found_profile =
            unsafe { find_profile(session, profile_name_unicode, &mut profile) } == NVAPI_OK
                && !profile.is_null();

        if !found_profile {
            let create_profile: FnDrsCreateProfile = resolve(query, ID_DRS_CREATE_PROFILE)?;
            let new_profile = DrsProfileV1 {
                version: make_version(std::mem::size_of::<DrsProfileV1>(), 1),
                profile_name: profile_name_unicode,
                gpu_support: GPU_SUPPORT_ALL,
                is_predefined: 0,
                number_of_applications: 0,
                number_of_settings: 0,
            };
            if unsafe { create_profile(session, &new_profile, &mut profile) } != NVAPI_OK
                || profile.is_null()
            {
                return Err("CreateProfile failed");
            }
        }

        let create_application: FnDrsCreateApplication = resolve(query, ID_DRS_CREATE_APPLICATION)?;
        let new_application = DrsApplicationV1 {
            version: make_version(std::mem::size_of::<DrsApplicationV1>(), 1),
            is_predefined: 0,
            application_name: exe_name_unicode,
            friendly_name: UnicodeString::from_str("Quiro"),
            launcher_name: UnicodeString::empty(),
        };
        if unsafe { create_application(session, profile, &new_application) } != NVAPI_OK {
            return Err("CreateApplication failed");
        }
    }

    let set_setting: FnDrsSetSetting = resolve(query, ID_DRS_SET_SETTING)?;
    let setting = DrsSettingV1 {
        version: make_version(std::mem::size_of::<DrsSettingV1>(), 1),
        setting_name: UnicodeString::empty(),
        setting_id: PREFERRED_PSTATE_ID,
        setting_type: DRS_SETTING_TYPE_INTEGER,
        setting_location: 0,
        is_current_predefined: 0,
        is_predefined_valid: 0,
        predefined_value: DrsSettingValue::zero(),
        current_value: DrsSettingValue::from_u32(PREFERRED_PSTATE_PREFER_MAX),
    };
    if unsafe { set_setting(session, profile, &setting) } != NVAPI_OK {
        return Err("SetSetting failed");
    }

    let save_settings: FnDrsSaveSettings = resolve(query, ID_DRS_SAVE_SETTINGS)?;
    if unsafe { save_settings(session) } != NVAPI_OK {
        return Err("SaveSettings failed");
    }

    Ok(())
}

fn current_exe_file_name() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let name = exe.file_name()?;
    Some(name.to_string_lossy().into_owned())
}
