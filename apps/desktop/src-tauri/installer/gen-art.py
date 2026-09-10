"""Regenerate the NSIS installer bitmaps from the brand marks.

    python apps/desktop/src-tauri/installer/gen-art.py     (needs Pillow)

NSIS/MUI2 takes plain BMPs at fixed sizes and nothing else:

  sidebar.bmp   164x314   welcome and finish pages
  header.bmp    150x57    strip on every interior page, drawn right-aligned

Both must be opaque. The bitmaps are blitted rather than composited, so an
alpha channel renders as garbage instead of transparency - hence the explicit
flatten onto a background colour here. Sizes are fixed by MUI2; anything else
is stretched or clipped.

Sources are the colour-locked marks in src/assets/brand/png, so this stays in
step with the app icon rather than drifting into a second look.
"""

from pathlib import Path

from PIL import Image

BRAND_ORANGE = (0xF3, 0x80, 0x20)  # --accent-400, the exact brand orange
HEADER_BG = (0xFF, 0xFF, 0xFF)  # MUI draws the header strip on white

HERE = Path(__file__).resolve().parent
SRC = HERE.parents[1] / "src" / "assets" / "brand" / "png"


def fit(mark: Image.Image, box: tuple[int, int]) -> Image.Image:
    """Scale `mark` to fit inside `box`, trimmed to its ink first."""
    trimmed = mark.crop(mark.getbbox())
    scale = min(box[0] / trimmed.width, box[1] / trimmed.height)
    return trimmed.resize(
        (max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale))),
        Image.LANCZOS,
    )


def compose(size, bg, mark_name, mark_box, centre) -> Image.Image:
    canvas = Image.new("RGB", size, bg)
    mark = fit(Image.open(SRC / mark_name).convert("RGBA"), mark_box)
    # Passing `mark` as its own mask flattens the alpha onto `bg`.
    canvas.paste(mark, (centre[0] - mark.width // 2, centre[1] - mark.height // 2), mark)
    return canvas


# The app-icon look users already know: white mark on brand orange. MUI puts
# the welcome text beside this strip rather than over it, so all 314px are
# visible — the mark sits a touch above centre, which reads as deliberate where
# dead centre reads as untouched default.
compose((164, 314), BRAND_ORANGE, "logo-mark-white-512.png", (104, 104), (82, 138)).save(
    HERE / "sidebar.bmp", "BMP"
)

# Orange mark on white. MUI right-aligns this strip and draws the page title to
# its left, so the mark sits right with room off the edge.
compose((150, 57), HEADER_BG, "logo-mark-orange-512.png", (38, 38), (124, 28)).save(
    HERE / "header.bmp", "BMP"
)

for name in ("sidebar.bmp", "header.bmp"):
    out = HERE / name
    with Image.open(out) as im:
        print(f"{name:14} {im.size} {im.mode} {out.stat().st_size / 1024:.1f} KB")
