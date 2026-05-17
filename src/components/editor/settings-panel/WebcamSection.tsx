import React from "react";

interface WebcamSectionProps {
  content: React.ReactNode;
  renderExtensionPanelsForSections: (...args: string[]) => React.ReactNode;
}

export function WebcamSection({
  content,
  renderExtensionPanelsForSections,
}: WebcamSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      {content}
      {renderExtensionPanelsForSections("webcam")}
    </section>
  );
}
