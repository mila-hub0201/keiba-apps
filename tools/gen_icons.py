# gen_icons.py — PWA用アイコンを icons/icon-source.png から生成する。
# 使い方: python tools/gen_icons.py
#
# maskable はランチャー側で円形等に切り抜かれるため、中身を80%に縮めて
# 背景色(元画像の四隅からサンプリング)で全面を埋めたものを作る。

from pathlib import Path

from PIL import Image

ICONS = Path(__file__).resolve().parent.parent / "icons"
SRC = ICONS / "icon-source.png"

src = Image.open(SRC).convert("RGBA")

src.resize((512, 512), Image.LANCZOS).save(ICONS / "icon-512.png")
src.resize((192, 192), Image.LANCZOS).save(ICONS / "icon-192.png")

corner = src.getpixel((3, 3))
bg = Image.new("RGBA", (512, 512), corner)
inner_size = 410  # 512 * 0.8
inner = src.resize((inner_size, inner_size), Image.LANCZOS)
bg.paste(inner, ((512 - inner_size) // 2,) * 2, inner)
bg.save(ICONS / "icon-maskable-512.png")

print("icons generated:", ", ".join(p.name for p in sorted(ICONS.glob("*.png"))))
