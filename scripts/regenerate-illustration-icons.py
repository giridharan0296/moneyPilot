"""Regenerate app/splash/adaptive icons from the finance illustration source JPG."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:/Users/v.giridharan/.cursor/projects/d-Personal-worth-management/assets/"
    "c__Users_v.giridharan_AppData_Roaming_Cursor_User_workspaceStorage_614b3fbf192165bd5468eb0c337480f4_images_"
    "finimage-23bc8b67-0332-408e-ad17-596f94a1c8be.jpg"
)
ASSETS = Path(__file__).resolve().parent.parent / "assets"
SIZE = 1024
SAFE = 0.62


def remove_near_white(im: Image.Image, threshold: int = 245) -> Image.Image:
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r >= threshold and g >= threshold and b >= threshold:
                px[x, y] = (255, 255, 255, 0)
    return im


def trim_alpha(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def fit_canvas(
    im: Image.Image,
    size: int,
    fill: tuple[int, int, int, int],
    scale_of_canvas: float = 1.0,
) -> Image.Image:
    im = trim_alpha(im)
    target = int(size * scale_of_canvas)
    w, h = im.size
    s = min(target / w, target / h)
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), fill)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return canvas


def opaque_white_master(im_src: Image.Image) -> Image.Image:
    w, h = im_src.size
    scale = min(SIZE / w, SIZE / h) * 0.92
    nw, nh = int(w * scale), int(h * scale)
    resized = im_src.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
    canvas.paste(resized, ((SIZE - nw) // 2, (SIZE - nh) // 2), resized)
    return canvas


def monochrome_from_glyph(glyph: Image.Image) -> Image.Image:
    out = Image.new("RGBA", glyph.size, (0, 0, 0, 0))
    gp = glyph.load()
    op = out.load()
    for y in range(glyph.height):
        for x in range(glyph.width):
            _, _, _, a = gp[x, y]
            if a > 24:
                op[x, y] = (255, 255, 255, a)
    return out


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Source illustration not found: {SRC}")

    src = Image.open(SRC).convert("RGBA")
    glyph_src = remove_near_white(src.copy())
    master = opaque_white_master(src)
    glyph = fit_canvas(glyph_src, SIZE, (0, 0, 0, 0), SAFE)
    mono = monochrome_from_glyph(glyph)
    favicon = master.resize((512, 512), Image.Resampling.LANCZOS)

    writes = {
        "worth-app-icon.png": master,
        "icon.png": master.copy(),
        "adaptive-icon.png": master.copy(),
        "worth-splash-icon.png": glyph,
        "adaptive-icon-foreground.png": glyph.copy(),
        "adaptive-icon-monochrome.png": mono,
        "splash-icon.png": glyph.copy(),
        "favicon.png": favicon,
    }

    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, img in writes.items():
        img.save(ASSETS / name, optimize=True)
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
