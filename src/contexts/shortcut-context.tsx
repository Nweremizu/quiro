import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_SHORTCUTS,
  mergeWithDefaults,
  type ShortcutsConfig,
} from "@/lib/shortcuts";
import { isMac as getIsMac } from "@electron/utils/platformUtils";

interface ShortcutsContextValue {
  shortcuts: ShortcutsConfig;
  isMac: boolean;
  setShortcuts: (config: ShortcutsConfig) => void;
  persistShortcuts: (config?: ShortcutsConfig) => Promise<void>;
  isConfigOpen: boolean;
  openConfig: () => void;
  closeConfig: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function useShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx)
    throw new Error("useShortcuts must be used within <ShortcutsProvider>");
  return ctx;
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] =
    useState<ShortcutsConfig>(DEFAULT_SHORTCUTS);
  const [isMac, setIsMac] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  useEffect(() => {
    getIsMac()
      .then(setIsMac)
      .catch(() => undefined);

    void (async () => {
      try {
        const saved = await window.electronAPI?.getShortcuts?.();
        if (saved) {
          setShortcuts(mergeWithDefaults(saved as Partial<ShortcutsConfig>));
        }
      } catch {
        return undefined;
      }
    })();
  }, []);

  const persistShortcuts = useCallback(
    async (config?: ShortcutsConfig) => {
      await window.electronAPI?.saveShortcuts?.(config ?? shortcuts);
    },
    [shortcuts],
  );

  const openConfig = useCallback(() => setIsConfigOpen(true), []);
  const closeConfig = useCallback(() => setIsConfigOpen(false), []);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      shortcuts,
      isMac,
      setShortcuts,
      persistShortcuts,
      isConfigOpen,
      openConfig,
      closeConfig,
    }),
    [shortcuts, isMac, persistShortcuts, isConfigOpen, openConfig, closeConfig],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
    </ShortcutsContext.Provider>
  );
}
