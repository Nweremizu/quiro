import React from "react";

interface SceneSectionProps {
  backgroundSettingsContent: React.ReactNode;
  frameSectionContent: React.ReactNode;
  cropSectionContent: React.ReactNode;
  renderExtensionPanelsForSections: (...args: string[]) => React.ReactNode;
}

export function SceneSection({
  backgroundSettingsContent,
  frameSectionContent,
  cropSectionContent,
  renderExtensionPanelsForSections,
}: SceneSectionProps) {
  return (
    <div className="space-y-4">
      {backgroundSettingsContent}
      {frameSectionContent}
      {cropSectionContent}
      {renderExtensionPanelsForSections("scene", "appearance", "frame", "crop")}
    </div>
  );
}
