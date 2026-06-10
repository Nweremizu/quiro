import { useEffect, useState } from "react";
import type { FrameInstance } from "@/lib/extensions/types";
import { extensionHost } from "@/lib/extensions/extensionHost";
import { ExtensionSettingsSection } from "./ExtensionSettingsSection";

export function useExtensionSettings() {
  const [availableFrames, setAvailableFrames] = useState<FrameInstance[]>([]);
  const [extensionPanels, setExtensionPanels] = useState<
    ReturnType<typeof extensionHost.getSettingsPanels>
  >([]);

  useEffect(() => {
    const update = () => setAvailableFrames(extensionHost.getFrames());
    update();
    return extensionHost.onChange(update);
  }, []);

  useEffect(() => {
    const update = () => setExtensionPanels(extensionHost.getSettingsPanels());
    update();
    return extensionHost.onChange(update);
  }, []);

  const renderExtensionPanelsForSections = (...sections: string[]) =>
    extensionPanels
      .filter((panel) => {
        const parentSection = panel.panel.parentSection;
        return parentSection ? sections.includes(parentSection) : false;
      })
      .map((panel) => (
        <ExtensionSettingsSection
          key={`${panel.extensionId}/${panel.panel.id}`}
          extensionId={panel.extensionId}
          label={panel.panel.label}
          fields={panel.panel.fields}
        />
      ));

  return {
    availableFrames,
    extensionPanels,
    renderExtensionPanelsForSections,
  };
}
