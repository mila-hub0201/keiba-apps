#!/usr/bin/env python3
"""Convert JRA racecard PDF to structured files using pdfplumber."""

import json, re, sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    raise SystemExit("pdfplumber is required.")

def cx(w): return (w["x0"] + w["x1"]) / 2
def cy(w): return (w["top"] + w["bottom"]) / 2

def words_in(words, x0, x1, y0, y1):
    return [w for w in words if x0 <= cx(w) < x1 and y0 <= cy(w) < y1]

def merge_text(ws):
    return "".join(w["text"] for w in sorted(ws, key=lambda w: w["x0"])).strip()

def cluster_rows(ws, tol=3.0):
    if not ws: return []
    ws = sorted(ws, key=lambda w: cy(w))
    rows, cur = [], [ws[0]]
    for w in ws[1:]:
        if abs(cy(w) - cy(cur[-1])) <= tol:
            cur.append(w)
        else:
            rows.append(cur); cur = [w]
    rows.append(cur)
    return rows


def parse_race_info(words):
    header = [w for w in words if cy(w) < 90]
    joined = "".join(w["text"] for w in sorted(header, key=lambda w: (cy(w), w["x0"])))
    info = {}

    m = re.search(r"(\d{3,4})m\s*(ダート|芝).?(右|左)?", joined)
    if m:
        info["distance"] = m.group(1)
        info["surface"] = "ダ" if "ダート" in m.group(2) else "芝"
        info["direction"] = m.group(3) or ""

    m = re.search(r"発[⾛走]\s*([0-9:]+)", joined)
    if m: info["start_time"] = m.group(1)

    for v in ["函館","札幌","福島","新潟","東京","中山","中京","京都","阪神","小倉"]:
        if v in joined: info["venue"] = v; break

    for c in ["未勝利","1勝クラス","2勝クラス","3勝クラス","オープン","G1","G2","G3"]:
        if c in joined: info["class"] = c; break

    m = re.search(r"(\d+)R", joined)
    if m: info["race_number"] = m.group(1)

    # race_name: Japanese chars right after NNR, stop at digit or venue
    venues = "函館|札幌|福島|新潟|東京|中山|中京|京都|阪神|小倉"
    m = re.search(r"\d+R([぀-ヿ一-鿿]{2,12}?)(?:\d|" + venues + r")", joined)
    if m: info["race_name"] = m.group(1)

    cond = [c for c in ["牝","混合","定量","ハンデ","別定"] if c in joined]
    if cond: info["condition"] = " ".join(cond)

    return info


def detect_anchors(words):
    anchors = []
    for w in words:
        if not re.fullmatch(r"\d{1,2}", w["text"]): continue
        if not (62 <= cx(w) <= 76): continue
        nearby = [f for f in words if re.fullmatch(r"\d{1,2}", f["text"])
                  and 46 <= cx(f) <= 63 and abs(cy(f) - cy(w)) <= 8]
        if nearby:
            anchors.append({"frame": nearby[0]["text"],
                            "horse_number": w["text"],
                            "anchor_y": cy(w)})
    return sorted(anchors, key=lambda a: a["anchor_y"])


def parse_recent_run(ws):
    if not ws: return {}
    ws_sorted = sorted(ws, key=lambda w: (cy(w), w["x0"]))
    joined = "".join(w["text"] for w in ws_sorted)
    spaced = " ".join(w["text"] for w in ws_sorted)
    r = {"raw": spaced}   # uma-score が raw を参照する
    m = re.search(r"\d{4}\.\d{2}\.\d{2}", joined)
    if m: r["date"] = m.group(0)
    m = re.search(r"(函館|札幌|福島|新潟|東京|中山|中京|京都|阪神|小倉)", joined)
    if m: r["course"] = m.group(1)
    m = re.search(r"(\d{3,4})(芝|ダ)", joined)
    if m: r["distance"] = m.group(1); r["surface"] = m.group(2)
    # finish: 1-2桁 + 着 で18以下の最初の値（18超は別データの混入）
    valid_finish = [v for v in re.findall(r"(\d{1,2})着", joined) if int(v) <= 18]
    if valid_finish: r["finish"] = valid_finish[0]
    # position (通過順): find word matching N-N(-N)(-N) pattern
    pos_words = [w for w in ws_sorted if re.fullmatch(r"\d{1,2}(?:-\d{1,2}){1,3}", w["text"])]
    if pos_words: r["position"] = pos_words[0]["text"]
    # last3f: XX.X format (2 digits, dot, 1 digit)
    m = re.search(r"3\s*F(\d{2}\.\d)", joined)
    if m: r["last3f"] = m.group(1)
    # margin
    m = re.search(r"\((\d+\.\d+)\)", joined)
    if m: r["margin"] = m.group(1)
    return r

def parse_entry(words, anchor, band_y0, band_y1):
    ay = anchor["anchor_y"]
    band = [w for w in words if band_y0 <= cy(w) < band_y1]

    # ── RIGHT SIDE (x=214-251): 斤量 → 性齢 / 騎手 ──
    right_ws   = words_in(band, 214, 251, band_y0, band_y1)
    right_rows = cluster_rows(right_ws)
    wgt_row    = next((r for r in right_rows
                       if re.search(r"\d+\.?\d*k", merge_text(r))), None)
    if wgt_row:
        wy = cy(wgt_row[0])
        def row_at(y): return next((r for r in right_rows if abs(cy(r[0])-y) <= 3), [])
        carried_weight = merge_text(wgt_row)
        sex_color      = merge_text(row_at(wy - 6.0))
        jockey         = merge_text(row_at(wy + 6.0))
    else:
        carried_weight = sex_color = jockey = ""

    # ── ODDS (x=168-215): topmost row contains both odds and popularity ──
    odds_ws   = words_in(band, 168, 215, band_y0, band_y1)
    odds_rows = cluster_rows(odds_ws)
    if odds_rows:
        odds_row  = min(odds_rows, key=lambda r: cy(r[0]))
        odds_y    = cy(odds_row[0])
        odds_text = merge_text(odds_row)
    else:
        odds_y = ay; odds_text = ""

    odds_m = re.search(r"^(\d+(?:\.\d+)?)", odds_text)
    pop_m  = re.search(r"(\d+)番", odds_text)
    odds   = odds_m.group(1) if odds_m else ""
    pop    = pop_m.group(1) if pop_m else ""

    # ── HORSE NAME: same y as odds ──
    name_ws    = words_in(band, 74, 168, odds_y - 3, odds_y + 3)
    horse_name = merge_text(name_ws)

    # ── BODY WEIGHT (x=74-115, digit+kg pattern) ──
    left_ws = words_in(band, 74, 115, band_y0, band_y1)
    body_weight = ""
    for row in cluster_rows(left_ws):
        if re.search(r"\d{3,4}k", merge_text(row)):
            body_weight = merge_text(row); break

    # ── SIRE / DAM: always appear within 26px below anchor ──
    sd_words = [w for w in words if ay <= cy(w) < ay + 26 and 74 <= cx(w) < 220]
    sire_label = next((w for w in sd_words if w["text"] in ("⽗","父") and cx(w) <= 95), None)
    dam_label  = next((w for w in sd_words if w["text"] in ("⺟","母") and cx(w) <= 95), None)
    sire = merge_text([w for w in sd_words
                       if sire_label and abs(cy(w)-cy(sire_label)) <= 3 and cx(w) > 95])
    dam  = merge_text([w for w in sd_words
                       if dam_label  and abs(cy(w)-cy(dam_label))  <= 3 and cx(w) > 95])

    # ── RECENT RUNS (x=250-600) ──
    slots = [("previous",250,346),("two_back",346,426),
             ("three_back",426,506),("four_back",506,600)]
    runs = []
    for slot, rx0, rx1 in slots:
        rws    = words_in(band, rx0, rx1, band_y0, band_y1)
        parsed = parse_recent_run(rws)
        parsed["slot"] = slot
        runs.append(parsed)

    return {
        "frame":          anchor["frame"],
        "horse_number":   anchor["horse_number"],
        "horse_name":     horse_name,
        "body_weight":    body_weight,
        "odds":           odds,
        "popularity":     pop,
        "sex_color":      sex_color,
        "carried_weight": carried_weight,
        "jockey":         jockey,
        "sire":           sire,
        "dam":            dam,
        "recent_runs":    runs,
    }


def convert(pdf_path, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with pdfplumber.open(pdf_path) as pdf:
        words = pdf.pages[0].extract_words(keep_blank_chars=False)

    race_info = parse_race_info(words)
    anchors   = detect_anchors(words)

    if not anchors:
        sys.exit("ERROR: 馬番を検出できませんでした")

    gaps    = [anchors[i+1]["anchor_y"]-anchors[i]["anchor_y"]
               for i in range(len(anchors)-1)]
    med_gap = sorted(gaps)[len(gaps)//2] if gaps else 36.0

    entries = []
    for i, anchor in enumerate(anchors):
        ay = anchor["anchor_y"]
        band_y0 = max(0, (anchors[i-1]["anchor_y"] + ay) / 2) if i > 0 \
                  else max(0, ay - med_gap * 0.5)
        band_y1 = (ay + anchors[i+1]["anchor_y"]) / 2 if i+1 < len(anchors) \
                  else ay + med_gap * 0.9
        entries.append(parse_entry(words, anchor, band_y0, band_y1))

    with open(output_dir / "entries.jsonl", "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")

    md = ["## Race", ""]
    for k, v in race_info.items():
        if v: md.append(f"- {k}: {v}")
    md += ["", "## Entries", ""]
    headers = ["枠","馬番","馬名","馬体重","人気","性齢","斤量","騎手","父","母","前走着","前走3F"]
    md.append("| " + " | ".join(headers) + " |")
    md.append("| " + " | ".join("---" for _ in headers) + " |")
    for e in entries:
        prev = next((r for r in e["recent_runs"] if r.get("slot") == "previous"), {})
        row = [e["frame"], e["horse_number"], e["horse_name"], e["body_weight"],
               e["popularity"], e["sex_color"], e["carried_weight"], e["jockey"],
               e["sire"], e["dam"], prev.get("finish",""), prev.get("last3f","")]
        md.append("| " + " | ".join(str(v).replace("|","\\|") for v in row) + " |")

    (output_dir / "race.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    manifest = {"entry_count": len(entries), **race_info}
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"entry_count": len(entries), "output_dir": str(output_dir)},
                     ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.pdf> <output_dir>", file=sys.stderr)
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
