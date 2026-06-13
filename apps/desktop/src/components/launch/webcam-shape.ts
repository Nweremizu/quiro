export type WebcamPreviewShape =
  | "rounded-square"
  | "square"
  | "rectangle"
  | "circle";

export function isWebcamPreviewShape(
  value: string,
): value is WebcamPreviewShape {
  return (
    value === "rounded-square" ||
    value === "square" ||
    value === "rectangle" ||
    value === "circle"
  );
}

export const WEBCAM_PREVIEW_SHAPES: Array<{
  value: WebcamPreviewShape;
  label: string;
}> = [
  { value: "rounded-square", label: "Rounded square" },
  { value: "square", label: "Square" },
  { value: "rectangle", label: "Rectangle" },
  { value: "circle", label: "Circle" },
];

export const WEBCAM_SHAPE_CLASSES: Record<
  WebcamPreviewShape,
  { preview: string; floating: string }
> = {
  "rounded-square": {
    preview: "size-24 rounded-2xl",
    floating: "size-72 rounded-2xl",
  },
  square: {
    preview: "size-24 rounded-md",
    floating: "size-72 rounded-md",
  },
  rectangle: {
    preview: "w-32 rounded-xl",
    floating: "w-96 rounded-2xl",
  },
  circle: {
    preview: "size-24 rounded-full",
    floating: "size-72 rounded-full",
  },
};
