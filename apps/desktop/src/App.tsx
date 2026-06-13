import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "./components/ui/sonner";
import { useI18n } from "./contexts/I18nContext";
import { loadAllCustomFonts } from "./lib/customFonts";
import "./App.css";
import { ShortcutsProvider } from "@/contexts/shortcut-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { PerfOverlay } from "@/components/dev/PerfOverlay";

// Each window type is lazy-loaded so a given BrowserWindow only parses the
// code it renders. The editor chunk in particular carries pixi.js and the
// exporters; without lazy() every window (HUD overlay, countdown, toast)
// loads it at startup.
const LaunchWindow = lazy(() =>
  import("@/components/launch/window").then((m) => ({
    default: m.LaunchWindow,
  })),
);
const SourceSelector = lazy(() =>
  import("./components/launch/source-selector").then((m) => ({
    default: m.SourceSelector,
  })),
);
const CountdownOverlay = lazy(() =>
  import("./components/countdown/CountdownOverlay").then((m) => ({
    default: m.CountdownOverlay,
  })),
);
const UpdateToastWindow = lazy(() =>
  import("./components/launch/UpdateToastWindow").then((m) => ({
    default: m.UpdateToastWindow,
  })),
);
const EditorWindow = lazy(() => import("@/components/editor/window"));

export default function App() {
  // Resolve synchronously so the correct window renders (and its lazy chunk
  // starts loading) on first paint instead of after a mount effect.
  const [windowType, setWindowType] = useState(
    () => new URLSearchParams(window.location.search).get("windowType") || "",
  );
  const { t } = useI18n();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("windowType") || "";
    const isMacOS = /mac/i.test(navigator.platform);
    setWindowType(type);
    document.documentElement.dataset.windowType = type;

    if (
      type === "hud-overlay" ||
      type === "source-selector" ||
      type === "countdown" ||
      (type === "update-toast" && isMacOS)
    ) {
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
      document
        .getElementById("root")
        ?.style.setProperty("background", "transparent");
    }

    if (type === "hud-overlay") {
      document.documentElement.classList.add("hud-overlay-window");
      document.body.classList.add("hud-overlay-window");
      document.getElementById("root")?.classList.add("hud-overlay-window");
      window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
    } else if (type === "update-toast") {
      document.documentElement.style.overflow = "visible";
      document.body.style.overflow = "visible";
      document.getElementById("root")?.style.setProperty("overflow", "visible");
    }

    loadAllCustomFonts().catch((error) => {
      console.error("Failed to load custom fonts:", error);
    });
  }, []);

  useEffect(() => {
    document.title =
      windowType === "editor"
        ? t("app.editorTitle", "Quiro Editor")
        : t("app.name", "Quiro");
  }, [windowType, t]);

  // Render the correct window, then overlay PerfOverlay (toggled via Ctrl+Shift+P).
  // The HUD overlay and countdown are excluded — they run in borderless pass-through
  // windows where a debug panel would interfere.
  const skipPerf = windowType === "hud-overlay" || windowType === "countdown";

  const windowContent = (() => {
    switch (windowType) {
      case "hud-overlay":
        return (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <LaunchWindow />
            </Suspense>
            <Toaster className="pointer-events-auto" />
          </ErrorBoundary>
        );
      case "source-selector":
        return (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <SourceSelector />
            </Suspense>
          </ErrorBoundary>
        );
      case "countdown":
        return (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <CountdownOverlay />
            </Suspense>
          </ErrorBoundary>
        );
      case "update-toast":
        return (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <UpdateToastWindow />
            </Suspense>
          </ErrorBoundary>
        );
      case "editor":
        return (
          <ErrorBoundary>
            <ShortcutsProvider>
              <TooltipProvider>
                <Suspense fallback={null}>
                  <EditorWindow />
                </Suspense>
              </TooltipProvider>
              {/* <ShortcutsConfigDialog /> */}
            </ShortcutsProvider>
          </ErrorBoundary>
        );
      default:
        return (
          <div className="flex font-sans! h-full w-full items-center justify-center bg- background text-foreground">
            <div className="flex items-center gap-4 rounded-2xl border border-foreground/10 bg-foreground/5 px-6 py-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <img
                src="/app-icons/quiro-128.png"
                alt={t("app.name", "Quiro")}
                className="h-12 w-12 rounded-xl"
              />
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  {t("app.name", "Quiro")}
                </h1>
                <p className="text-sm text-foreground/65">
                  {t("app.subtitle", "Screen recording and editing")}
                </p>
              </div>
            </div>
          </div>
        );
    }
  })();

  return (
    <>
      {windowContent}
      {!skipPerf && <PerfOverlay />}
    </>
  );
}
