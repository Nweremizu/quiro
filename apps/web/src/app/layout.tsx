import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quiro — AI-powered screen recording",
  description:
    "Record, annotate, and share your screen with AI-powered transcription and editing.",
  openGraph: {
    title: "Quiro",
    description: "AI-powered screen recording for Windows and macOS.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
