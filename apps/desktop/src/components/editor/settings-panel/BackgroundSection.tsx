import React from "react";

interface BackgroundSectionProps {
  content: React.ReactNode;
}

export function BackgroundSection({ content }: BackgroundSectionProps) {
  return <div className="space-y-4">{content}</div>;
}
