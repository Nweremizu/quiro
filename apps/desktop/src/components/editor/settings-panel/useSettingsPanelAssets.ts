import { useEffect, useMemo, useState } from "react";
import minimalCursorUrl from "@/assets/cursors/custom/minimal-cursor.svg";
import {
  getAssetPath,
  getRenderableAssetUrl,
  getRenderableVideoUrl,
  getWallpaperThumbnailUrl,
} from "@/lib/assetPath";
import { extensionHost } from "@/lib/extensions/extensionHost";
import {
  BUILT_IN_WALLPAPERS,
  type BuiltInWallpaper,
  getAvailableWallpapers,
  isVideoWallpaperSource,
} from "@/lib/wallpapers";
import type { CursorStyle } from "@/types/editor";
import { cursorSetAssets } from "../videoPlayback/uploadedCursorAssets";
import {
  BUILTIN_CURSOR_STYLE_OPTIONS,
  type CursorStyleOption,
  type WallpaperTile,
} from "./constants";
import {
  createInvertedPreview,
  createTrimmedSvgPreview,
} from "./cursorPreview";

export function useSettingsPanelAssets({
  initialCustomWallpapers,
  selected,
  tahoeCursorUrl,
}: {
  initialCustomWallpapers: string[];
  selected: string;
  tahoeCursorUrl: string;
}) {
  const [builtInWallpapers, setBuiltInWallpapers] =
    useState<BuiltInWallpaper[]>(BUILT_IN_WALLPAPERS);
  const [extensionWallpapers, setExtensionWallpapers] = useState<
    ReturnType<typeof extensionHost.getContributedWallpapers>
  >([]);
  const [wallpaperPreviewPaths, setWallpaperPreviewPaths] = useState<string[]>(
    [],
  );
  const [extensionWallpaperPreviewUrls, setExtensionWallpaperPreviewUrls] =
    useState<Record<string, string>>({});
  const [customImages, setCustomImages] = useState<string[]>(
    initialCustomWallpapers,
  );
  const [extensionCursorStyles, setExtensionCursorStyles] = useState<
    ReturnType<typeof extensionHost.getContributedCursorStyles>
  >([]);
  const [builtInCursorPreviewUrls, setBuiltInCursorPreviewUrls] = useState<
    Partial<Record<string, string>>
  >({});
  const [extensionCursorPreviewUrls, setExtensionCursorPreviewUrls] = useState<
    Partial<Record<string, string>>
  >({});

  const builtInWallpaperPaths = useMemo(
    () => builtInWallpapers.map((wallpaper) => wallpaper.publicPath),
    [builtInWallpapers],
  );
  const extensionWallpaperPaths = useMemo(
    () => extensionWallpapers.map((wallpaper) => wallpaper.resolvedUrl),
    [extensionWallpapers],
  );
  const cursorPreviewUrls = useMemo(
    () => ({ ...builtInCursorPreviewUrls, ...extensionCursorPreviewUrls }),
    [builtInCursorPreviewUrls, extensionCursorPreviewUrls],
  );
  const cursorStyleOptions = useMemo<CursorStyleOption[]>(
    () => [
      ...BUILTIN_CURSOR_STYLE_OPTIONS,
      ...extensionCursorStyles.map((cursorStyle) => ({
        value: cursorStyle.id as CursorStyle,
        label: cursorStyle.cursorStyle.label,
      })),
    ],
    [extensionCursorStyles],
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const availableWallpapers = await getAvailableWallpapers();
        const resolved = await Promise.all(
          availableWallpapers.map(async (wallpaper) => {
            const assetUrl = await getAssetPath(wallpaper.relativePath);
            if (isVideoWallpaperSource(wallpaper.publicPath)) {
              return getRenderableVideoUrl(assetUrl);
            }
            return getWallpaperThumbnailUrl(assetUrl);
          }),
        );
        if (mounted) {
          setBuiltInWallpapers(availableWallpapers);
          setWallpaperPreviewPaths(resolved);
        }
      } catch {
        if (mounted) {
          setBuiltInWallpapers(BUILT_IN_WALLPAPERS);
          setWallpaperPreviewPaths(
            BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.publicPath),
          );
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const updateExtensionAssets = async () => {
      const wallpapers = extensionHost.getContributedWallpapers();
      const cursorStyles = extensionHost.getContributedCursorStyles();
      const [wallpaperPreviewEntries, cursorPreviewEntries] = await Promise.all(
        [
          Promise.all(
            wallpapers.map(
              async (wallpaper) =>
                [
                  wallpaper.id,
                  isVideoWallpaperSource(wallpaper.resolvedThumbnailUrl)
                    ? wallpaper.resolvedThumbnailUrl
                    : await getWallpaperThumbnailUrl(
                        wallpaper.resolvedThumbnailUrl,
                      ),
                ] as const,
            ),
          ),
          Promise.all(
            cursorStyles.map(
              async (cursorStyle) =>
                [
                  cursorStyle.id,
                  await getRenderableAssetUrl(cursorStyle.resolvedDefaultUrl),
                ] as const,
            ),
          ),
        ],
      );

      if (cancelled) return;

      setExtensionWallpapers(wallpapers);
      setExtensionWallpaperPreviewUrls(
        Object.fromEntries(wallpaperPreviewEntries),
      );
      setExtensionCursorStyles(cursorStyles);
      setExtensionCursorPreviewUrls(Object.fromEntries(cursorPreviewEntries));
    };

    void extensionHost.autoActivateBuiltins().then(updateExtensionAssets);
    const unsubscribe = extensionHost.onChange(() => {
      void updateExtensionAssets();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const macosPreview = cursorSetAssets.macos.arrow.url;
        const tahoePreview = cursorSetAssets.tahoe.arrow.url;
        const minimalPreview = await createTrimmedSvgPreview(
          minimalCursorUrl,
          512,
        );
        const invertedPreview = await createInvertedPreview(tahoePreview);

        if (!cancelled) {
          setBuiltInCursorPreviewUrls({
            macos: macosPreview,
            tahoe: tahoePreview,
            figma: minimalPreview,
            "tahoe-inverted": invertedPreview,
          });
        }
      } catch {
        if (!cancelled) {
          setBuiltInCursorPreviewUrls({
            macos: tahoeCursorUrl,
            tahoe: tahoeCursorUrl,
            figma: minimalCursorUrl,
            "tahoe-inverted": tahoeCursorUrl,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tahoeCursorUrl]);

  useEffect(() => {
    if (selected.startsWith("data:image") && !customImages.includes(selected)) {
      setCustomImages((prev) => [selected, ...prev]);
    }

    const isKnownWallpaper =
      builtInWallpaperPaths.includes(selected) ||
      wallpaperPreviewPaths.includes(selected) ||
      extensionWallpaperPaths.includes(selected);

    if (
      !isKnownWallpaper &&
      isVideoWallpaperSource(selected) &&
      !customImages.includes(selected)
    ) {
      setCustomImages((prev) => [selected, ...prev]);
    }
  }, [
    builtInWallpaperPaths,
    customImages,
    extensionWallpaperPaths,
    selected,
    wallpaperPreviewPaths,
  ]);

  const imageWallpaperTiles = useMemo<WallpaperTile[]>(() => {
    const imageWallpapers = builtInWallpapers.filter(
      (wallpaper) => !isVideoWallpaperSource(wallpaper.publicPath),
    );
    const builtInTiles = (
      wallpaperPreviewPaths.length > 0
        ? wallpaperPreviewPaths
        : builtInWallpaperPaths
    )
      .filter((path) => !isVideoWallpaperSource(path))
      .map((previewPath, index) => {
        const wallpaper = imageWallpapers[index];
        return {
          key: wallpaper ? `builtin/${wallpaper.id}` : previewPath,
          label: wallpaper?.label ?? `Wallpaper ${index + 1}`,
          value: wallpaper?.publicPath ?? previewPath,
          previewUrl: previewPath,
        };
      });

    const extensionTiles = extensionWallpapers
      .filter((wallpaper) => !isVideoWallpaperSource(wallpaper.resolvedUrl))
      .map((wallpaper) => ({
        key: wallpaper.id,
        label: wallpaper.wallpaper.label,
        value: wallpaper.resolvedUrl,
        previewUrl:
          extensionWallpaperPreviewUrls[wallpaper.id] ??
          wallpaper.resolvedThumbnailUrl,
      }));

    return [...builtInTiles, ...extensionTiles];
  }, [
    builtInWallpaperPaths,
    builtInWallpapers,
    extensionWallpaperPreviewUrls,
    extensionWallpapers,
    wallpaperPreviewPaths,
  ]);

  const videoWallpaperTiles = useMemo<WallpaperTile[]>(() => {
    const builtInTiles = builtInWallpapers
      .filter((wallpaper) => isVideoWallpaperSource(wallpaper.publicPath))
      .map((wallpaper) => ({
        key: `builtin/${wallpaper.id}`,
        label: wallpaper.label,
        value: wallpaper.publicPath,
        previewUrl: wallpaper.publicPath,
      }));

    const extensionTiles = extensionWallpapers
      .filter((wallpaper) => isVideoWallpaperSource(wallpaper.resolvedUrl))
      .map((wallpaper) => ({
        key: wallpaper.id,
        label: wallpaper.wallpaper.label,
        value: wallpaper.resolvedUrl,
        previewUrl:
          extensionWallpaperPreviewUrls[wallpaper.id] ??
          wallpaper.resolvedThumbnailUrl,
      }));

    return [...builtInTiles, ...extensionTiles];
  }, [builtInWallpapers, extensionWallpaperPreviewUrls, extensionWallpapers]);

  return {
    builtInWallpaperPaths,
    cursorPreviewUrls,
    cursorStyleOptions,
    customImages,
    extensionWallpaperPaths,
    imageWallpaperTiles,
    setCustomImages,
    videoWallpaperTiles,
    wallpaperPreviewPaths,
  };
}
