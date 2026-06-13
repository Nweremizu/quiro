import { Application, Graphics, Sprite } from "pixi.js";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { CropRegion, Padding } from "@/types/editor";
import {
  SIDE_BY_SIDE_GAP_FRACTION,
  SIDE_BY_SIDE_WEBCAM_ASPECT,
} from "@/components/editor/utils/webcam-overlay";

export const PADDING_SCALE_FACTOR = 0.2;

/** Rect (in stage pixels) reserved for the webcam in side-by-side layout. */
export interface WebcamPanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Configuration for reflowing the screen video beside a webcam column. */
export interface SideBySideLayout {
  /** Which edge the webcam column is pinned to. */
  side: "left" | "right";
}

export function isZeroPadding(padding: Padding | number): boolean {
  if (typeof padding === "number") {
    return padding === 0;
  }
  return (
    padding.top === 0 &&
    padding.bottom === 0 &&
    padding.left === 0 &&
    padding.right === 0
  );
}

export interface PaddedLayoutResult {
  scale: number;
  centerOffsetX: number;
  centerOffsetY: number;
  spriteX: number;
  spriteY: number;
  fullFrameDisplayW: number;
  fullFrameDisplayH: number;
  fullVideoDisplayWidth: number;
  fullVideoDisplayHeight: number;
  croppedDisplayWidth: number;
  croppedDisplayHeight: number;
  cropStartX: number;
  cropStartY: number;
  /** Rect reserved for the webcam when laying out side-by-side, else null. */
  webcamPanel: WebcamPanelRect | null;
}

export function computePaddedLayout(params: {
  width: number;
  height: number;
  padding: Padding | number;
  frameInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null;
  cropRegion: CropRegion;
  videoWidth: number;
  videoHeight: number;
  sideBySide?: SideBySideLayout | null;
}): PaddedLayoutResult {
  const {
    width,
    height,
    padding,
    frameInsets,
    cropRegion,
    videoWidth,
    videoHeight,
    sideBySide,
  } = params;

  // Apply asymmetrical padding
  const p =
    typeof padding === "number"
      ? { top: padding, bottom: padding, left: padding, right: padding }
      : padding;

  // Padding is a percentage (0-100)
  // Clamp to ensure we don't have overlapping padding that exceeds 100% of a dimension
  const clampPercent = (v: number) => Math.min(100, Math.max(0, v));
  const leftPadFrac = (clampPercent(p.left) / 100) * PADDING_SCALE_FACTOR;
  const rightPadFrac = (clampPercent(p.right) / 100) * PADDING_SCALE_FACTOR;
  const topPadFrac = (clampPercent(p.top) / 100) * PADDING_SCALE_FACTOR;
  const bottomPadFrac = (clampPercent(p.bottom) / 100) * PADDING_SCALE_FACTOR;

  const availableFracW = Math.max(0, 1.0 - leftPadFrac - rightPadFrac);
  const availableFracH = Math.max(0, 1.0 - topPadFrac - bottomPadFrac);

  const contentLeft = leftPadFrac * width;
  const contentTop = topPadFrac * height;
  const maxDisplayWidth = width * availableFracW;
  const maxDisplayHeight = height * availableFracH;

  const crop = cropRegion;
  const croppedVideoWidth = videoWidth * crop.width;
  const croppedVideoHeight = videoHeight * crop.height;

  const insets = frameInsets;
  const screenFracW = insets ? 1 - insets.left - insets.right : 1;
  const screenFracH = insets ? 1 - insets.top - insets.bottom : 1;

  const fullFrameVideoW = croppedVideoWidth / screenFracW;
  const fullFrameVideoH = croppedVideoHeight / screenFracH;

  // Resolve the video scale and the point the full frame is centered on. In
  // side-by-side layout the video and webcam are sized to the SAME height and
  // centered together as a pair: the video fills its rounded box at its natural
  // aspect (no letterboxing) and the webcam sits beside it as an equal-height
  // portrait panel. Otherwise the frame is contained within the padded area.
  let scale: number;
  let availableCenterX: number;
  let availableCenterY: number;
  let webcamPanel: WebcamPanelRect | null = null;
  if (sideBySide) {
    const fullFrameAspect =
      fullFrameVideoH > 0 ? fullFrameVideoW / fullFrameVideoH : 1;
    const gapWidth = maxDisplayWidth * SIDE_BY_SIDE_GAP_FRACTION;
    // Largest height at which video + gap + webcam fit across the width while
    // also fitting within the available height.
    const sharedHeight = Math.max(
      0,
      Math.min(
        maxDisplayHeight,
        (maxDisplayWidth - gapWidth) /
          (fullFrameAspect + SIDE_BY_SIDE_WEBCAM_ASPECT),
      ),
    );
    scale = fullFrameVideoH > 0 ? sharedHeight / fullFrameVideoH : 0;
    const videoDisplayWidth = fullFrameVideoW * scale;
    const webcamWidth = sharedHeight * SIDE_BY_SIDE_WEBCAM_ASPECT;
    const pairWidth = videoDisplayWidth + gapWidth + webcamWidth;
    const pairLeft =
      contentLeft + Math.max(0, (maxDisplayWidth - pairWidth) / 2);
    const pairTop =
      contentTop + Math.max(0, (maxDisplayHeight - sharedHeight) / 2);
    const videoLeft =
      sideBySide.side === "left" ? pairLeft + webcamWidth + gapWidth : pairLeft;
    const webcamLeft =
      sideBySide.side === "left"
        ? pairLeft
        : pairLeft + videoDisplayWidth + gapWidth;
    availableCenterX = videoLeft + videoDisplayWidth / 2;
    availableCenterY = pairTop + sharedHeight / 2;
    webcamPanel = {
      x: webcamLeft,
      y: pairTop,
      width: webcamWidth,
      height: sharedHeight,
    };
  } else {
    scale = Math.min(
      fullFrameVideoW > 0 ? maxDisplayWidth / fullFrameVideoW : 0,
      fullFrameVideoH > 0 ? maxDisplayHeight / fullFrameVideoH : 0,
    );
    availableCenterX = contentLeft + maxDisplayWidth / 2;
    availableCenterY = contentTop + maxDisplayHeight / 2;
  }

  const fullVideoDisplayWidth = videoWidth * scale;
  const fullVideoDisplayHeight = videoHeight * scale;
  const croppedDisplayWidth = croppedVideoWidth * scale;
  const croppedDisplayHeight = croppedVideoHeight * scale;

  const fullFrameDisplayW = fullFrameVideoW * scale;
  const fullFrameDisplayH = fullFrameVideoH * scale;

  const frameCenterX = availableCenterX - fullFrameDisplayW / 2;
  const frameCenterY = availableCenterY - fullFrameDisplayH / 2;

  const centerOffsetX = insets
    ? frameCenterX + insets.left * fullFrameDisplayW
    : frameCenterX;
  const centerOffsetY = insets
    ? frameCenterY + insets.top * fullFrameDisplayH
    : frameCenterY;

  const spriteX = centerOffsetX - crop.x * fullVideoDisplayWidth;
  const spriteY = centerOffsetY - crop.y * fullVideoDisplayHeight;

  return {
    scale,
    centerOffsetX,
    centerOffsetY,
    spriteX,
    spriteY,
    fullFrameDisplayW,
    fullFrameDisplayH,
    fullVideoDisplayWidth,
    fullVideoDisplayHeight,
    croppedDisplayWidth,
    croppedDisplayHeight,
    cropStartX: crop.x * videoWidth,
    cropStartY: crop.y * videoHeight,
    webcamPanel,
  };
}

interface LayoutParams {
  container: HTMLDivElement;
  app: Application;
  videoSprite: Sprite;
  maskGraphics: Graphics;
  videoElement: HTMLVideoElement;
  cropRegion?: CropRegion;
  lockedVideoDimensions?: { width: number; height: number } | null;
  borderRadius?: number;
  padding?: Padding | number;
  /** Screen insets from the active device frame, used to scale/center the full frame */
  frameInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null;
  sideBySide?: SideBySideLayout | null;
}

interface LayoutResult {
  stageSize: { width: number; height: number };
  videoSize: { width: number; height: number };
  baseScale: number;
  baseOffset: { x: number; y: number };
  maskRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceCrop?: CropRegion;
  };
  cropBounds: { startX: number; endX: number; startY: number; endY: number };
  webcamPanel: WebcamPanelRect | null;
}

export function layoutVideoContent(params: LayoutParams): LayoutResult | null {
  const {
    container,
    app,
    videoSprite,
    maskGraphics,
    videoElement,
    cropRegion,
    lockedVideoDimensions,
    borderRadius = 0,
    padding = 0,
    frameInsets,
    sideBySide,
  } = params;

  const videoWidth = lockedVideoDimensions?.width || videoElement.videoWidth;
  const videoHeight = lockedVideoDimensions?.height || videoElement.videoHeight;

  if (!videoWidth || !videoHeight) {
    return null;
  }

  const width = container.clientWidth;
  const height = container.clientHeight;

  if (!width || !height) {
    return null;
  }

  app.renderer.resize(width, height);
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";

  const crop = cropRegion || { x: 0, y: 0, width: 1, height: 1 };
  const layout = computePaddedLayout({
    width,
    height,
    padding,
    frameInsets,
    cropRegion: crop,
    videoWidth,
    videoHeight,
    sideBySide,
  });

  videoSprite.scale.set(layout.scale);
  videoSprite.position.set(layout.spriteX, layout.spriteY);

  maskGraphics.clear();
  drawSquircleOnGraphics(maskGraphics, {
    x: layout.centerOffsetX,
    y: layout.centerOffsetY,
    width: layout.croppedDisplayWidth,
    height: layout.croppedDisplayHeight,
    radius: borderRadius,
  });
  maskGraphics.fill({ color: 0xffffff });

  return {
    stageSize: { width, height },
    videoSize: {
      width: videoWidth * crop.width,
      height: videoHeight * crop.height,
    },
    baseScale: layout.scale,
    baseOffset: { x: layout.spriteX, y: layout.spriteY },
    maskRect: {
      x: layout.centerOffsetX,
      y: layout.centerOffsetY,
      width: layout.croppedDisplayWidth,
      height: layout.croppedDisplayHeight,
      sourceCrop: crop,
    },
    cropBounds: {
      startX: layout.cropStartX,
      endX: layout.cropStartX + videoWidth * crop.width,
      startY: layout.cropStartY,
      endY: layout.cropStartY + videoHeight * crop.height,
    },
    webcamPanel: layout.webcamPanel,
  };
}
