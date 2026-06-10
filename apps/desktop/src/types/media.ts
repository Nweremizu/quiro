export const MEDIA_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function getExtension(filePath: string): string {
  const cleanPath = filePath.split(/[?#]/, 1)[0];
  const lastDot = cleanPath.lastIndexOf(".");
  if (lastDot <= 0) {
    return "";
  }
  return cleanPath.slice(lastDot).toLowerCase();
}

export function getMediaContentType(filePath: string): string {
  return (
    MEDIA_CONTENT_TYPES[getExtension(filePath)] ?? "application/octet-stream"
  );
}

export function isSupportedLocalMediaPath(filePath: string): boolean {
  return getExtension(filePath) in MEDIA_CONTENT_TYPES;
}
