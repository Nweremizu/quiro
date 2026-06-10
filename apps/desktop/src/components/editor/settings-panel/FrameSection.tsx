import React from "react";

interface FrameSectionProps {
  content: React.ReactNode;
  renderExtensionPanelsForSections: (...args: string[]) => React.ReactNode;
}

export function FrameSection({
  content,
  renderExtensionPanelsForSections,
}: FrameSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      {content}
      {renderExtensionPanelsForSections("frame", "appearance")}
    </section>
  );
}
