use std::{
    collections::BTreeMap,
    env,
    os::unix::net::UnixStream,
    path::PathBuf,
    time::{Duration, Instant},
};

use rustix::event::{PollFd, PollFlags, Timespec, poll};
use wayland_client::{
    Connection, Dispatch, EventQueue, QueueHandle, WEnum,
    protocol::{wl_callback, wl_output, wl_registry},
};
use wayland_protocols::xdg::xdg_output::zv1::client::{zxdg_output_manager_v1, zxdg_output_v1};

use super::DisplayImpl;

#[derive(Clone, Copy, Default)]
struct OutputGeometry {
    position: (i32, i32),
    mode: Option<(i32, i32, i32)>,
    scale: i32,
    rotated: bool,
}

#[derive(Clone, Copy, Default)]
struct LogicalGeometry {
    position: Option<(i32, i32)>,
    size: Option<(i32, i32)>,
}

#[derive(Default)]
struct OutputState {
    pending: OutputGeometry,
    committed: Option<OutputGeometry>,
    logical_pending: LogicalGeometry,
    logical_committed: Option<LogicalGeometry>,
    xdg_version: Option<u32>,
}

impl OutputState {
    fn commit_output(&mut self) {
        self.committed = Some(self.pending);
        if self.xdg_version.is_some_and(|version| version >= 3) {
            self.logical_committed = Some(self.logical_pending);
        }
    }

    // Physical (mode) geometry is the raw framebuffer, matching what X11
    // RandR reports elsewhere in this file. Prefer xdg_output's logical
    // position/size when available -- on a fractionally-scaled output the
    // compositor places windows and delivers input in logical coordinates,
    // so using raw physical values here would misplace overlays and
    // cursor-containment checks on HiDPI Wayland outputs.
    fn display(&self, id: u32) -> Option<DisplayImpl> {
        let geometry = self.committed?;
        let (mut width, mut height, refresh) = geometry.mode?;
        if width <= 0 || height <= 0 {
            return None;
        }
        if geometry.rotated {
            std::mem::swap(&mut width, &mut height);
        }
        let (x, y, width, height) = if self.xdg_version.is_some() {
            let logical = self.logical_committed?;
            let (lx, ly) = logical.position?;
            let (lw, lh) = logical.size?;
            (lx, ly, lw, lh)
        } else {
            let scale = geometry.scale.max(1);
            (
                geometry.position.0,
                geometry.position.1,
                width / scale,
                height / scale,
            )
        };
        if width <= 0 || height <= 0 {
            return None;
        }
        Some(DisplayImpl {
            id,
            x,
            y,
            width: width as u32,
            height: height as u32,
            refresh_rate: if refresh > 0 {
                f64::from(refresh) / 1000.0
            } else {
                60.0
            },
        })
    }
}

#[derive(Default)]
struct State {
    globals: BTreeMap<u32, (String, u32)>,
    outputs: BTreeMap<u32, OutputState>,
    synced: bool,
}

/// Real output enumeration via wl_output + the xdg-output extension,
/// replacing the previous hardcoded single-1920x1080-display stub.
pub(super) fn displays() -> Option<Vec<DisplayImpl>> {
    let display = PathBuf::from(env::var_os("WAYLAND_DISPLAY")?);
    let socket = if display.is_absolute() {
        display
    } else {
        let runtime = PathBuf::from(env::var_os("XDG_RUNTIME_DIR")?);
        if !runtime.is_absolute() {
            return None;
        }
        runtime.join(display)
    };
    let connection = Connection::from_socket(UnixStream::connect(socket).ok()?).ok()?;
    query(&connection, Duration::from_millis(250))
}

fn query(connection: &Connection, timeout: Duration) -> Option<Vec<DisplayImpl>> {
    let deadline = Instant::now() + timeout;
    let mut queue = connection.new_event_queue::<State>();
    let handle = queue.handle();
    let registry = connection.display().get_registry(&handle, ());
    let mut state = State::default();
    roundtrip(connection, &mut queue, &mut state, deadline)?;

    let manager = state
        .globals
        .iter()
        .find(|(_, (interface, _))| interface == "zxdg_output_manager_v1")
        .map(|(&name, (_, version))| {
            let version = (*version).min(3);
            (
                registry.bind::<zxdg_output_manager_v1::ZxdgOutputManagerV1, _, _>(
                    name,
                    version,
                    &handle,
                    (),
                ),
                version,
            )
        });
    let mut legacy_outputs = Vec::new();
    for (&name, (interface, version)) in &state.globals {
        if interface != "wl_output" {
            continue;
        }
        let version = (*version).min(4);
        let output = registry.bind::<wl_output::WlOutput, _, _>(name, version, &handle, name);
        let mut output_state = OutputState::default();
        if let Some((manager, manager_version)) = &manager {
            // XDG v3 batches geometry through wl_output.done, unavailable on wl_output v1.
            if version >= 2 || *manager_version < 3 {
                let _xdg_output = manager.get_xdg_output(&output, &handle, name);
                output_state.xdg_version = Some(*manager_version);
            }
        }
        if version < 2 {
            legacy_outputs.push(name);
        }
        state.outputs.insert(name, output_state);
    }
    roundtrip(connection, &mut queue, &mut state, deadline)?;
    for name in legacy_outputs {
        if let Some(output) = state.outputs.get_mut(&name) {
            output.commit_output();
        }
    }
    Some(
        state
            .outputs
            .values()
            .enumerate()
            .filter_map(|(index, output)| output.display(index as u32))
            .collect(),
    )
}

fn roundtrip(
    connection: &Connection,
    queue: &mut EventQueue<State>,
    state: &mut State,
    deadline: Instant,
) -> Option<()> {
    state.synced = false;
    let _callback = connection.display().sync(&queue.handle(), ());
    loop {
        queue.dispatch_pending(state).ok()?;
        if state.synced {
            return Some(());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        connection.flush().ok()?;
        let Some(guard) = queue.prepare_read() else {
            continue;
        };
        let mut fds = [PollFd::new(connection, PollFlags::IN)];
        let timeout = Timespec::try_from(remaining).ok()?;
        match poll(&mut fds, Some(&timeout)) {
            Ok(0) => return None,
            Ok(_) if fds[0].revents().contains(PollFlags::IN) => {
                guard.read().ok()?;
            }
            Err(rustix::io::Errno::INTR) => continue,
            _ => return None,
        }
    }
}

impl Dispatch<wl_registry::WlRegistry, ()> for State {
    fn event(
        state: &mut Self,
        _: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            wl_registry::Event::Global {
                name,
                interface,
                version,
            } => {
                state.globals.insert(name, (interface, version));
            }
            wl_registry::Event::GlobalRemove { name } => {
                state.globals.remove(&name);
                state.outputs.remove(&name);
            }
            _ => {}
        }
    }
}

impl Dispatch<wl_callback::WlCallback, ()> for State {
    fn event(
        state: &mut Self,
        _: &wl_callback::WlCallback,
        _: wl_callback::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        state.synced = true;
    }
}

impl Dispatch<wl_output::WlOutput, u32> for State {
    fn event(
        state: &mut Self,
        _: &wl_output::WlOutput,
        event: wl_output::Event,
        name: &u32,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let Some(output) = state.outputs.get_mut(name) else {
            return;
        };
        match event {
            wl_output::Event::Geometry {
                x, y, transform, ..
            } => {
                output.pending.position = (x, y);
                output.pending.rotated = matches!(
                    transform,
                    WEnum::Value(
                        wl_output::Transform::_90
                            | wl_output::Transform::_270
                            | wl_output::Transform::Flipped90
                            | wl_output::Transform::Flipped270
                    )
                );
            }
            wl_output::Event::Mode {
                flags: WEnum::Value(flags),
                width,
                height,
                refresh,
            } if flags.contains(wl_output::Mode::Current) => {
                output.pending.mode = Some((width, height, refresh));
            }
            wl_output::Event::Scale { factor } => output.pending.scale = factor,
            wl_output::Event::Done => output.commit_output(),
            _ => {}
        }
    }
}

impl Dispatch<zxdg_output_manager_v1::ZxdgOutputManagerV1, ()> for State {
    fn event(
        _: &mut Self,
        _: &zxdg_output_manager_v1::ZxdgOutputManagerV1,
        _: zxdg_output_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<zxdg_output_v1::ZxdgOutputV1, u32> for State {
    fn event(
        state: &mut Self,
        _: &zxdg_output_v1::ZxdgOutputV1,
        event: zxdg_output_v1::Event,
        name: &u32,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let Some(output) = state.outputs.get_mut(name) else {
            return;
        };
        match event {
            zxdg_output_v1::Event::LogicalPosition { x, y } => {
                output.logical_pending.position = Some((x, y));
            }
            zxdg_output_v1::Event::LogicalSize { width, height } => {
                output.logical_pending.size = Some((width, height));
            }
            zxdg_output_v1::Event::Done => {
                output.logical_committed = Some(output.logical_pending);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scaled_output() -> OutputState {
        let mut output = OutputState {
            pending: OutputGeometry {
                mode: Some((1920, 1080, 59940)),
                scale: 2,
                ..Default::default()
            },
            xdg_version: Some(3),
            logical_pending: LogicalGeometry {
                position: Some((-960, 120)),
                size: Some((960, 540)),
            },
            ..Default::default()
        };
        output.commit_output();
        output
    }

    #[test]
    fn scaled_output_uses_logical_geometry() {
        let display = scaled_output().display(0).unwrap();
        assert_eq!(display.width, 960);
        assert_eq!(display.height, 540);
        assert_eq!(display.x, -960);
        assert_eq!(display.y, 120);
        assert_eq!(display.refresh_rate, 59.94);
    }

    #[test]
    fn rotated_output_swaps_physical_dimensions_before_falling_back() {
        let mut output = scaled_output();
        output.xdg_version = None;
        output.pending.rotated = true;
        output.commit_output();
        let display = output.display(0).unwrap();
        // 1920x1080 rotated -> 1080x1920, then divided by scale 2.
        assert_eq!(display.width, 540);
        assert_eq!(display.height, 960);
    }

    #[test]
    fn incomplete_geometry_is_not_reported() {
        assert!(OutputState::default().display(0).is_none());
        let mut output = scaled_output();
        output.logical_pending.size = Some((0, 540));
        output.commit_output();
        assert!(output.display(0).is_none());
    }

    #[test]
    fn core_output_scale_is_used_without_xdg_output() {
        let mut output = scaled_output();
        output.xdg_version = None;
        assert_eq!(output.display(0).unwrap().width, 960);
    }

    #[test]
    fn stalled_compositor_query_times_out() {
        let (client, _server) = UnixStream::pair().unwrap();
        let connection = Connection::from_socket(client).unwrap();
        let started = Instant::now();
        assert!(query(&connection, Duration::from_millis(20)).is_none());
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
