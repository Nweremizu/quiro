use tokio::task::JoinHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitRequestDecision {
    StartCleanup,
    AlreadyExiting,
    ExportActive,
    AllowRuntimeExit,
}

pub(crate) fn handle_exit_requested<FPrevent>(
    is_exiting: bool,
    export_active: bool,
    runtime_exit_requested: bool,
    prevent_exit: FPrevent,
) -> ExitRequestDecision
where
    FPrevent: FnOnce(),
{
    if is_exiting && runtime_exit_requested {
        ExitRequestDecision::AllowRuntimeExit
    } else if export_active {
        prevent_exit();
        ExitRequestDecision::ExportActive
    } else if is_exiting {
        prevent_exit();
        ExitRequestDecision::AlreadyExiting
    } else {
        prevent_exit();
        ExitRequestDecision::StartCleanup
    }
}

pub(crate) fn read_target_under_cursor<TDisplay, TWindow, FExit, FDisplay, FWindow>(
    is_exiting: FExit,
    display: FDisplay,
    window: FWindow,
) -> Option<(Option<TDisplay>, Option<TWindow>)>
where
    FExit: Fn() -> bool,
    FDisplay: FnOnce() -> Option<TDisplay>,
    FWindow: FnOnce() -> Option<TWindow>,
{
    if is_exiting() {
        return None;
    }

    let display = display();

    if is_exiting() {
        return None;
    }

    let window = window();

    if is_exiting() {
        return None;
    }

    Some((display, window))
}

pub(crate) fn abort_join_handles<T>(
    tasks: impl IntoIterator<Item = JoinHandle<T>>,
    task: Option<JoinHandle<T>>,
) {
    for task in tasks {
        task.abort();
    }

    if let Some(task) = task {
        task.abort();
    }
}
