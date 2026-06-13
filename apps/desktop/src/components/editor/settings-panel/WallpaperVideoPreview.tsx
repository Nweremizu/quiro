export function WallpaperVideoPreview({ src }: { src: string }) {
  return (
    <video
      src={src}
      autoPlay
      loop
      muted
      playsInline
      className="h-full w-full object-cover"
    />
  );
}
