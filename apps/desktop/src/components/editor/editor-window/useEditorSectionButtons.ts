import { useEffect, useMemo, useState } from "react";
import {
  Camera01Icon,
  ClosedCaptionIcon,
  CursorIcon,
  LayersIcon,
  PuzzleIcon,
  Settings01Icon,
  SparklesIcon,
  AiBrain01Icon,
} from "@/components/icons";
import { extensionHost } from "@/lib/extensions";
import type { EditorEffectSection } from "@/types/editor";
import type { EditorSectionButton } from "./EditorSectionRail";

type Translate = (key: string, fallback: string) => string;

export function useEditorSectionButtons(t: Translate): EditorSectionButton[] {
  const [extensionSectionButtons, setExtensionSectionButtons] = useState<
    EditorSectionButton[]
  >([]);

  useEffect(() => {
    const update = () => {
      const panels = extensionHost.getSettingsPanels();
      const standalone = panels
        .filter((panel) => !panel.panel.parentSection)
        .map((panel) => ({
          id: `ext:${panel.extensionId}/${panel.panel.id}` as EditorEffectSection,
          label: panel.panel.label,
          icon:
            (panel.panel.icon as EditorSectionButton["icon"] | undefined) ??
            PuzzleIcon,
        }));
      setExtensionSectionButtons(standalone);
    };

    update();
    return extensionHost.onChange(update);
  }, []);

  return useMemo(
    () => [
      {
        id: "scene" as const,
        label: t("settings.sections.scene", "Scene"),
        icon: SparklesIcon,
      },
      {
        id: "layers" as const,
        label: t("settings.sections.layers", "Layers"),
        icon: LayersIcon,
      },
      {
        id: "cursor" as const,
        label: t("settings.sections.cursor", "Cursor"),
        icon: CursorIcon,
      },
      {
        id: "webcam" as const,
        label: t("settings.sections.webcam", "Webcam"),
        icon: Camera01Icon,
      },
      {
        id: "captions" as const,
        label: t("settings.sections.captions", "Captions"),
        icon: ClosedCaptionIcon,
      },
      {
        id: "ai" as const,
        label: t("settings.sections.ai", "AI"),
        icon: AiBrain01Icon,
      },
      {
        id: "settings" as const,
        label: t("settings.sections.settings", "Settings"),
        icon: Settings01Icon,
      },
      ...extensionSectionButtons,
      // {
      //   id: "extensions" as const,
      //   label: t("settings.sections.extensions", "Extensions"),
      //   icon: PuzzleIcon,
      // },
    ],
    [t, extensionSectionButtons],
  );
}
