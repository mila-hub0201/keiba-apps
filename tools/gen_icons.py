# gen_icons.py — PWA用アイコンを生成する(青グラデーション+「馬」)。
# 使い方: python tools/gen_icons.py

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\YuGothB.ttc",
    r"C:\Windows\Fonts\meiryob.ttc",
    r"C:\Windows\Fonts\meiryo.ttc",
    r"C:\Windows\Fonts\msgothic.ttc",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SystemExit("日本語フォントが見つかりません")


def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 青→濃青の縦グラデーション
    top = (56, 189, 248)
    bottom = (2, 132, 199)
    grad = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / (size - 1)
        grad.putpixel((0, y), tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    grad = grad.resize((size, size))

    if maskable:
        # maskable はセーフゾーン確保のため全面塗り
        img = grad
        draw = ImageDraw.Draw(img)
        glyph_ratio = 0.5
    else:
        radius = size // 5
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        img.paste(grad, (0, 0), mask)
        draw = ImageDraw.Draw(img)
        glyph_ratio = 0.58

    font = load_font(int(size * glyph_ratio))
    text = "馬"
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text,
              font=font, fill=(255, 255, 255, 255))
    return img


make_icon(192).save(OUT / "icon-192.png")
make_icon(512).save(OUT / "icon-512.png")
make_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
print("icons generated:", ", ".join(p.name for p in sorted(OUT.glob("*.png"))))
