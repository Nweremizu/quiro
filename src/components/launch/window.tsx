import { AnimatePresence, motion } from "motion/react";
import { useScopedT } from "../../contexts/I18nContext";
import { useHudBarDrag } from "@/hooks/use-hudbar-drag";
import { useMicrophoneDevices } from "@/hooks/use-microphone-devices";
import { useLaunchWindowSystemState } from "@/hooks/use-launch-window-system-state";
import { useLaunchHudInteractionState } from "@/hooks/use-launch-hudInteraction-state";
import { useLaunchWindowActions } from "@/hooks/use-launch-window-actions";
import { useRecordingTimer } from "@/hooks/use-recording-timer";
import { useScreenRecorder } from "@/hooks/use-screen-recorder";
import { useVideoDevices } from "../../hooks/use-video-devices";
import { useWebcamPreviewOverlay } from "@/hooks/use-webcam-preview-overlay";
import { canToggleFloatingWebcamPreview } from "@/components/launch/floating-webcam-preview";
import { WEBCAM_SHAPE_CLASSES } from "@/components/launch/webcam-shape";
import {
  LaunchPopoverCoordinatorProvider,
  useLaunchPopoverCoordinator,
} from "./popovers/LaunchPopoverCoordinator";
import { CountdownPopover } from "./popovers/CountdownPopover";
import { MicPopover } from "./popovers/MicPopover";
import { MorePopover } from "./popovers/MorePopover";
import { ProjectPopover } from "./popovers/ProjectPopover";
import { SourcePopover } from "./popovers/SourcePopover";
import { WebcamPopover } from "./popovers/WebcamPopover";
import { HudInteractionContext } from "@/contexts/launch/HudInteractionContext";
import { MarqueeText } from "@/components/launch/source-selector";

import { Separator } from "@/components/ui/separator";
import { Button } from "../ui/button";
import { RecordingControls } from "@/components/launch/recording-controls";
import { useEffect, useRef } from "react";

import {
  ArrowUp01Icon,
  Cancel01Icon,
  Clock01Icon,
  DragDropHorizontalIcon,
  Mic01Icon,
  MicOff01Icon,
  MinusSignIcon,
  MonitorDotIcon,
  MoreVerticalIcon,
  RotateClockwiseIcon,
  Video01Icon,
  VideoOffIcon,
} from "@/components/icons/generated";
import { cn } from "@/lib/utils";

const SHOW_DEV_UPDATE_PREVIEW = import.meta.env.DEV;

export function LaunchWindow() {
  return (
    <LaunchPopoverCoordinatorProvider>
      <LaunchWindowContent />
    </LaunchPopoverCoordinatorProvider>
  );
}

function LaunchWindowContent() {
  const t = useScopedT("launch");
  const { openId, requestClose, requestOpen } = useLaunchPopoverCoordinator();

  const {
    recording,
    paused,
    finalizing,
    countdownActive,
    toggleRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    microphoneEnabled,
    setMicrophoneEnabled,
    microphoneDeviceId,
    setMicrophoneDeviceId,
    systemAudioEnabled,
    setSystemAudioEnabled,
    webcamEnabled,
    setWebcamEnabled,
    webcamDeviceId,
    setWebcamDeviceId,
    countdownDelay,
    setCountdownDelay,
    preparePermissions,
    recordingAspectRatio,
  } = useScreenRecorder();

  const { elapsed, formatTime } = useRecordingTimer(recording, paused);
  const hudContentRef = useRef<HTMLDivElement>(null);
  const hudBarRef = useRef<HTMLDivElement>(null);

  const {
    selectedSource,
    hasSelectedSource,
    handleSourceSelect,
    openVideoFile,
    syncSelectedSource,
    refreshProjectLibrary,
    projectLibraryEntries,
    openProjectFromLibrary,
  } = useLaunchWindowActions();

  const showWebcamControls = webcamEnabled && !recording;
  const { devices, selectedDeviceId, setSelectedDeviceId } =
    useMicrophoneDevices(
      microphoneEnabled || openId === "mic",
      microphoneDeviceId,
    );
  const {
    devices: videoDevices,
    selectedDeviceId: selectedVideoDeviceId,
    setSelectedDeviceId: setSelectedVideoDeviceId,
  } = useVideoDevices(webcamEnabled || openId === "webcam");

  const {
    hudOverlayMousePassthroughSupported,
    platform,
    appVersion,
    hideHudFromCapture,
    chooseRecordingsDirectory,
    toggleHudCaptureProtection,
  } = useLaunchWindowSystemState(preparePermissions);

  const supportsHudCaptureProtection = platform !== "linux";
  const rectangleAspectRatio =
    recordingAspectRatio && Number.isFinite(recordingAspectRatio)
      ? recordingAspectRatio
      : 16 / 9;

  useEffect(() => {
    if (!selectedDeviceId) {
      return;
    }

    setMicrophoneDeviceId(
      selectedDeviceId === "default" ? undefined : selectedDeviceId,
    );
  }, [selectedDeviceId, setMicrophoneDeviceId]);

  useEffect(() => {
    if (selectedVideoDeviceId && selectedVideoDeviceId !== "default") {
      setWebcamDeviceId(selectedVideoDeviceId);
    }
  }, [selectedVideoDeviceId, setWebcamDeviceId]);

  const {
    showFloatingWebcamPreview,
    setShowFloatingWebcamPreview,
    webcamPreviewShape,
    setWebcamPreviewShape,
    showRecordingWebcamPreview,
    webcamPreviewOffset,
    recordingWebcamPreviewContainerRef,
    isWebcamPreviewDraggingRef,
    webcamPreviewDragStartRef,
    handleWebcamPreviewPointerDown,
    handleWebcamPreviewPointerMove,
    handleWebcamPreviewPointerUp,
    setWebcamPreviewNode,
    setRecordingWebcamPreviewNode,
  } = useWebcamPreviewOverlay({
    webcamEnabled,
    webcamDeviceId,
    showWebcamControls,
    webcamPopoverOpen: openId === "webcam",
    hudOverlayMousePassthroughSupported,
  });

  const {
    recordingHudOffset,
    isHudDragging,
    hudBarTransformRef,
    isHudDraggingRef,
    handleHudBarPointerDown,
    handleHudBarPointerMove,
    handleHudBarPointerUp,
  } = useHudBarDrag({
    hudContentRef,
    hudBarRef,
    recordingWebcamPreviewContainerRef,
  });

  const {
    handleHudMouseEnter,
    handleHudMouseLeave,
    beginInteractiveHudAction,
  } = useLaunchHudInteractionState({
    openId,
    isHudDraggingRef,
    isWebcamPreviewDraggingRef,
    webcamPreviewDragStartRef,
  });

  useEffect(() => {
    let mounted = true;

    void window.electronAPI.getSelectedSource().then((source) => {
      if (mounted) syncSelectedSource(source);
    });

    const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
      if (mounted) syncSelectedSource(source);
    });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [syncSelectedSource]);

  const hudStateTransition = {
    duration: 0.24,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  const recordingControls = (
    <RecordingControls
      paused={paused}
      microphoneEnabled={microphoneEnabled}
      elapsed={elapsed}
      onToggleMicrophone={() => setMicrophoneEnabled(!microphoneEnabled)}
      onPauseResume={paused ? resumeRecording : pauseRecording}
      onStopRecording={toggleRecording}
      onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
      onCancelRecording={cancelRecording}
      formatTime={formatTime}
    />
  );

  const idleControls = (
    <>
      {platform !== "linux" && (
        <>
          <SourcePopover
            selectedSource={selectedSource}
            onSourceSelect={handleSourceSelect}
            onOpen={beginInteractiveHudAction}
            trigger={
              <Button
                variant="outline"
                size="sm"
                className={`no-drag group max-w-45 min-w-0 shrink-0 gap-2 rounded-[10px] border-white/10 bg-white/5 px-3 text-[12px] font-medium text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[background-color,border-color,color] duration-150 hover:border-white/20 hover:bg-white/10 ${openId === "sources" ? "border-white/20 bg-white/10" : ""}`}
                title={selectedSource}
              >
                <MonitorDotIcon size={16} className="shrink-0" />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <MarqueeText text={selectedSource} />
                </div>
                <ArrowUp01Icon
                  size={10}
                  className={`ml-0.5 shrink-0 text-stone-500 transition-transform duration-200 ${
                    openId === "sources" ? "" : "rotate-180"
                  }`}
                />
              </Button>
            }
          />

          <Separator orientation="vertical" className="mx-1.25 h-9 my-auto" />
        </>
      )}

      <MicPopover
        disabled={recording}
        systemAudioEnabled={systemAudioEnabled}
        onToggleSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
        microphoneEnabled={microphoneEnabled}
        onDisableMicrophone={() => setMicrophoneEnabled(false)}
        devices={devices}
        microphoneDeviceId={microphoneDeviceId as string}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={(deviceId) => {
          setMicrophoneEnabled(true);
          setSelectedDeviceId(deviceId);
          setMicrophoneDeviceId(deviceId === "default" ? undefined : deviceId);
        }}
        trigger={
          <Button
            variant="ghost"
            size="icon-lg"
            title={
              microphoneEnabled
                ? t("recording.disableMicrophone")
                : t("recording.enableMicrophone")
            }
            className={microphoneEnabled ? "text-primary" : ""}
          >
            {microphoneEnabled ? (
              <Mic01Icon size={18} />
            ) : (
              <MicOff01Icon size={18} />
            )}
          </Button>
        }
      />

      <WebcamPopover
        disabled={recording}
        webcamEnabled={webcamEnabled}
        onDisableWebcam={() => setWebcamEnabled(false)}
        canToggleFloatingPreview={canToggleFloatingWebcamPreview(
          hudOverlayMousePassthroughSupported,
        )}
        showFloatingWebcamPreview={showFloatingWebcamPreview}
        onToggleFloatingPreview={() =>
          setShowFloatingWebcamPreview((current) => !current)
        }
        showWebcamControls={showWebcamControls}
        setWebcamPreviewNode={setWebcamPreviewNode}
        webcamPreviewShape={webcamPreviewShape}
        rectangleAspectRatio={rectangleAspectRatio}
        onWebcamPreviewShapeChange={setWebcamPreviewShape}
        videoDevices={videoDevices}
        webcamDeviceId={webcamDeviceId as string}
        selectedVideoDeviceId={selectedVideoDeviceId}
        onSelectVideoDevice={(deviceId) => {
          setWebcamEnabled(true);
          setSelectedVideoDeviceId(deviceId);
          setWebcamDeviceId(deviceId);
        }}
        trigger={
          <Button
            variant="ghost"
            size="icon-lg"
            title={
              webcamEnabled
                ? t("recording.disableWebcam")
                : t("recording.enableWebcam")
            }
            className={webcamEnabled ? "text-primary" : ""}
          >
            {webcamEnabled ? (
              <Video01Icon size={18} />
            ) : (
              <VideoOffIcon size={18} />
            )}
          </Button>
        }
      />

      <CountdownPopover
        countdownDelay={countdownDelay}
        onSelectDelay={setCountdownDelay}
        trigger={
          <Button
            variant="ghost"
            size="icon-lg"
            title={t("recording.countdownDelay")}
            className={countdownDelay > 0 ? "text-primary" : ""}
          >
            <Clock01Icon size={18} />
          </Button>
        }
      />

      <button
        type="button"
        className={cn(
          "no-drag relative size-9 rounded-full bg-[#b7332f] text-white cursor-pointer",
          "inline-flex items-center justify-center shrink-0 transition-[background-color,box-shadow,transform] duration-150",
          "shadow-[0_8px_18px_rgba(112,45,10,0.24),inset_0_1px_0_rgba(255,255,255,0.24)]",
          "hover:bg-[#a52d2a] hover:shadow-[0_10px_24px_rgba(112,45,10,0.32),inset_0_1px_0_rgba(255,255,255,0.2)] active:scale-[0.98] disabled:bg-stone-400 disabled:cursor-not-allowed disabled:shadow-none",
          countdownActive ? "animate-pulse" : "",
        )}
        onClick={
          hasSelectedSource || platform === "linux"
            ? toggleRecording
            : () => {
                beginInteractiveHudAction();
                requestOpen("sources");
              }
        }
        disabled={countdownActive}
        title={t("recording.record")}
      >
        <div
          className={cn("size-3 rounded-full bg-white transition-all ease-in")}
        />
      </button>

      <Separator orientation="vertical" className="mx-1.25 h-9 my-auto" />

      <div className="relative h-0 w-0">
        <ProjectPopover
          entries={projectLibraryEntries}
          onOpenProject={openProjectFromLibrary}
          trigger={
            <div className="pointer-events-none absolute inset-0 opacity-0" />
          }
        />
      </div>

      <MorePopover
        supportsHudCaptureProtection={supportsHudCaptureProtection}
        hideHudFromCapture={hideHudFromCapture}
        onToggleHudCaptureProtection={() => {
          void toggleHudCaptureProtection();
        }}
        onChooseRecordingsDirectory={() => {
          void chooseRecordingsDirectory();
        }}
        onOpenVideoFile={() => {
          void openVideoFile();
        }}
        onOpenProjectBrowser={() => {
          refreshProjectLibrary().then(() => {
            requestOpen("projects");
          });
        }}
        showDevUpdatePreview={SHOW_DEV_UPDATE_PREVIEW}
        onPreviewUpdateUi={() => {
          if (openId) requestClose(openId);
          void window.electronAPI.previewUpdateToast().catch((error) => {
            console.warn("Failed to preview update toast:", error);
          });
        }}
        appVersion={appVersion}
        trigger={
          <Button variant="ghost" size="icon-lg" title={t("recording.more")}>
            <MoreVerticalIcon size={18} />
          </Button>
        }
      />

      <Button
        variant="ghost"
        size="icon-lg"
        onClick={() => window.electronAPI?.hudOverlayHide?.()}
        title={t("recording.hideHud")}
      >
        <MinusSignIcon size={16} />
      </Button>

      <Button
        variant="ghost"
        size="icon-lg"
        onClick={() => window.electronAPI?.hudOverlayClose?.()}
        title={t("recording.closeApp")}
      >
        <Cancel01Icon size={16} />
      </Button>
    </>
  );

  const finalizingControls = (
    <div className={"flex items-center gap-3"}>
      <RotateClockwiseIcon size={15} className={"animate-spin"} />
      <div className={"flex flex-col leading-tight"}>
        <span>{t("recording.preparing", "Preparing recording")}</span>
        <small>
          {t("recording.preparingSubtitle", "Opening the editor in a moment")}
        </small>
      </div>
    </div>
  );

  const hudMode = finalizing ? "finalizing" : recording ? "recording" : "idle";

  return (
    <HudInteractionContext.Provider
      value={{
        onMouseEnter: handleHudMouseEnter,
        onMouseLeave: handleHudMouseLeave,
      }}
    >
      <div
        className="pointer-events-none flex w-full font-sans! items-end justify-center overflow-visible bg-transparent pb-5"
        style={{ height: "100vh" }}
      >
        <div
          ref={hudContentRef}
          className="pointer-events-none flex flex-col-reverse items-center overflow-visible"
        >
          <div
            className="pointer-events-auto flex flex-col items-center p-2"
            onMouseEnter={handleHudMouseEnter}
            onMouseLeave={handleHudMouseLeave}
          >
            <div
              ref={hudBarTransformRef}
              style={{
                transform: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
              }}
            >
              <motion.div
                ref={hudBarRef}
                layout={!showRecordingWebcamPreview && !isHudDragging}
                transition={hudStateTransition}
                className={`mb-2 flex gap-2.5 items-center rounded-[24px] max-w-300 border border-white/10 bg-[#171411]/90 px-4 py-3 text-stone-50 shadow-[0_22px_70px_rgba(13,12,10,0.36),0_8px_22px_rgba(13,12,10,0.24),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl backdrop-saturate-125 origin-[center_bottom]! relative! overflow-visible w-max! dark:border-white/10 dark:bg-[#171411]/90`}
              >
                <div
                  // On Linux (especially Wayland) the compositor owns window
                  // placement, so BrowserWindow.setBounds() is silently ignored.
                  // Fall back to a native OS drag via -webkit-app-region on the
                  // handle.  We still need JS pointer handlers in webcam-preview
                  // mode (which translates via CSS inside the window), so only
                  // mark the handle as a native drag region for the IPC path.
                  className={`flex cursor-grab items-center px-0.5 active:cursor-grabbing ${
                    platform === "linux" && !showRecordingWebcamPreview
                      ? "drag!"
                      : ""
                  }`}
                  onPointerDown={handleHudBarPointerDown}
                  onPointerMove={handleHudBarPointerMove}
                  onPointerUp={handleHudBarPointerUp}
                  onPointerCancel={handleHudBarPointerUp}
                >
                  <DragDropHorizontalIcon
                    size={16}
                    className="text-stone-500"
                  />
                </div>

                <div
                  className={
                    "relative flex items-center grow-0 shrink basis-auto min-h-11.5 min-w-fit pr-0.5"
                  }
                >
                  <AnimatePresence initial={false} mode="wait">
                    <motion.div
                      key={hudMode}
                      layout={!showRecordingWebcamPreview && !isHudDragging}
                      className={
                        "flex items-center gap-2 grow-0 shrink-0 rounded-full p-2 transition-opacity duration-150"
                      }
                      initial={{
                        opacity: 0,
                        y: 10,
                        scale: 0.985,
                        filter: "blur(8px)",
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        scale: 1,
                        filter: "blur(0px)",
                      }}
                      exit={{
                        opacity: 0,
                        y: -10,
                        scale: 0.985,
                        filter: "blur(6px)",
                      }}
                      transition={hudStateTransition}
                    >
                      {finalizing
                        ? finalizingControls
                        : recording
                          ? recordingControls
                          : idleControls}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
            {showRecordingWebcamPreview && (
              <div
                ref={recordingWebcamPreviewContainerRef}
                className={`no-drag fixed right-8 bottom-30 overflow-hidden bg-[#171411] border border-white/10 shadow-[0_18px_54px_rgba(13,12,10,0.36),inset_0_1px_0_rgba(255,255,255,0.08)] cursor-grab touch-none select-none will-change-transform z-120 active:cursor-grabbing pointer-events-auto ${
                  WEBCAM_SHAPE_CLASSES[webcamPreviewShape].floating
                }`}
                title={t("recording.webcam")}
                style={{
                  transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
                  ...(webcamPreviewShape === "rectangle"
                    ? { aspectRatio: rectangleAspectRatio }
                    : null),
                }}
                onMouseEnter={handleHudMouseEnter}
                onMouseLeave={handleHudMouseLeave}
                onPointerDown={handleWebcamPreviewPointerDown}
                onPointerMove={handleWebcamPreviewPointerMove}
                onPointerUp={handleWebcamPreviewPointerUp}
                onPointerCancel={handleWebcamPreviewPointerUp}
              >
                <video
                  ref={setRecordingWebcamPreviewNode}
                  className={
                    "block size-full object-cover border border-inherit overflow-hidden rounded-[inherit] translate-z-0"
                  }
                  muted
                  playsInline
                  style={{ transform: "scaleX(-1)" }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </HudInteractionContext.Provider>
  );
}
