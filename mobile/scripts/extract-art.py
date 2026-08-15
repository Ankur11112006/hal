"""Build the app icons from assets/logo.png.

Run via `node scripts/make-icons.mjs`, or directly.

Two things make this less trivial than a resize:

1. The logo sits on a smooth green-to-cyan gradient. A flood fill from the
   corners eats the golden arc, because the arc and the yellow-green beneath it
   are almost the same lightness. Hue separates them cleanly instead: the whole
   background lies between 58 and 180 degrees, and every part of the artwork is
   warm or simply dark.

2. Android adaptive icons crop roughly the outer third of the foreground to a
   circle or squircle, so the artwork has to sit inside a safe zone or the
   plough handle loses its tip on some launchers.
"""
import pathlib

import numpy as np
from PIL import Image, ImageFilter

ASSETS = pathlib.Path(__file__).resolve().parent.parent / "assets"
GREEN = (27, 94, 32)          # C.green, the app's primary
CREAM = (250, 248, 243)       # C.bg, the splash colour
SIZE = 1024
SAFE = 0.62                   # fraction of the canvas the artwork may occupy


def artwork() -> Image.Image:
    src = Image.open(ASSETS / "logo.png").convert("RGB")
    rgb = np.asarray(src).astype(np.float32) / 255.0
    mx, mn = rgb.max(2), rgb.min(2)
    d = mx - mn
    hue = np.zeros_like(mx)
    m = d > 1e-6
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    i = m & (mx == r); hue[i] = ((g - b)[i] / d[i]) % 6
    i = m & (mx == g); hue[i] = ((b - r)[i] / d[i]) + 2
    i = m & (mx == b); hue[i] = ((r - g)[i] / d[i]) + 4
    hue *= 60.0

    keep = (hue < 58) | (mx < 0.32)
    art = Image.fromarray(np.dstack([np.asarray(src), (keep * 255).astype(np.uint8)]), "RGBA")

    # The boundary pixels are an antialiased blend of artwork and the green
    # behind it, so keeping them leaves a pale green halo once the artwork is
    # placed on any other colour. Erode by a pixel first, then soften: cutting
    # slightly inside the edge costs nothing visible and removes the fringe.
    alpha = art.getchannel("A").filter(ImageFilter.MinFilter(3))
    art.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.6)))
    return art.crop(art.getbbox())


def compose(art, bg, scale, size=SIZE) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    w, h = art.size
    f = (size * scale) / max(w, h)
    a = art.resize((max(1, round(w * f)), max(1, round(h * f))), Image.LANCZOS)
    canvas.alpha_composite(a, ((size - a.width) // 2, (size - a.height) // 2))
    return canvas


def main():
    art = artwork()
    print(f"artwork {art.size}")

    # Legacy / iOS icon: fills more of the tile, since nothing crops it.
    compose(art, GREEN, 0.80).convert("RGB").save(ASSETS / "icon.png")

    # Android adaptive foreground: transparent, inside the safe zone. The green
    # comes from adaptiveIcon.backgroundColor in app.json.
    compose(art, None, SAFE).save(ASSETS / "adaptive-icon.png")

    # Splash sits on the cream background, so the artwork goes on transparent
    # and small: a splash icon that fills the screen looks like an error.
    compose(art, None, 0.55, 512).save(ASSETS / "splash-icon.png")

    # Play Store / slide deck use, at full bleed on the brand green.
    compose(art, GREEN, 0.78, 512).convert("RGB").save(ASSETS / "logo-square.png")

    for f in ("icon.png", "adaptive-icon.png", "splash-icon.png", "logo-square.png"):
        p = ASSETS / f
        print(f"  {f:22} {Image.open(p).size}  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
