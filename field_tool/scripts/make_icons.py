"""Generate Expo icons from the source Gemini logo JPG.

Outputs:
  - assets/icon.png            1024x1024  full-bleed logo on white
  - assets/adaptive-icon.png   1024x1024  foreground only (safe zone respected), transparent bg
  - assets/splash-icon.png     1024x1024  centered logo on white
  - assets/favicon.png           48x48    web favicon

Android adaptive icons: foreground occupies the central 66% of the canvas,
the rest may be cropped on launchers — so we keep 17% padding each side
and the safe zone (~33% inner) holds the entire logo.
"""
from PIL import Image

SRC = r"D:\Samet-Yedek-Disk\dersler\mobil\ODTU_Mobil_AR\Gemini_Generated_Image_bidiklbidiklbidi_r3_c1.jpg"
ASSETS = r"D:\Samet-Yedek-Disk\dersler\mobil\ODTU_Mobil_AR\field_tool\assets"

WHITE = (255, 255, 255, 255)


def remove_white_bg(img: Image.Image, tol: int = 16) -> Image.Image:
    """Flood-fill only the background regions (connected to image edges).

    Interior white shapes — like the camera aperture inside the pin —
    stay opaque. Edge-connected whites turn transparent.
    """
    rgba = img.convert("RGBA")

    from PIL import ImageChops

    diff = ImageChops.difference(
        rgba.convert("RGB"),
        Image.new("RGB", rgba.size, (255, 255, 255)),
    )
    gray = diff.convert("L")
    # Pixels within tol of white => background candidate.
    bg_mask = gray.point(lambda v: 255 if v <= tol else 0).convert("1")

    import numpy as np

    arr = np.array(bg_mask, dtype=bool)
    # Label connected components; keep labels touching any border pixel.
    visited = np.zeros_like(arr, dtype=bool)
    from collections import deque

    h2, w2 = arr.shape
    q: deque = deque()
    for x in range(w2):
        if arr[0, x] and not visited[0, x]:
            visited[0, x] = True
            q.append((0, x))
        if arr[h2 - 1, x] and not visited[h2 - 1, x]:
            visited[h2 - 1, x] = True
            q.append((h2 - 1, x))
    for y in range(h2):
        if arr[y, 0] and not visited[y, 0]:
            visited[y, 0] = True
            q.append((y, 0))
        if arr[y, w2 - 1] and not visited[y, w2 - 1]:
            visited[y, w2 - 1] = True
            q.append((y, w2 - 1))

    while q:
        y, x = q.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h2 and 0 <= nx < w2 and arr[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    out = rgba.copy()
    out_np = np.array(out)
    out_np[..., 3] = np.where(visited, 0, out_np[..., 3])
    return Image.fromarray(out_np, "RGBA")


def fit_square(img: Image.Image, size: int, bg, pad_px: int = 0) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg)
    side = size - 2 * pad_px
    # First center-crop to a square so the logo fills the canvas, then resize.
    w, h = img.size
    side_short = min(w, h)
    left = (w - side_short) // 2
    top = (h - side_short) // 2
    sq = img.crop((left, top, left + side_short, top + side_short))
    fitted = sq.resize((side, side), Image.LANCZOS)
    off = ((size - fitted.width) // 2, (size - fitted.height) // 2)
    canvas.paste(fitted, off, fitted if fitted.mode == "RGBA" else None)
    return canvas


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    print(f"source: {src.size}")

    # icon.png — full-bleed on white, 1024x1024
    icon = fit_square(src, 1024, WHITE, pad_px=0)
    icon.save(f"{ASSETS}\\icon.png", "PNG", optimize=True)
    print("icon.png           1024x1024")

    # adaptive-icon.png — transparent bg, logo inside safe zone
    src_alpha = remove_white_bg(src)
    safe_pad = int(1024 * 0.20)  # 20% padding keeps the whole logo inside ~60% inner area
    adaptive = fit_square(src_alpha, 1024, (0, 0, 0, 0), pad_px=safe_pad)
    adaptive.save(f"{ASSETS}\\adaptive-icon.png", "PNG", optimize=True)
    print("adaptive-icon.png  1024x1024  (transparent, safe-zone padded)")

    # splash-icon.png — transparent bg, logo with safe padding so it floats
    # over the teal splash backgroundColor (no white box).
    splash_pad = int(1024 * 0.20)
    src_alpha2 = remove_white_bg(src)
    splash = fit_square(src_alpha2, 1024, (0, 0, 0, 0), pad_px=splash_pad)
    splash.save(f"{ASSETS}\\splash-icon.png", "PNG", optimize=True)
    print("splash-icon.png    1024x1024  (transparent)")

    # favicon.png — tiny web favicon
    fav = fit_square(src, 48, WHITE, pad_px=0)
    fav.save(f"{ASSETS}\\favicon.png", "PNG", optimize=True)
    print("favicon.png         48x48")


if __name__ == "__main__":
    main()
