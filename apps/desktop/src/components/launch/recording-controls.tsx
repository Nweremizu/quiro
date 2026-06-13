import {
  Cancel01Icon,
  Mic01Icon,
  MicOff01Icon,
  MinusSignIcon as MinusIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
} from "@/components/icons/generated";
import { useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface RecordingControlsProps {
  paused: boolean;
  microphoneEnabled: boolean;
  elapsed: number;
  onToggleMicrophone: () => void;
  onPauseResume: () => void;
  onStopRecording: () => void;
  onHideHud: () => void;
  onCancelRecording: () => void;
  formatTime: (seconds: number) => string;
}

export const RecordingControls = ({
  paused,
  microphoneEnabled,
  elapsed,
  onToggleMicrophone,
  onPauseResume,
  onStopRecording,
  onHideHud,
  onCancelRecording,
  formatTime,
}: RecordingControlsProps) => {
  const t = useScopedT("launch");

  const memoizedControls = useMemo(() => {
    return (
      <>
        <div className="flex items-center gap-1.25">
          <div
            className={`h-1.75 w-1.75 rounded-full ${
              paused
                ? "bg-[#d6a13d]"
                : `size-3 rounded-full bg-[#b7332f] recording-active transition-[background-color,box-shadow] duration-300 ease-in-out`
            }`}
          />
          <span
            className={`text-[10px] font-bold tracking-[0.06em] ${
              paused ? "text-[#d6a13d]" : "text-[#e9b6a4]"
            }`}
          >
            {paused ? t("recording.paused") : t("recording.rec")}
          </span>
        </div>

        <span
          className={`min-w-13 text-center font-mono text-xs font-semibold tracking-[0.02em] ${
            paused ? "text-[#d6a13d]" : "text-[#e9b6a4]"
          }`}
        >
          {formatTime(elapsed)}
        </span>

        <Separator orientation="vertical" className="mx-1.25 h-6" />

        <span title={t("recording.micToggleDisabledTip")}>
          <Button
            variant="ghost"
            size="icon-lg"
            className={microphoneEnabled ? "text-primary" : ""}
            aria-label={t("recording.micToggleDisabledTip")}
            disabled
            onClick={onToggleMicrophone}
          >
            {microphoneEnabled ? (
              <Mic01Icon size={18} />
            ) : (
              <MicOff01Icon size={18} />
            )}
          </Button>
        </span>

        <Separator orientation="vertical" className="mx-1.25 h-6" />

        <Button
          variant={paused ? "default" : "ghost"}
          size="icon-lg"
          onClick={onPauseResume}
          title={paused ? t("recording.resume") : t("recording.pause")}
          aria-label={paused ? t("recording.resume") : t("recording.pause")}
          className={
            paused
              ? "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(112,45,10,0.22)] hover:bg-primary/90"
              : ""
          }
        >
          {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
        </Button>

        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onStopRecording}
          title={t("recording.stop")}
          aria-label={t("recording.stop")}
          className={
            "bg-[#b7332f] text-white shadow-[0_8px_18px_rgba(112,45,10,0.24),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[#a52d2a]"
          }
        >
          <SquareIcon size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onHideHud}
          title={t("recording.hideHud")}
          aria-label={t("recording.hideHud")}
        >
          <MinusIcon size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onCancelRecording}
          title={t("recording.cancel")}
          aria-label={t("recording.cancel")}
        >
          <Cancel01Icon size={18} />
        </Button>
      </>
    );
  }, [
    paused,
    microphoneEnabled,
    elapsed,
    onToggleMicrophone,
    onPauseResume,
    onStopRecording,
    onHideHud,
    onCancelRecording,
    formatTime,
    t,
  ]);

  return memoizedControls;
};
