// hud-topmost-guard
//
// Long-lived Windows helper that keeps the transparent, always-on-top HUD
// overlay reliably above ordinary application windows.
//
// Background: on Windows, `alwaysOnTop` only places a window in the single
// HWND_TOPMOST band, and the OS is free to reorder windows within that band.
// Worse, activating another application via Alt+Tab / Win+Tab / the taskbar can
// leave a *non*-topmost window rendered above our topmost HUD (the classic
// "alwaysOnBottom" state). Electron's `moveTop()` only re-orders within the
// current band using SetWindowPos(HWND_TOP, ...) and does not re-assert the
// WS_EX_TOPMOST flag, so a JS poll of moveTop() is both too slow and too weak
// to fix this reliably.
//
// Reacting on a timer alone is visibly imperfect: between the moment another
// window is activated and the next poll, that window is painted above the HUD
// for a frame or two, producing a brief flash when the guard snaps the HUD back
// on top. To eliminate that, this helper reacts to the foreground-change event
// itself (EVENT_SYSTEM_FOREGROUND via SetWinEventHook) and re-asserts topmost
// synchronously, before the compositor presents a frame with the HUD behind. A
// low-frequency timer remains only as a backstop for z-order changes that don't
// raise a foreground event.
//
// The re-assert uses SetWindowPos(HWND_TOPMOST, ...) with
// SWP_NOACTIVATE|SWP_NOMOVE|SWP_NOSIZE and deliberately WITHOUT SWP_SHOWWINDOW,
// so it:
//   * re-asserts the actual WS_EX_TOPMOST flag (not just band order),
//   * never steals focus or moves/resizes the window, and
//   * does not corrupt the WS_EX_TRANSPARENT mouse pass-through flag that
//     SWP_SHOWWINDOW is known to break on Windows 11.
// That makes it safe to run continuously, even while the user is interacting
// with the HUD.
//
// Usage: hud-topmost-guard.exe <hwnd-decimal>
//   <hwnd-decimal> is the HUD BrowserWindow's native handle as an unsigned
//   decimal integer (from Electron's getNativeWindowHandle()).
// The process exits when the target window is destroyed, when stdin closes, or
// when it receives the line "stop" on stdin.

#include <windows.h>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

static HWND g_target = nullptr;
static DWORD g_mainThreadId = 0;
static std::atomic<bool> g_stopping{false};

// Re-assert the HUD's topmost position without activating, moving, resizing, or
// (critically) showing the window — SWP_SHOWWINDOW would corrupt Win11 mouse
// pass-through.
static void reassertTopmost() {
  SetWindowPos(g_target, HWND_TOPMOST, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

// Returns true when a visible, non-topmost window is stacked above `target`,
// meaning the HUD has been pushed underneath an ordinary window and its topmost
// status needs to be re-asserted.
static bool isCoveredByNonTopmost(HWND target) {
  for (HWND above = GetWindow(target, GW_HWNDPREV); above != nullptr;
       above = GetWindow(above, GW_HWNDPREV)) {
    if (!IsWindowVisible(above)) {
      continue;
    }
    const LONG exStyle = GetWindowLong(above, GWL_EXSTYLE);
    if ((exStyle & WS_EX_TOPMOST) != 0) {
      // A legitimate topmost peer above us is allowed — keep scanning.
      continue;
    }
    // A visible, non-topmost window is above our topmost HUD: covered.
    return true;
  }
  return false;
}

static void requestStop() {
  if (!g_stopping.exchange(true)) {
    PostThreadMessage(g_mainThreadId, WM_QUIT, 0, 0);
  }
}

// Fired the instant another window becomes the foreground window. Re-assert
// topmost immediately so the incoming window never gets a chance to paint over
// the HUD (which is what produced the flash with a poll-only approach).
static void CALLBACK winEventProc(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD,
                                  DWORD) {
  if (!IsWindow(g_target)) {
    requestStop();
    return;
  }
  if (IsWindowVisible(g_target)) {
    reassertTopmost();
  }
}

static void stdinListener() {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line == "stop") {
      requestStop();
      return;
    }
  }
  // stdin closed (parent exited) — shut down so we don't linger.
  requestStop();
}

int main(int argc, char** argv) {
  std::setvbuf(stdout, nullptr, _IONBF, 0);

  if (argc < 2) {
    std::cerr << "hud-topmost-guard: missing <hwnd> argument" << std::endl;
    return 1;
  }

  const unsigned long long raw = std::strtoull(argv[1], nullptr, 10);
  if (raw == 0ULL) {
    std::cerr << "hud-topmost-guard: invalid <hwnd> argument" << std::endl;
    return 1;
  }
  g_target = reinterpret_cast<HWND>(static_cast<uintptr_t>(raw));
  g_mainThreadId = GetCurrentThreadId();

  std::thread listener(stdinListener);
  listener.detach();

  // Instant reaction to window activations (Alt+Tab, taskbar, clicking another
  // app). WINEVENT_OUTOFCONTEXT delivers the callback on this thread via the
  // message loop below.
  HWINEVENTHOOK hook = SetWinEventHook(
      EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, winEventProc, 0,
      0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);

  // Backstop poll for z-order changes that don't raise a foreground event, and
  // to notice when the HUD window is destroyed. hwnd=NULL posts WM_TIMER to
  // this thread's queue, handled in the loop below.
  const UINT_PTR timerId = SetTimer(nullptr, 0, 250, nullptr);

  MSG msg;
  while (GetMessage(&msg, nullptr, 0, 0) > 0) {
    if (msg.message == WM_TIMER) {
      if (!IsWindow(g_target)) {
        break;
      }
      if (IsWindowVisible(g_target) && isCoveredByNonTopmost(g_target)) {
        reassertTopmost();
      }
      continue;
    }
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  if (timerId != 0) {
    KillTimer(nullptr, timerId);
  }
  if (hook != nullptr) {
    UnhookWinEvent(hook);
  }
  return 0;
}
