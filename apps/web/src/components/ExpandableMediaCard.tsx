"use client";

import { useEffect } from "react";
import { ArrowRight, Link as LinkIcon } from "lucide-react";
import {
  ExpandableScreen,
  ExpandableScreenContent,
  ExpandableScreenTrigger,
  useExpandableScreen,
} from "@/components/ui/expandable-screen";

interface ExpandableMediaCardProps {
  layoutId: string;
  src: string;
  /** "video" renders a <video> (autoplay muted loop inline; controls when expanded). */
  mediaType?: "image" | "video";
  alt: string;
  title: string;
  description: string;
  hoverLabel: string;
  /** Literal Tailwind class for the expanded pill width, e.g. "group-hover:w-[148px]". */
  hoverWidthClass: string;
  /** Literal aspect class for the media container, e.g. "aspect-[329/246]". */
  aspectClass: string;
  mediaBgClass: string;
  /** Dark pill with white arrow (card 2 style) instead of white pill with link icon. */
  darkPill?: boolean;
}

function EscapeToClose() {
  const { isExpanded, collapse } = useExpandableScreen();
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, collapse]);
  return null;
}

function Media({
  src,
  alt,
  mediaType,
  className,
  controls = false,
}: {
  src: string;
  alt: string;
  mediaType: "image" | "video";
  className: string;
  controls?: boolean;
}) {
  if (mediaType === "video") {
    return (
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        controls={controls}
        className={className}
      />
    );
  }
  return <img src={src} alt={alt} className={className} />;
}

export function ExpandableMediaCard({
  layoutId,
  src,
  mediaType = "image",
  alt,
  title,
  description,
  hoverLabel,
  hoverWidthClass,
  aspectClass,
  mediaBgClass,
  darkPill = false,
}: ExpandableMediaCardProps) {
  return (
    <div>
      <ExpandableScreen
        layoutId={layoutId}
        triggerRadius="16px"
        contentRadius="24px"
        animationDuration={0.4}
      >
        <EscapeToClose />

        {/* Aspect box reserves the card's space while the trigger is unmounted */}
        <div className={`${aspectClass} w-full`}>
          <ExpandableScreenTrigger className="w-full">
            <div
              className={`group relative ${aspectClass} w-full overflow-hidden rounded-2xl ${mediaBgClass}`}
            >
              <Media
                src={src}
                alt={alt}
                mediaType={mediaType}
                className="h-full w-full object-cover"
              />
              <span
                className={`absolute bottom-4 left-4 flex h-9 w-9 items-center justify-end gap-2 overflow-hidden rounded-full pr-[11px] transition-all duration-300 ease-in-out ${hoverWidthClass} ${
                  darkPill ? "bg-gray-900" : "bg-white"
                }`}
              >
                <span
                  className={`whitespace-nowrap text-[13px] font-medium opacity-0 transition-opacity duration-300 delay-100 group-hover:opacity-100 ${
                    darkPill ? "text-white" : "text-gray-900"
                  }`}
                >
                  {hoverLabel}
                </span>
                {darkPill ? (
                  <ArrowRight
                    size={14}
                    className="shrink-0 -rotate-45 text-white transition-transform duration-300 group-hover:rotate-0"
                  />
                ) : (
                  <LinkIcon
                    size={14}
                    className="shrink-0 -rotate-45 text-gray-900 transition-transform duration-300 group-hover:rotate-0"
                  />
                )}
              </span>
            </div>
          </ExpandableScreenTrigger>
        </div>

        <ExpandableScreenContent
          className="bg-[#101010]"
          closeButtonClassName="bg-white/10 text-white hover:bg-white/20"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-5 sm:p-10">
            <Media
              src={src}
              alt={alt}
              mediaType={mediaType}
              controls
              className="max-h-[100vh] w-auto max-w-full rounded-xl object-contain"
            />
            <div className="text-center">
              <h3 className="text-[15px] font-semibold text-white">{title}</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-white/60">
                {description}
              </p>
            </div>
          </div>
        </ExpandableScreenContent>
      </ExpandableScreen>

      <p className="mt-4 text-[13px] leading-relaxed text-gray-600 sm:text-[14px]">
        {description}
      </p>
      <h3 className="mt-1 text-[14px] font-semibold text-gray-900 sm:text-[15px]">
        {title}
      </h3>
    </div>
  );
}
