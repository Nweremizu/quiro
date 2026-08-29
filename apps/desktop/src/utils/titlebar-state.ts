import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type as ostype } from "@tauri-apps/plugin-os";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

export interface TitlebarState {
  height: string;
  hideMaximize: boolean;
  order: "right" | "left" | "platform";
  items?: ReactNode;
  maximized: boolean;
  maximizable: boolean;
  minimizable: boolean;
  closable: boolean;
  border: boolean;
  backgroundColor: string | null;
  transparent: boolean;
}

const DEFAULT_STATE: TitlebarState = {
  height: "36px",
  hideMaximize: true,
  order: "platform",
  items: null,
  maximized: false,
  maximizable: false,
  minimizable: true,
  closable: true,
  border: true,
  backgroundColor: null,
  transparent: false,
};

// A minimal external store (no extra dependency) standing in for Solid's
// createStore: a module-level snapshot, a listener set, and a setter that
// merges a partial patch and notifies subscribers.
let state: TitlebarState = DEFAULT_STATE;
const listeners = new Set<() => void>();

function getSnapshot(): TitlebarState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTitlebarState(
  patch:
    Partial<TitlebarState> | ((prev: TitlebarState) => Partial<TitlebarState>),
): void {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const listener of listeners) listener();
}

/** Reactive read for use inside React components — re-renders on change. */
export function useTitlebarState(): TitlebarState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** One-off, non-reactive read for use outside components. */
export function getTitlebarState(): TitlebarState {
  return state;
}

export async function initializeTitlebar(): Promise<UnlistenFn | undefined> {
  console.log("initializing titlebar");
  if (ostype() === "macos") return;

  const currentWindow = getCurrentWindow();
  const resizable = await currentWindow.isResizable();
  if (!resizable) return;

  const [maximized, maximizable] = await Promise.all([
    currentWindow.isMaximized(),
    currentWindow.isMaximizable(),
  ]);
  setTitlebarState({ maximized, maximizable });

  return await currentWindow.onResized(() => {
    currentWindow.isMaximized().then((maximized) => {
      setTitlebarState({ maximized });
    });
  });
}

export default getTitlebarState;
