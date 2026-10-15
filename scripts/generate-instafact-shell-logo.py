"""Generate the main-window (sidebar) InstaFact logo assets from the 2026 artwork.

Reads (never overwrites):
  art/branding/instafact-logo-2026-source.webp  (2000x754, sRGB, opaque blue background)

Writes:
  src/Frontend/factutrust-web/src/assets/branding/instafact-shell-lockup.webp
      transparent lockup, black "Insta" as designed, for the theme blue (#3862F5)
  src/Frontend/factutrust-web/src/assets/branding/instafact-shell-lockup-on-navy.webp
      same geometry, "Insta" turned white, for the delegated-firm navy (#0A1F44)
  src/Frontend/factutrust-web/src/assets/branding/instafact-shell-icon.webp
      badge only (collapsed rail), 256x256, transparent

Usage:
  python scripts/generate-instafact-shell-logo.py [--sheet DIR]

--sheet writes a contact sheet (theme blue, hover, navy; 92 px and 48 px brand zones;
DPR 1 and 2) to DIR for visual review. It is not a deliverable: keep it out of the repo.

Requires Pillow and numpy (dev-time only, not used by the build).
"""
from __future__ import annotations

import argparse
import io
import os
import sys

import numpy as np
from PIL import Image, ImageCms, ImageDraw

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = os.path.join(REPO_ROOT, "art", "branding", "instafact-logo-2026-source.webp")
BRANDING = os.path.join(
    REPO_ROOT, "src", "Frontend", "factutrust-web", "src", "assets", "branding"
)
LOCKUP_DST = os.path.join(BRANDING, "instafact-shell-lockup.webp")
LOCKUP_NAVY_DST = os.path.join(BRANDING, "instafact-shell-lockup-on-navy.webp")
ICON_DST = os.path.join(BRANDING, "instafact-shell-icon.webp")

SOURCE_SIZE = (2000, 754)
# The lockup is displayed at most 208 CSS px wide; 4x keeps it sharp up to DPR 4 (HiDPI, zoom)
# while staying under MAX_BYTES (5x with a lossless alpha weighs ~96 KB).
LOCKUP_WIDTH = 832
ICON_SIZE = 256
CROP_PAD = 10  # source px kept around the artwork so the glow and shadows are not clipped
ICON_PAD = 8
# Colour-to-alpha: per-channel difference ignored as noise (the background is a soft gradient
# and the source is lossy WebP), then a final floor on the alpha itself.
CHANNEL_NOISE = 0.035
ALPHA_FLOOR = 0.02
# Colour-to-alpha alone leaves glyph and badge interiors grainy and see-through (only their
# distance to the background explains them). Pixels clearly away from the background ramp to
# full opacity, and near-opaque values snap to 1, as in the artwork.
SOLID_FROM, SOLID_TO = 0.20, 0.45  # L1 distance to the fitted background (0..3)
ALPHA_SNAP = 0.03
BG_MATCH = 0.06  # L1 distance to the median colour for a pixel to count as background
MAX_BYTES = 60 * 1024
RATIO_RANGE = (4.0, 4.7)

THEME_BLUE = (0x38, 0x62, 0xF5)  # --superieur-primary
HOVER_BLUE = (0x50, 0x75, 0xF6)  # theme blue + rgba(255,255,255,.12)
DELEGATED_NAVY = (0x0A, 0x1F, 0x44)  # --sidebar-delegated-navy


def _load_source() -> np.ndarray:
    if not os.path.isfile(SOURCE):
        raise SystemExit(f"missing source: {SOURCE}")
    with open(SOURCE, "rb") as fh:
        head = fh.read(12)
    if head[:4] != b"RIFF" or head[8:12] != b"WEBP":
        raise SystemExit("source is not a WebP file")
    im = Image.open(SOURCE)
    im.load()
    if im.size != SOURCE_SIZE:
        raise SystemExit(f"unexpected source size: {im.size}")
    icc = im.info.get("icc_profile")
    if icc:
        desc = ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip()
        if desc != "sRGB":
            # Outputs carry no profile (browsers assume sRGB): another profile would shift colours.
            raise SystemExit(f"source profile is not sRGB: {desc}")
    return np.asarray(im.convert("RGB")).astype(np.float64) / 255.0


def _fit_background(a: np.ndarray) -> np.ndarray:
    """Quadratic surface per channel fitted on background-coloured pixels (soft gradient)."""
    h, w, _ = a.shape
    med = np.median(a.reshape(-1, 3), axis=0)
    ys, xs = np.nonzero(np.abs(a - med).sum(axis=2) < BG_MATCH)
    rng = np.random.default_rng(0)
    sel = rng.choice(len(ys), size=min(80_000, len(ys)), replace=False)
    ys, xs = ys[sel], xs[sel]

    def feats(x: np.ndarray, y: np.ndarray) -> np.ndarray:
        return np.stack([np.ones_like(x), x, y, x * x, y * y, x * y], axis=-1)

    samples = feats(xs / w, ys / h)
    gy, gx = np.mgrid[0:h, 0:w]
    grid = feats(gx / w, gy / h)
    bg = np.empty_like(a)
    for c in range(3):
        coef = np.linalg.lstsq(samples, a[ys, xs, c], rcond=None)[0]
        bg[..., c] = grid @ coef
    residual = np.abs(a[ys, xs] - bg[ys, xs]).max(axis=1)
    if np.percentile(residual, 99) > CHANNEL_NOISE:
        raise SystemExit(f"background fit too loose: p99={np.percentile(residual, 99):.4f}")
    return bg


def _alpha(a: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Colour-to-alpha (smallest alpha explaining each pixel over the fitted background),
    raised to full opacity where the pixel is clearly not background."""
    alpha = np.zeros(a.shape[:2])
    for c in range(3):
        p, b = a[..., c], bg[..., c]
        reach = np.where(p > b, 1.0 - b, b) - CHANNEL_NOISE
        diff = np.maximum(np.abs(p - b) - CHANNEL_NOISE, 0.0)
        ac = np.where(reach > 1e-3, diff / np.maximum(reach, 1e-3), 0.0)
        alpha = np.maximum(alpha, np.clip(ac, 0.0, 1.0))
    distance = np.abs(a - bg).sum(axis=2)
    alpha = np.maximum(alpha, np.clip((distance - SOLID_FROM) / (SOLID_TO - SOLID_FROM), 0.0, 1.0))
    alpha = np.where(alpha > 1.0 - ALPHA_SNAP, 1.0, alpha)
    return np.where(alpha < ALPHA_FLOOR, 0.0, alpha)


def _crop_box(alpha: np.ndarray) -> tuple[slice, slice]:
    ys, xs = np.nonzero(alpha > 0)
    h, w = alpha.shape
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    if x0 < CROP_PAD or y0 < CROP_PAD or x1 > w - CROP_PAD or y1 > h - CROP_PAD:
        raise SystemExit(f"artwork touches the source edge: {(x0, y0, x1, y1)}")
    return slice(y0 - CROP_PAD, y1 + CROP_PAD), slice(x0 - CROP_PAD, x1 + CROP_PAD)


def _badge_split(alpha: np.ndarray) -> int:
    """Middle of the empty column run between the badge and the wordmark."""
    w = alpha.shape[1]
    opaque_cols = (alpha > 0.5).sum(axis=0)
    gap = [x for x in range(int(w * 0.2), int(w * 0.45)) if opaque_cols[x] < 3]
    if len(gap) < 10:
        raise SystemExit(f"no gap found between badge and wordmark ({len(gap)} columns)")
    return gap[len(gap) // 2]


def _fill_badge(alpha: np.ndarray, split: int) -> np.ndarray:
    """Make the inside of the badge fully opaque (its blue is close to the background colour).
    Only the badge side is filled: the counters of the letters must stay transparent."""
    side = (alpha[:, :split] >= 0.5).astype(np.uint8) * 255
    # copy(): an image from fromarray() shares the read-only array, and floodfill would silently do nothing.
    mask = Image.fromarray(side, "L").copy()
    ImageDraw.floodfill(mask, (0, 0), 128, thresh=0)  # the crop padding is outside the badge
    filled = np.asarray(mask)
    if not (filled == 128).any():
        raise SystemExit("badge outside was not flood-filled")
    holes = filled == 0
    ys, xs = np.nonzero(side)
    outline_area = (ys.max() - ys.min() + 1) * (xs.max() - xs.min() + 1)
    if holes.sum() > 0.8 * outline_area:
        raise SystemExit(f"badge fill too large: {int(holes.sum())} px for an outline of {outline_area} px")
    out = alpha.copy()
    out[:, :split] = np.where(holes, 1.0, out[:, :split])
    return out


def _unmix(a: np.ndarray, bg: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Foreground colour such that compositing it over the background gives back the source."""
    fg = np.clip((a - bg) / np.maximum(alpha[..., None], 1e-6) + bg, 0.0, 1.0)
    fg = np.where(alpha[..., None] > 0, fg, 0.0)
    return np.dstack([fg, alpha])


def _whiten_insta(rgba: np.ndarray, split: int) -> np.ndarray:
    """Invert the luminance of the dark "Insta" so it reads on navy; bevel greys become light greys."""
    h, w = rgba.shape[:2]
    rgb, alpha = rgba[..., :3] * 255.0, rgba[..., 3]
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722])
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)

    cyan = (sat > 0.5) & (rgb[..., 1] > 150) & (rgb[..., 2] > 200) & (alpha > 0.8)
    cyan_cols = cyan.sum(axis=0)
    # Bulk of the "F": the light-blue rim highlights of "Insta" stay well under this count.
    x_fact = next((x for x in range(split + 50, w) if cyan_cols[x] > 30), None)
    white = (luma > 200) & (sat < 0.2) & (alpha > 0.8)
    # Wordmark side only: the white "iF" of the badge would otherwise end the region mid-letter.
    white_rows = white[:, split:].sum(axis=1)
    y_tagline = next((y for y in range(int(h * 0.6), h) if white_rows[y] > 40), None)
    if x_fact is None or y_tagline is None:
        raise SystemExit(f"wordmark landmarks not found: x_fact={x_fact} y_tagline={y_tagline}")

    region = np.zeros((h, w), dtype=bool)
    region[: y_tagline - 4, split : x_fact + 40] = True
    # Opaque pixels only: the semi-transparent drop shadow stays dark (invisible on navy) instead
    # of turning into a light haze; "Fact" (saturated blue/cyan) is never touched.
    dark = region & (luma < 120) & (alpha > 0.5) & ~((sat > 0.45) & (rgb[..., 2] > 150))

    out = rgba.copy()
    inverted = (255.0 - luma) / 255.0
    for c in range(3):
        out[..., c] = np.where(dark, inverted, out[..., c])

    solid = dark & (alpha > 0.8)
    out_luma = (out[..., :3] * 255.0) @ np.array([0.2126, 0.7152, 0.0722])
    mean_luma = float(out_luma[solid].mean())
    if solid.sum() < 20_000 or mean_luma <= 200:
        raise SystemExit(f'"Insta" not whitened enough: n={int(solid.sum())} mean luma={mean_luma:.1f}')
    side = np.zeros((h, w), dtype=bool)
    side[: y_tagline - 4, split:] = True
    left_black = int((side & (out_luma < 120) & (alpha > 0.8) & (sat < 0.45)).sum())
    if left_black > 50:
        raise SystemExit(f'"Insta" still has {left_black} opaque dark pixels on the navy variant')
    return out


def _to_image(rgba: np.ndarray) -> Image.Image:
    return Image.fromarray((rgba * 255.0).round().clip(0, 255).astype(np.uint8), "RGBA")


def _resize(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    # Premultiplied alpha: no dark fringe from the colour of fully transparent pixels.
    return img.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def _icon(lockup: Image.Image, split: int) -> Image.Image:
    badge = lockup.crop((0, 0, split, lockup.height))
    badge = badge.crop(badge.getbbox())
    side = max(badge.size) + 2 * ICON_PAD
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(badge, ((side - badge.width) // 2, (side - badge.height) // 2))
    return _resize(square, (ICON_SIZE, ICON_SIZE))


def _save(img: Image.Image, path: str) -> None:
    # A fresh image carries no ICC/EXIF/XMP; nothing is passed to the encoder either.
    # alpha_quality < 100 makes the alpha lossy: invisible once downscaled 4x, half the bytes.
    img.save(path, "WEBP", quality=90, alpha_quality=70, method=6)


def _check_output(path: str, size: tuple[int, int] | None = None) -> Image.Image:
    nbytes = os.path.getsize(path)
    if nbytes > MAX_BYTES:
        raise SystemExit(f"{os.path.basename(path)} too large: {nbytes} bytes")
    im = Image.open(path)
    im.load()
    leaked = [k for k in ("icc_profile", "exif", "xmp") if im.info.get(k)]
    if leaked:
        raise SystemExit(f"{os.path.basename(path)} carries metadata: {leaked}")
    if im.mode != "RGBA":
        raise SystemExit(f"{os.path.basename(path)} has no alpha: {im.mode}")
    if size is not None and im.size != size:
        raise SystemExit(f"{os.path.basename(path)} size {im.size} != {size}")
    w, h = im.size
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if im.getpixel(corner)[3] != 0:
            raise SystemExit(f"{os.path.basename(path)} corner {corner} is not transparent")
    return im


def _contact_sheet(lockup: Image.Image, navy: Image.Image, icon: Image.Image, out_dir: str) -> str:
    def tile(img: Image.Image, bg: tuple[int, int, int], zone: tuple[int, int],
             box: tuple[int, int], dpr: int) -> Image.Image:
        scale = min(box[0] * dpr / img.width, box[1] * dpr / img.height)
        shown = _resize(img, (round(img.width * scale), round(img.height * scale)))
        t = Image.new("RGBA", (zone[0] * dpr, zone[1] * dpr), bg + (255,))
        t.alpha_composite(shown, ((t.width - shown.width) // 2, (t.height - shown.height) // 2))
        return t

    rows = []
    for dpr in (1, 2):
        rows.append([
            tile(lockup, THEME_BLUE, (240, 92), (208, 84), dpr),
            tile(lockup, HOVER_BLUE, (240, 92), (208, 84), dpr),
            tile(lockup, THEME_BLUE, (240, 48), (208, 40), dpr),
            tile(navy, DELEGATED_NAVY, (240, 48), (184, 40), dpr),
            tile(icon, THEME_BLUE, (72, 92), (48, 48), dpr),
            tile(icon, DELEGATED_NAVY, (72, 48), (40, 40), dpr),
        ])
    gap = 12
    width = max(sum(t.width for t in row) + gap * (len(row) + 1) for row in rows)
    height = sum(max(t.height for t in row) for row in rows) + gap * (len(rows) + 1)
    sheet = Image.new("RGB", (width, height), (200, 200, 200))
    y = gap
    for row in rows:
        x = gap
        for t in row:
            sheet.paste(t.convert("RGB"), (x, y))
            x += t.width + gap
        y += max(t.height for t in row) + gap
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "instafact-shell-logo-sheet.png")
    sheet.save(path)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sheet", metavar="DIR", help="write a review contact sheet to DIR")
    args = parser.parse_args()

    a = _load_source()
    bg = _fit_background(a)
    alpha = _alpha(a, bg)
    rows, cols = _crop_box(alpha)
    a, bg, alpha = a[rows, cols], bg[rows, cols], alpha[rows, cols]
    split = _badge_split(alpha)
    rgba = _unmix(a, bg, _fill_badge(alpha, split))
    navy_rgba = _whiten_insta(rgba, split)

    full = _to_image(rgba)
    ratio = full.width / full.height
    if not RATIO_RANGE[0] <= ratio <= RATIO_RANGE[1]:
        raise SystemExit(f"unexpected lockup ratio {ratio:.3f}")
    size = (LOCKUP_WIDTH, round(LOCKUP_WIDTH / ratio))
    lockup = _resize(full, size)
    navy = _resize(_to_image(navy_rgba), size)
    icon = _icon(full, split)

    os.makedirs(BRANDING, exist_ok=True)
    _save(lockup, LOCKUP_DST)
    _save(navy, LOCKUP_NAVY_DST)
    _save(icon, ICON_DST)

    _check_output(LOCKUP_DST, size)
    _check_output(LOCKUP_NAVY_DST, size)
    _check_output(ICON_DST, (ICON_SIZE, ICON_SIZE))

    for path in (LOCKUP_DST, LOCKUP_NAVY_DST, ICON_DST):
        print("Wrote", os.path.relpath(path, REPO_ROOT), Image.open(path).size, os.path.getsize(path), "bytes")
    print(f"Lockup ratio {ratio:.3f}, badge split at x={split} (cropped source px)")
    if args.sheet:
        print("Sheet", _contact_sheet(lockup, navy, icon, args.sheet))
    return 0


if __name__ == "__main__":
    sys.exit(main())
