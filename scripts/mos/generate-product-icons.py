#!/usr/bin/env python3
"""Generate the MOS 4.0 product icon set from a single deterministic design.

The mark matches packages/ui/src/assets/mos-app-logo.svg: a rounded-square tile
with an indigo→cyan diagonal gradient and a white geometric M.

Outputs (overwrites in place):
  public/logo/icons/{16x16,24x24,32x32,48x48,64x64,128x128,256x256,512x512,1024x1024}.png
  public/logo/icons/icon.ico
  packages/desktop/build/icon.png            (1024)
  packages/desktop/build/icon_windows.png    (1024)
  packages/desktop/build/icon_installer.png  (1024)
  packages/desktop/build/icons/{...}.png     (same size set)
  packages/desktop/build/icon.ico
  packages/web/favicon-data-uri.txt          (32px base64, for index.html favicon)

Run from the repository root: python3 scripts/mos/generate-product-icons.py
"""

from __future__ import annotations

import base64
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]

# Design constants (shared with packages/ui/src/assets/mos-app-logo.svg).
GRADIENT_START = (79, 70, 229)  # #4F46E5 indigo
GRADIENT_END = (6, 182, 212)  # #06B6D4 cyan
TILE_RADIUS_RATIO = 14 / 64
# M mark in a 256x218 box (same path as the SVG components).
M_POLYGON = [
    (30, 18),
    (226, 18),
    (226, 218),
    (186, 218),
    (186, 92),
    (146, 168),
    (110, 168),
    (70, 92),
    (70, 218),
    (30, 218),
]
MARK_WIDTH_RATIO = 216 / 256  # horizontal extent of the mark inside its box
MARK_HEIGHT_RATIO = 200 / 218

SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICON_SIZES = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]


def build_master(size: int) -> Image.Image:
    """Rounded-square gradient tile with the white M mark, at any size."""
    # Diagonal gradient via bicubic upscale of a 2x2 corner scaffold.
    scaffold = Image.new("RGB", (2, 2))
    scaffold.putpixel((0, 0), GRADIENT_START)
    scaffold.putpixel((1, 0), _mix(GRADIENT_START, GRADIENT_END, 0.5))
    scaffold.putpixel((0, 1), _mix(GRADIENT_START, GRADIENT_END, 0.5))
    scaffold.putpixel((1, 1), GRADIENT_END)
    gradient = scaffold.resize((size, size), Image.BICUBIC)

    radius = round(size * TILE_RADIUS_RATIO)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile.paste(gradient, (0, 0), mask)

    # Center the M mark, scaled to ~66% of the tile width.
    target_w = round(size * 0.66)
    target_h = round(target_w * (MARK_HEIGHT_RATIO / MARK_WIDTH_RATIO))
    if target_h > size * 0.72:  # keep the mark inside the tile with margin
        target_h = round(size * 0.72)
        target_w = round(target_h * (MARK_WIDTH_RATIO / MARK_HEIGHT_RATIO))
    scale = target_w / 256
    offset_x = (size - target_w) // 2
    offset_y = (size - round(218 * scale)) // 2
    mark = [(offset_x + round(x * scale), offset_y + round(y * scale)) for x, y in M_POLYGON]
    ImageDraw.Draw(tile).polygon(mark, fill=(255, 255, 255, 255))
    return tile


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def main() -> None:
    master = build_master(1024)

    public_icons = ROOT / "public" / "logo" / "icons"
    build_dir = ROOT / "packages" / "desktop" / "build"
    build_icons = build_dir / "icons"
    for directory in (public_icons, build_icons):
        directory.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        img = master.resize((size, size), Image.LANCZOS)
        for directory in (public_icons, build_icons):
            img.save(directory / f"{size}x{size}.png")

    master.save(public_icons / "icon.ico", sizes=ICON_SIZES)
    master.save(build_dir / "icon.ico", sizes=ICON_SIZES)
    master.save(build_dir / "icon.png")
    master.save(build_dir / "icon_windows.png")
    master.save(build_dir / "icon_installer.png")

    # 32px favicon payload, patched straight into packages/web/index.html.
    import io
    import re

    favicon = master.resize((32, 32), Image.LANCZOS)
    buffer = io.BytesIO()
    favicon.save(buffer, "PNG")
    data_uri = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    index_html = ROOT / "packages" / "web" / "index.html"
    html = index_html.read_text(encoding="utf-8")
    patched, count = re.subn(
        r'href="data:image/png;base64,[^"]+',
        'href="' + data_uri,
        html,
        count=1,
    )
    if count != 1:
        raise SystemExit("favicon data URI not found in packages/web/index.html")
    index_html.write_text(patched, encoding="utf-8")

    print("wrote icon sets to public/logo/icons and packages/desktop/build")
    print("patched favicon in packages/web/index.html")


if __name__ == "__main__":
    main()
