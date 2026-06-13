import React from "react";

interface ZoomSectionProps {
  content: React.ReactNode;
  renderExtensionPanelsForSections: (...args: string[]) => React.ReactNode;
}

export function ZoomSection({
  content,
  renderExtensionPanelsForSections,
}: ZoomSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      {content}
      {renderExtensionPanelsForSections("zoom", "appearance", "frame", "crop")}
    </section>
  );
}
