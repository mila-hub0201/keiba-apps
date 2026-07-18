# gen_test_pdf.py — convert_racecard.py の座標仕様に合わせた合成出馬表PDFを作る。
# 抽出ロジック(Python版 pdfplumber / JS版 pdf.js)の照合テスト用。
#
# 使い方: python tools/gen_test_pdf.py <出力ディレクトリ>

import random
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

FONT = "HeiseiKakuGo-W5"
pdfmetrics.registerFont(UnicodeCIDFont(FONT))

W, _H_A4 = landscape(A4)  # 幅は842固定
H = 595.0  # ページ高は gen_pdf ごとに頭数に応じて設定する
VENUES = ["函館", "札幌", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"]
NAMES = ["サクラエクスプレス", "ゴールドタイフーン", "ミラクルステップ", "ハヤテノゴトク",
         "アオゾラウイング", "テツザンコウ", "ホシノカケラ", "ユメノツバサ",
         "カゼニナビク", "モモイロダンサー", "シルバーアロー", "トキノメグリ",
         "ナミダノチカラ", "ヒカリノサキへ", "アマオトノリズム", "ツキヨノランナー",
         "コハルビヨリ", "ヤマビコオトメ"]
SIRES = ["キズナ", "ロードカナロア", "エピファネイア", "ドゥラメンテ", "モーリス"]
DAMS = ["スプリングハート", "ウインドミル", "サニーサイド", "リバーサイドローズ"]
JOCKEYS = ["ルメール", "川田将雅", "武豊", "戸崎圭太", "横山武史", "松山弘平"]


def draw(c, x, top_y, text, size=9):
    """top基準yで文字列を置く(reportlabはy上向き・ベースライン指定)。"""
    c.setFont(FONT, size)
    # ベースライン ≒ top + ascent。ascent 0.85em とみなす
    c.drawString(x, H - (top_y + size * 0.85), text)


def gen_pdf(path, seed, n_horses, venue, race_no, dist, surface, cls, cond):
    global H
    rng = random.Random(seed)
    # 全頭がページ内に収まる高さにする(実際のJRA PDFも1ページ完結のため)
    H = max(595.0, 160.0 + n_horses * 44.0)
    c = canvas.Canvas(str(path), pagesize=(W, H))

    # ── ヘッダー(top<90) ──
    surface_long = "ダート" if surface == "ダ" else "芝"
    draw(c, 40, 30, f"{venue}{race_no}R テスト盃 {dist}m {surface_long}・左", 12)
    draw(c, 40, 50, f"発走 15:{rng.randint(10, 59)}  {cls}  {cond}", 10)

    y0 = 130.0
    gap = 44.0
    for i in range(n_horses):
        num = i + 1
        ay = y0 + i * gap
        frame = str(min((num + 1) // 2, 8))

        # 枠・馬番(アンカー)
        draw(c, 50, ay, frame)
        draw(c, 64, ay, str(num))

        # 馬名+オッズ行(帯の最上段になるよう ay-14 に置く)
        name = NAMES[i % len(NAMES)]
        draw(c, 76, ay - 14, name)
        if rng.random() < 0.9:  # ときどきオッズ欠損
            odds = round(rng.uniform(1.2, 80), 1)
            draw(c, 170, ay - 14, f"{odds} {rng.randint(1, n_horses)}番人気", 8)

        # 馬体重
        if rng.random() < 0.85:
            draw(c, 76, ay - 4, f"{rng.randint(430, 530)}kg({rng.choice('+-')}{rng.randint(0, 13)})", 8)

        # 右側: 性齢 / 斤量 / 騎手 (±6pt)
        wy = ay - 6
        draw(c, 216, wy - 6, f"{rng.choice('牡牝セ')}{rng.randint(2, 7)}鹿", 7)
        draw(c, 216, wy, f"{rng.choice([54.0, 55.0, 56.0, 57.0, 58.0])}k", 7)
        draw(c, 216, wy + 6, rng.choice(JOCKEYS), 7)

        # 父・母(ay直下26pt以内)
        draw(c, 80, ay + 8, "父", 7)
        draw(c, 100, ay + 8, rng.choice(SIRES), 7)
        draw(c, 80, ay + 17, "母", 7)
        draw(c, 100, ay + 17, rng.choice(DAMS), 7)

        # 近走4本
        slots = [250, 346, 426, 506]
        n_runs = rng.randint(0, 4)
        for s in range(n_runs):
            rx = slots[s] + 4
            rv = rng.choice(VENUES)
            rd = rng.choice([1200, 1400, 1600, 1800, 2000, 2400])
            rs = surface if rng.random() < 0.7 else ("ダ" if surface == "芝" else "芝")
            rcls = rng.choice(["未勝利", "1勝クラス", "2勝クラス", "オープン", "G3"])
            fin = rng.randint(1, 17)
            draw(c, rx, ay - 14, f"2026.0{rng.randint(1, 6)}.{rng.randint(10, 28)}{rv}", 6)
            draw(c, rx, ay - 6, f"{rd}{rs} {rcls} {fin}着", 6)
            line3 = []
            if rng.random() < 0.85:
                pos = "-".join(str(rng.randint(1, 15)) for _ in range(rng.randint(2, 4)))
                line3.append(pos)
            if rng.random() < 0.85:
                line3.append(f"3F{round(rng.uniform(33.0, 38.9), 1)}")
            if rng.random() < 0.7:
                line3.append(f"({round(rng.uniform(0.0, 2.4), 1)})")
            if line3:
                draw(c, rx, ay + 2, " ".join(line3), 6)

    c.showPage()
    c.save()


def main(outdir):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    gen_pdf(out / "test_race_1.pdf", 1, 8, "東京", 11, 1600, "芝", "2勝クラス", "定量")
    gen_pdf(out / "test_race_2.pdf", 2, 16, "中山", 5, 1200, "ダ", "未勝利", "ハンデ 混合")
    gen_pdf(out / "test_race_3.pdf", 3, 18, "京都", 12, 2400, "芝", "G3", "別定")
    print("generated:", ", ".join(f"test_race_{i}.pdf" for i in (1, 2, 3)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "pdf_work")
