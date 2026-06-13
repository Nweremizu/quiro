import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const satoshi = localFont({
  src: "../../public/fonts/Satoshi-Variable.woff2",
  variable: "--font-display",
  weight: "300 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quiro — Screen recording, reimagined",
  description:
    "Record your screen with beautiful cursor effects and get an AI-powered transcript automatically.",
  icons: {
    icon: [
      { url: "/app-icons/quiro-16.png", sizes: "16x16", type: "image/png" },
      { url: "/app-icons/quiro-32.png", sizes: "32x32", type: "image/png" },
      { url: "/app-icons/quiro-128.png", sizes: "128x128", type: "image/png" },
      { url: "/app-icons/quiro-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app-icons/quiro-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/app-icons/apple-touch-icon.png",
    shortcut: "/app-icons/favicon.ico",
  },
  openGraph: {
    title: "Quiro",
    description: "Screen recording with AI transcription, built in.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={satoshi.variable}>
      <body>{children}</body>
    </html>
  );
}
