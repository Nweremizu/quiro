# Launch window layouts

The classic launch window and the Icon tiles toolbar share recording settings,
capture targets, device menus, and capture commands. The toolbar is the default;
an explicitly saved classic selection is preserved.

With the launch window focused, press **Ctrl+Shift+L** on Windows/Linux or
**Cmd+Shift+L** on macOS to switch layouts. The classic window also has a Toolbar
button; the toolbar has a Switch to classic launch window button.

To choose a layout when starting the desktop executable, pass
`--launch-window=toolbar` or `--launch-window=classic`. These are application
arguments, not Vite arguments. For example, on Windows:

```powershell
.\quiro-desktop.exe --launch-window=toolbar
.\quiro-desktop.exe --launch-window=classic
```

The choice is saved as `launch_window` in the shared Tauri `store` file. Subsequent
launches without an argument and windows reopened from the tray use that choice.
Pass the argument when starting the app; it does not send a command to an already
running process. Use the in-app switch for a running app.

The toolbar uses Tailwind utilities. Display, Window, and Area buttons open the
on-screen picker; the Display and Window chevrons open the real target lists.
Recording mode exposes microphone selection, system audio, and the recording
countdown. Capture confirmation remains in the existing on-screen picker.

The development-only `/debug/launch-toolbar` route includes the same toolbar
component with local preview state and retains the design studies. Its controls
do not perform native capture or change the saved layout.
