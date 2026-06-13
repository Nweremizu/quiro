import { spawnSync } from 'node:child_process';

type CursorBackend = 'python' | 'powershell';

const PYTHON_TIMEOUT_MS = 5000;
const POWERSHELL_TIMEOUT_MS = 8000;

const buildPythonSnippet = (show: boolean): string =>
  `
import ctypes, sys

class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

class CURSORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("hCursor", ctypes.c_void_p),
        ("ptScreenPos", POINT),
    ]

user32 = ctypes.windll.user32
CURSOR_SHOWING = 0x00000001

for _ in range(32):
    info = CURSORINFO()
    info.cbSize = ctypes.sizeof(CURSORINFO)
    if user32.GetCursorInfo(ctypes.byref(info)) and ${show ? '(info.flags & CURSOR_SHOWING)' : 'not (info.flags & CURSOR_SHOWING)'}:
        sys.exit(0)
    user32.ShowCursor(${show ? 'True' : 'False'})

sys.exit(0)
`.trim();

const buildPowerShellCommand = (show: boolean): string => {
  const desiredFlag = show ? 1 : 0;
  const showLiteral = show ? '$true' : '$false';

  return [
    '$signature = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public struct POINT { public int X; public int Y; }',
    'public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }',
    'public static class CursorNative {',
    '  [DllImport("user32.dll")] public static extern int ShowCursor(bool show);',
    '  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);',
    '}',
    '"@;',
    'Add-Type -TypeDefinition $signature -Language CSharp -ErrorAction SilentlyContinue | Out-Null;',
    '$info = New-Object CURSORINFO;',
    '$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type]CURSORINFO);',
    'for ($i = 0; $i -lt 32; $i++) {',
    '  if ([CursorNative]::GetCursorInfo([ref]$info) -and (($info.flags -band 1) -eq ' +
      desiredFlag +
      ')) { exit 0 }',
    '  [CursorNative]::ShowCursor(' + showLiteral + ') | Out-Null;',
    '}',
    'exit 0',
  ].join(' ');
};

function runPythonSnippet(code: string): boolean {
  for (const executable of ['python', 'python3', 'py']) {
    const result = spawnSync(executable, ['-c', code], {
      timeout: PYTHON_TIMEOUT_MS,
    });
    if (!result.error && result.status === 0) {
      return true;
    }
  }

  return false;
}

function runPowerShellSnippet(command: string): boolean {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      command,
    ],
    { timeout: POWERSHELL_TIMEOUT_MS }
  );

  return !result.error && result.status === 0;
}

function runCursorBackend(backend: CursorBackend, show: boolean): boolean {
  if (backend === 'python') {
    return runPythonSnippet(buildPythonSnippet(show));
  }

  return runPowerShellSnippet(buildPowerShellCommand(show));
}

function toggleCursor(show: boolean): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    return (
      runCursorBackend('python', show) || runCursorBackend('powershell', show)
    );
  } catch (error) {
    console.error('[cursor] Failed to update Windows cursor:', error);
    return false;
  }
}

export function hideCursor(): boolean {
  return toggleCursor(false);
}

export function showCursor(): boolean {
  return toggleCursor(true);
}
