import React from "react";

interface CropSectionProps {
  content: React.ReactNode;
}

export function CropSection({ content }: CropSectionProps) {
  return <section className="flex flex-col gap-2">{content}</section>;
}
