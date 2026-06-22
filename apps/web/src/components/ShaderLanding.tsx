"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ArrowRight, Clock, Menu, X } from "lucide-react";
import { GITHUB_OWNER, GITHUB_REPO } from "@quiro/shared";
import { ExpandableMediaCard } from "./ExpandableMediaCard";
import type { LatestRelease } from "@/lib/releases";

const ShaderBackdrop = dynamic(() => import("./ShaderBackdrop"), {
  ssr: false,
});

const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const EASE = "ease-[cubic-bezier(0.25,0.1,0.25,1)]";

interface Props {
  release: LatestRelease | null;
}

/* ─── Hooks ──────────────────────────────────────────────── */

function useLondonTime(): string | null {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
    });
    const tick = () => setTime(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

type ClientPlatform = "windows" | "macos-arm" | "macos-intel" | "unknown";

function usePlatformDownload(release: LatestRelease | null) {
  const [platform, setPlatform] = useState<ClientPlatform>("unknown");

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("windows")) {
      setPlatform("windows");
    } else if (ua.includes("macintosh") || ua.includes("mac os x")) {
      const uaData = (navigator as { userAgentData?: { platform?: string } })
        .userAgentData;
      setPlatform(
        uaData?.platform?.toLowerCase().includes("arm")
          ? "macos-arm"
          : "macos-intel",
      );
    }
  }, []);

  const fallbackUrl =
    release?.releasesPageUrl ?? `${GITHUB_URL}/releases/latest`;

  const url = (() => {
    if (!release) return fallbackUrl;
    if (platform === "windows")
      return release.windows?.browser_download_url ?? fallbackUrl;
    if (platform === "macos-arm")
      return (
        release.macosArm?.browser_download_url ??
        release.macosIntel?.browser_download_url ??
        fallbackUrl
      );
    if (platform === "macos-intel")
      return release.macosIntel?.browser_download_url ?? fallbackUrl;
    return fallbackUrl;
  })();

  const label = (() => {
    if (platform === "windows") return "Download for Windows";
    if (platform === "macos-arm" || platform === "macos-intel")
      return "Download for macOS";
    return "Download Quiro";
  })();

  return { url, label };
}

/* ─── Shared pieces ──────────────────────────────────────── */

/** Duplicated label inside a 20px-tall mask; rolls up -50% on group hover. */
function TextRoll({ label }: { label: string }) {
  return (
    <span className="block h-[20px] overflow-hidden">
      <span
        className={`flex flex-col transition-transform duration-500 ${EASE} group-hover:-translate-y-1/2`}
      >
        <span className="flex h-[20px] items-center">{label}</span>
        <span className="flex h-[20px] items-center">{label}</span>
      </span>
    </span>
  );
}

function StarburstIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
    >
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  );
}

/** Orange pill CTA with text-roll label and a white arrow circle. */
function OrangeButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-3 self-start rounded-full bg-[#F26522] pl-5 pr-2 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#e05a1a] sm:pl-6 sm:text-[14px]"
    >
      <TextRoll label={label} />
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white sm:h-8 sm:w-8">
        <ArrowRight
          size={14}
          className={`text-[#F26522] transition-transform duration-500 ${EASE} group-hover:-rotate-45`}
        />
      </span>
    </a>
  );
}

function SectionBadge({
  number,
  label,
  borderClass,
}: {
  number: string;
  label: string;
  borderClass: string;
}) {
  return (
    <div className="mb-6 flex items-center gap-3 px-5 sm:mb-8 sm:px-8 lg:px-12">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white sm:h-7 sm:w-7 sm:text-[12px]">
        {number}
      </span>
      <span
        className={`rounded-full border ${borderClass} px-3 py-1 text-[12px] font-medium text-gray-900 sm:px-4 sm:py-1.5 sm:text-[13px]`}
      >
        {label}
      </span>
    </div>
  );
}

/* ─── Navigation ─────────────────────────────────────────── */

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Features", href: "#about" },
  { label: "Showcase", href: "#work" },
  { label: "Releases", href: `${GITHUB_URL}/releases` },
  { label: "GitHub", href: GITHUB_URL },
];

function Navbar({
  time,
  downloadUrl,
  downloadLabel,
  onOpenMenu,
}: {
  time: string | null;
  downloadUrl: string;
  downloadLabel: string;
  onOpenMenu: () => void;
}) {
  return (
    <header className="relative z-20">
      <div className="mx-auto max-w-[1440px] p-2 sm:p-3">
        <nav className="flex items-center justify-between rounded-full bg-white p-[5px]">
          <div className="flex items-center">
            <a
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white overflow-hidden shadow-sm ring-1 ring-black/5 transition-opacity hover:opacity-80 sm:h-10 sm:w-10"
              aria-label="Quiro home"
            >
              <Image
                src="/app-icons/quiro-128.png"
                alt="Quiro"
                width={40}
                height={40}
                className="h-full w-full object-cover"
                priority
              />
            </a>
            <div className="ml-5 hidden items-center gap-6 md:flex">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-[14px] text-gray-900 transition-colors duration-300 hover:text-gray-500"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-5 md:flex">
            <span className="hidden text-[13px] text-gray-600 lg:block">
              Free for Windows &amp; macOS
            </span>
            <span className="flex items-center gap-1.5 text-[13px] text-gray-600">
              <Clock size={14} />
              {time ?? "--:--"} in London
            </span>
            <a
              href={downloadUrl}
              className="group flex items-center gap-2.5 rounded-full bg-gray-900 pl-5 pr-2 py-2 text-[13px] font-medium text-white"
            >
              <TextRoll label={downloadLabel} />
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                <ArrowRight
                  size={12}
                  className={`text-gray-900 transition-transform duration-500 ${EASE} group-hover:-rotate-45`}
                />
              </span>
            </a>
          </div>

          <button
            type="button"
            onClick={onOpenMenu}
            className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2.5 text-[13px] font-medium text-white md:hidden"
          >
            Menu
            <Menu size={16} />
          </button>
        </nav>
      </div>
    </header>
  );
}

function MobileMenu({
  open,
  onClose,
  time,
  downloadUrl,
  downloadLabel,
}: {
  open: boolean;
  onClose: () => void;
  time: string | null;
  downloadUrl: string;
  downloadLabel: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setMounted(true);
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true)),
      );
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    closeTimer.current = setTimeout(() => setMounted(false), 500);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-500 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 mx-3 mb-3 rounded-2xl bg-white p-5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600">
            <Clock size={13} />
            {time ?? "--:--"} in London
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white"
          >
            Close
            <X size={16} />
          </button>
        </div>

        <nav className="mt-8 flex flex-col gap-4">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={onClose}
              className="text-[28px] font-medium leading-tight text-gray-900 sm:text-[32px]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <a
          href={downloadUrl}
          onClick={onClose}
          className="group mt-8 flex w-full items-center justify-between rounded-full bg-[#F26522] pl-6 pr-2 py-2 text-[14px] font-medium text-white"
        >
          <TextRoll label={downloadLabel} />
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
            <ArrowRight size={14} className="text-[#F26522]" />
          </span>
        </a>
      </div>
    </div>
  );
}

/* ─── Section 1: Hero ────────────────────────────────────── */

function Hero({
  release,
  time,
  downloadUrl,
  downloadLabel,
  onOpenMenu,
}: {
  release: LatestRelease | null;
  time: string | null;
  downloadUrl: string;
  downloadLabel: string;
  onOpenMenu: () => void;
}) {
  return (
    <section className="relative flex min-h-screen flex-col overflow-hidden bg-[#EFEFEF]">
      <div className="pointer-events-none absolute inset-0 z-10">
        <ShaderBackdrop />
      </div>

      <Navbar
        time={time}
        downloadUrl={downloadUrl}
        downloadLabel={downloadLabel}
        onOpenMenu={onOpenMenu}
      />

      <div className="flex-1" />

      <div className="relative z-20 mx-auto w-full max-w-[1440px] px-5 pb-14 sm:px-8 sm:pb-16 lg:px-12 lg:pb-20">
        <p className="mb-5 text-[13px] tracking-wide text-gray-900 sm:mb-8 sm:text-[14px]">
          Quiro
        </p>
        <h1 className="text-[length:clamp(1.75rem,7vw,4.2rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 sm:text-[length:clamp(2.5rem,5vw,4.2rem)]">
          Record your screen with
          <span className="sm:hidden"> </span>
          <br className="hidden sm:block" />
          cinematic cursor effects and an
          <span className="sm:hidden"> </span>
          <br className="hidden sm:block" />
          AI transcript, built in.
        </h1>

        <div className="mt-8 flex flex-col gap-4 sm:mt-12 sm:flex-row sm:items-center sm:gap-5">
          <OrangeButton href={downloadUrl} label={downloadLabel} />
          <a
            href={GITHUB_URL}
            className="inline-flex items-center gap-2 self-start rounded-[4px] bg-white px-3 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] sm:gap-2.5 sm:px-4 sm:py-2.5"
          >
            <StarburstIcon className="h-5 w-5 fill-current text-[#E8704E] sm:h-6 sm:w-6" />
            <span className="text-[13px] font-medium text-gray-900 sm:text-[14px]">
              Free &amp; open source
            </span>
            <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white sm:px-2 sm:text-[11px]">
              {release ? `v${release.version}` : "GitHub"}
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Section 2: About ───────────────────────────────────── */

function About() {
  return (
    <section
      id="about"
      className="overflow-hidden bg-white pt-16 pb-12 sm:pt-20 sm:pb-16 lg:pt-32 lg:pb-24"
    >
      <div className="mx-auto max-w-[1440px]">
        <SectionBadge
          number="1"
          label="Introducing Quiro"
          borderClass="border-gray-200"
        />

        <h2 className="mb-12 px-5 text-[length:clamp(1.5rem,4vw,3.2rem)] font-medium leading-[1.12] tracking-[-0.02em] text-gray-900 sm:mb-16 sm:px-8 lg:mb-28 lg:px-12">
          Studio-quality recordings,
          <span className="sm:hidden"> </span>
          <br className="hidden sm:block" />
          without the studio editing.
        </h2>

        {/* Mobile / tablet */}
        <div className="px-5 sm:px-8 lg:hidden">
          <p className="text-[15px] font-medium leading-[1.6] text-gray-900 sm:text-[17px]">
            Quiro smooths and amplifies every cursor movement as you record,
            then writes a full AI transcript before you&apos;ve hit stop.
          </p>
          <div className="mt-6">
            <OrangeButton href={GITHUB_URL} label="More about Quiro" />
          </div>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:gap-5">
            <img
              src="/feature3.png"
              alt="Quiro recording controls"
              className="aspect-[438/346] w-full rounded-xl object-cover sm:w-[45%] sm:rounded-2xl"
            />
            <img
              src="/demo.gif"
              alt="A screen recording made with Quiro"
              className="aspect-[900/600] w-full rounded-xl object-cover sm:w-[55%] sm:rounded-2xl"
            />
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden grid-cols-[26%_1fr_48%] items-end gap-6 px-12 lg:grid xl:gap-8">
          <img
            src="/feature3.png"
            alt="Quiro recording controls"
            className="aspect-[438/346] w-full self-end rounded-2xl object-cover"
          />
          <div className="flex justify-end self-start">
            <div>
              <p className="whitespace-nowrap text-[16px] font-medium leading-[1.65] text-gray-900 xl:text-[18px]">
                Quiro smooths and amplifies every
                <br />
                cursor movement as you record, then
                <br />
                writes a full AI transcript before
                <br />
                you&apos;ve hit stop.
              </p>
              <div className="mt-8">
                <OrangeButton href={GITHUB_URL} label="More about Quiro" />
              </div>
            </div>
          </div>
          <img
            src="/demo.gif"
            alt="A screen recording made with Quiro"
            className="aspect-[3/2] w-full self-end rounded-2xl object-cover"
          />
        </div>
      </div>
    </section>
  );
}

/* ─── Section 3: Showcase ────────────────────────────────── */

function Showcase() {
  return (
    <section
      id="work"
      className="bg-[#F5F5F5] pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-28 lg:pb-28"
    >
      <div className="mx-auto max-w-[1440px]">
        <SectionBadge
          number="2"
          label="Quiro in action"
          borderClass="border-gray-300"
        />

        <h2 className="mb-10 px-5 text-[length:clamp(1.75rem,7vw,4.2rem)] font-medium leading-[1.08] tracking-[-0.03em] text-gray-900 sm:mb-14 sm:px-8 sm:text-[length:clamp(2.5rem,5vw,4.2rem)] lg:mb-16 lg:px-12">
          What you get
        </h2>

        <div className="grid grid-cols-1 gap-5 px-5 sm:gap-6 sm:px-8 md:grid-cols-2 lg:gap-7 lg:px-12">
          <ExpandableMediaCard
            layoutId="showcase-cursor-effects"
            src="/feature1.gif"
            alt="Smooth cursor effects in a Quiro recording"
            title="Cursor effects"
            description="Every cursor movement smoothed, eased and magnified automatically — no keyframes, no timeline"
            hoverLabel="Learn more"
            hoverWidthClass="group-hover:w-[148px]"
            aspectClass="aspect-[329/246]"
            mediaBgClass="bg-[#1a1d2e]"
          />
          <ExpandableMediaCard
            layoutId="showcase-ai-transcription"
            src="/feature2.gif"
            alt="AI transcription generated by Quiro"
            title="AI transcription"
            description="Every word spoken while recording, transcribed by AI and ready the moment you stop"
            hoverLabel="Watch the demo"
            hoverWidthClass="group-hover:w-[148px]"
            aspectClass="aspect-[329/246]"
            mediaBgClass="bg-[#6b6b6b]"
            darkPill
          />
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────── */

function Footer({ release }: { release: LatestRelease | null }) {
  return (
    <footer className="bg-[#F5F5F5]">
      <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-3 border-t border-gray-200 px-5 py-8 text-[12px] text-gray-500 sm:flex-row sm:items-center sm:px-8 lg:px-12">
        <span>
          © {new Date().getFullYear()} Quiro. Free &amp; open source
          {release ? ` — v${release.version}` : ""}.
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {release?.windows && (
            <a
              href={release.windows.browser_download_url}
              className="transition-colors hover:text-gray-900"
            >
              Windows
            </a>
          )}
          {release?.macosArm && (
            <a
              href={release.macosArm.browser_download_url}
              className="transition-colors hover:text-gray-900"
            >
              Apple Silicon
            </a>
          )}
          {release?.macosIntel && (
            <a
              href={release.macosIntel.browser_download_url}
              className="transition-colors hover:text-gray-900"
            >
              Intel Mac
            </a>
          )}
          <a
            href={`${GITHUB_URL}/releases`}
            className="transition-colors hover:text-gray-900"
          >
            All releases
          </a>
          <a
            href={GITHUB_URL}
            className="transition-colors hover:text-gray-900"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ───────────────────────────────────────────────── */

export function ShaderLanding({ release }: Props) {
  const time = useLondonTime();
  const { url: downloadUrl, label: downloadLabel } =
    usePlatformDownload(release);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <main>
      <Hero
        release={release}
        time={time}
        downloadUrl={downloadUrl}
        downloadLabel={downloadLabel}
        onOpenMenu={() => setMenuOpen(true)}
      />
      <About />
      <Showcase />
      <Footer release={release} />
      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        time={time}
        downloadUrl={downloadUrl}
        downloadLabel={downloadLabel}
      />
    </main>
  );
}
