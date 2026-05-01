#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "server/public/assets/openclaw-app-icon-1024.png"


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def mix(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(lerp(a, b, t) for a, b in zip(c1, c2))


def draw_gradient_line(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], colors: list[tuple[int, int, int]], width: int) -> None:
    if len(points) < 2:
        return
    segments = len(points) - 1
    for i in range(segments):
        t = i / max(segments - 1, 1)
        if t < 0.55:
            c = mix(colors[0], colors[1], t / 0.55)
        else:
            c = mix(colors[1], colors[2], (t - 0.55) / 0.45)
        draw.line([points[i], points[i + 1]], fill=c, width=width, joint="curve")


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def make_icon(size: int = 1024) -> Image.Image:
    scale = size / 1024
    img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)

    # Deep navy rounded app tile with subtle vignette. The provided artwork is
    # used as visual direction, but this redraw keeps the launcher icon cleaner:
    # no tiny wordmark, stronger contrast, and simpler shapes for small sizes.
    tile = Image.new("RGBA", (size, size), (2, 14, 52, 255))
    pix = tile.load()
    cx, cy = size * 0.50, size * 0.48
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / size
            dy = (y - cy) / size
            r = min(1.0, math.sqrt(dx * dx + dy * dy) * 1.9)
            base = mix((5, 25, 80), (0, 8, 38), r)
            pix[x, y] = (*base, 255)
    mask = rounded_rect_mask(size, round(128 * scale))
    bg.alpha_composite(tile)
    bg.putalpha(mask)
    img.alpha_composite(bg)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [round(18 * scale), round(18 * scale), size - round(18 * scale), size - round(18 * scale)],
        radius=round(112 * scale),
        outline=(82, 143, 255, 42),
        width=round(3 * scale),
    )

    # Chat bubble ring: draw one smooth mask, then color it with a cyan→violet gradient.
    bubble_mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(bubble_mask)
    center = (size * 0.50, size * 0.50)
    radius = size * 0.335
    pts = []
    for deg in range(214, 502, 2):
        if 398 <= deg <= 430:
            continue
        a = math.radians(deg)
        pts.append((center[0] + math.cos(a) * radius, center[1] + math.sin(a) * radius))
    width = round(58 * scale)
    md.line(pts, fill=255, width=width, joint="curve")
    tail = [(size * 0.27, size * 0.66), (size * 0.22, size * 0.82), (size * 0.36, size * 0.75), (size * 0.49, size * 0.80)]
    md.line(tail, fill=255, width=width, joint="curve")

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow.putalpha(bubble_mask.filter(ImageFilter.GaussianBlur(round(10 * scale))))
    # tint the alpha shadow black
    shadow_rgb = Image.new("RGBA", (size, size), (0, 0, 0, 95))
    shadow_rgb.putalpha(shadow.getchannel("A"))
    img.alpha_composite(shadow_rgb)

    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gp = grad.load()
    c0, c1, c2 = (47, 213, 239), (78, 121, 255), (203, 81, 236)
    for x in range(size):
        t = x / max(1, size - 1)
        c = mix(c0, c1, t / 0.58) if t < 0.58 else mix(c1, c2, (t - 0.58) / 0.42)
        for y in range(size):
            gp[x, y] = (*c, 255)
    grad.putalpha(bubble_mask)
    img.alpha_composite(grad)
    d = ImageDraw.Draw(img)

    # Robot face.
    face_box = [round(size * 0.32), round(size * 0.35), round(size * 0.68), round(size * 0.65)]
    face_shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fsd = ImageDraw.Draw(face_shadow)
    fsd.rounded_rectangle([face_box[0], face_box[1] + round(10 * scale), face_box[2], face_box[3] + round(10 * scale)], radius=round(72 * scale), fill=(0, 0, 0, 90))
    img.alpha_composite(face_shadow.filter(ImageFilter.GaussianBlur(round(12 * scale))))
    d.rounded_rectangle(face_box, radius=round(70 * scale), fill=(245, 248, 255, 255))
    d.rounded_rectangle(face_box, radius=round(70 * scale), outline=(255, 255, 255, 150), width=round(2 * scale))
    eye_w, eye_h = round(32 * scale), round(70 * scale)
    eye_y = round(size * 0.47)
    for ex in [round(size * 0.43), round(size * 0.57)]:
        d.rounded_rectangle([ex - eye_w // 2, eye_y - eye_h // 2, ex + eye_w // 2, eye_y + eye_h // 2], radius=round(15 * scale), fill=(0, 13, 54, 255))
    # Smile arc
    smile_box = [round(size * 0.45), round(size * 0.515), round(size * 0.55), round(size * 0.59)]
    d.arc(smile_box, 25, 155, fill=(0, 13, 54, 255), width=round(14 * scale))

    # Link badge.
    badge_c = (size * 0.75, size * 0.68)
    badge_r = size * 0.088
    d.ellipse([badge_c[0]-badge_r, badge_c[1]-badge_r, badge_c[0]+badge_r, badge_c[1]+badge_r], fill=(4, 15, 58, 255), outline=(151, 72, 244, 255), width=round(18*scale))
    # Chain-link mark, drawn manually so it is stable across build hosts.
    link_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(link_layer)
    lw = round(12 * scale)
    # two rotated rounded link outlines
    link_box_w = round(76 * scale)
    link_box_h = round(32 * scale)
    tmp = Image.new("RGBA", (round(150 * scale), round(120 * scale)), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    td.rounded_rectangle([round(12*scale), round(42*scale), round(88*scale), round(74*scale)], radius=round(17*scale), outline=(255,255,255,255), width=lw)
    td.rounded_rectangle([round(60*scale), round(42*scale), round(136*scale), round(74*scale)], radius=round(17*scale), outline=(255,255,255,255), width=lw)
    td.line([round(63*scale), round(58*scale), round(85*scale), round(58*scale)], fill=(4,15,58,255), width=round(10*scale))
    rot = tmp.rotate(-45, resample=getattr(getattr(Image, "Resampling", Image), "BICUBIC"), expand=True)
    img.alpha_composite(rot, (round(badge_c[0] - rot.width/2), round(badge_c[1] - rot.height/2)))

    return img.convert("RGBA")


def save_resized(master: Image.Image, path: Path, size: int, rgb: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
    out = master.resize((size, size), resample)
    if rgb:
        bg = Image.new("RGB", out.size, (255, 255, 255))
        bg.paste(out.convert("RGB"))
        bg.save(path, optimize=True)
    else:
        out.save(path, optimize=True)


def main() -> None:
    MASTER.parent.mkdir(parents=True, exist_ok=True)
    icon = make_icon(1024)
    icon.save(MASTER, optimize=True)

    # PWA/web icons.
    for size in [180, 192, 512, 1024]:
        save_resized(icon, ROOT / f"server/public/assets/openclaw-app-icon-{size}.png", size)

    # Android launcher icons.
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in densities.items():
        for name in ["ic_launcher.png", "ic_launcher_round.png"]:
            save_resized(icon, ROOT / f"android-webview/app/src/main/res/mipmap-{density}/{name}", size)

    # iOS AppIcon set from Contents.json.
    appicon_dir = ROOT / "ios-webview/OpenClawWebView/Assets.xcassets/AppIcon.appiconset"
    contents = json.loads((appicon_dir / "Contents.json").read_text())
    for entry in contents["images"]:
        filename = entry.get("filename")
        if not filename:
            continue
        size_pt = float(entry["size"].split("x")[0])
        scale = int(entry["scale"].replace("x", ""))
        px = round(size_pt * scale)
        save_resized(icon, appicon_dir / filename, px, rgb=True)


if __name__ == "__main__":
    main()
