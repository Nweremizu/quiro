import { describe, expect, it } from "vitest";
import type { AnnotationRegion } from "@/types/editor";
import {
  getAnnotationAnimationDurationMs,
  resolveAnnotationAtTime,
} from "./annotation-keyframes";

function annotation(
  patch: Partial<AnnotationRegion> = {},
): AnnotationRegion {
  return {
    id: "annotation-1",
    startMs: 1000,
    endMs: 3000,
    type: "text",
    content: "Hello",
    position: { x: 50, y: 50 },
    size: { width: 30, height: 20 },
    style: {
      color: "#ffffff",
      backgroundColor: "transparent",
      fontSize: 32,
      fontFamily: "system-ui",
      fontWeight: "bold",
      fontStyle: "normal",
      textDecoration: "none",
      textAlign: "center",
      borderRadius: 8,
    },
    zIndex: 1,
    opacity: 1,
    scale: 1,
    ...patch,
  };
}

describe("annotation animation presets", () => {
  it("clamps custom duration to the annotation visible window", () => {
    const region = annotation({
      startMs: 1000,
      endMs: 1400,
      animation: {
        presetId: "fade",
        durationMs: 2000,
        springStiffness: 320,
        springDamping: 26,
      },
    });

    expect(getAnnotationAnimationDurationMs(region)).toBe(400);
  });

  it("applies fade-in and fade-out without changing the base annotation", () => {
    const region = annotation({
      animation: {
        presetId: "fade",
        durationMs: 500,
        springStiffness: 320,
        springDamping: 26,
      },
    });

    expect(resolveAnnotationAtTime(region, 1000).opacity).toBe(0);
    expect(resolveAnnotationAtTime(region, 1600).opacity).toBe(1);
    expect(resolveAnnotationAtTime(region, 3000).opacity).toBe(0);
    expect(region.opacity).toBe(1);
  });

  it("combines keyframes with preset animation", () => {
    const region = annotation({
      animation: {
        presetId: "rise",
        durationMs: 400,
        springStiffness: 320,
        springDamping: 26,
      },
      keyframes: [
        {
          id: "a",
          timeMs: 1000,
          opacity: 0.5,
          scale: 1,
          position: { x: 50, y: 50 },
        },
        {
          id: "b",
          timeMs: 3000,
          opacity: 1,
          scale: 2,
          position: { x: 60, y: 60 },
          easing: "linear",
        },
      ],
    });

    const resolved = resolveAnnotationAtTime(region, 2000);

    expect(resolved.opacity).toBeCloseTo(0.75);
    expect(resolved.scale).toBeCloseTo(1.5);
    expect(resolved.position.x).toBeCloseTo(55);
    expect(resolved.position.y).toBeCloseTo(55);
  });
});
