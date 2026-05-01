#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "server/public/assets/openclaw-app-icon-source.png"
MASTER = ROOT / "server/public/assets/openclaw-app-icon-1024.png"


def resample_filter():
    return getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def load_master() -> Image.Image:
    source_path = SOURCE if SOURCE.exists() else MASTER
    icon = Image.open(source_path).convert("RGBA")
    if icon.size != (1024, 1024):
        icon = icon.resize((1024, 1024), resample_filter())
    return icon


def save_resized(master: Image.Image, path: Path, size: int, flatten: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = master.resize((size, size), resample_filter())
    if flatten:
        bg = Image.new("RGB", out.size, (255, 255, 255))
        bg.paste(out.convert("RGB"), mask=out.getchannel("A"))
        bg.save(path, optimize=True)
    else:
        out.save(path, optimize=True)


def main() -> None:
    icon = load_master()
    save_resized(icon, MASTER, 1024)

    for size in [180, 192, 512, 1024]:
        save_resized(icon, ROOT / f"server/public/assets/openclaw-app-icon-{size}.png", size)

    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in densities.items():
        for name in ["ic_launcher.png", "ic_launcher_round.png"]:
            save_resized(icon, ROOT / f"android-webview/app/src/main/res/mipmap-{density}/{name}", size)

    appicon_dir = ROOT / "ios-webview/OpenClawWebView/Assets.xcassets/AppIcon.appiconset"
    contents = json.loads((appicon_dir / "Contents.json").read_text())
    for entry in contents["images"]:
        filename = entry.get("filename")
        if not filename:
            continue
        size_pt = float(entry["size"].split("x")[0])
        scale = int(entry["scale"].replace("x", ""))
        save_resized(icon, appicon_dir / filename, round(size_pt * scale), flatten=True)


if __name__ == "__main__":
    main()
