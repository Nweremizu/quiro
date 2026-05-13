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
import styles from "./LaunchWindow.module.css";

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
                ? "bg-yellow-500"
                : `bg-red-500 size-3 rounded-full animate-pulse transition-all duration-300 ease-in-out`
            }`}
          />
          <span
            className={`text-[10px] font-bold tracking-[0.06em] ${
              paused ? "text-yellow-500" : "text-red-500"
            }`}
          >
            {paused ? t("recording.paused") : t("recording.rec")}
          </span>
        </div>

        <span
          className={`min-w-13 text-center font-mono text-xs font-semibold tracking-[0.02em] ${
            paused ? "text-yellow-500" : "text-red-500"
          }`}
        >
          {formatTime(elapsed)}
        </span>

        <Separator orientation="vertical" className="mx-1.25 h-6" />

        <span title={t("recording.micToggleDisabledTip")}>
          <Button
            variant="ghost"
            size="icon-lg"
            className={microphoneEnabled ? styles.ibActive : ""}
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

        <Separator orientation="vertical" className="mx-[5px] h-6" />

        <Button
          variant={paused ? "default" : "ghost"}
          size="icon-lg"
          onClick={onPauseResume}
          title={paused ? t("recording.resume") : t("recording.pause")}
          aria-label={paused ? t("recording.resume") : t("recording.pause")}
          className={paused ? styles.ibGreen : ""}
        >
          {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
        </Button>

        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onStopRecording}
          title={t("recording.stop")}
          aria-label={t("recording.stop")}
          className={styles.ibRed}
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
