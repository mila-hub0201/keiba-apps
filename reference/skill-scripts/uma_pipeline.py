#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""uma_pipeline.py — uma-score / uma-mark / uma-bet のルールを決定的に計算する共通スクリプト。

Usage:
  uma_pipeline.py score <workdir>                     # entries.jsonl と race.md を読む
  uma_pipeline.py mark  <workdir> [--paddock "17◎,2〇"]
  uma_pipeline.py bet   <workdir>
  uma_pipeline.py full  <workdir> [--paddock "17◎,2〇"]

<workdir> に score.json / mark.json / bet.json を書き出し、整形済みブロックを標準出力する。
entries.jsonl は uma-full 版・uma-racecard-layout 版の両スキーマに対応。
純標準ライブラリのみ使用。
"""

import json
import math
import re
import sys
from pathlib import Path

VENUES = ["函館", "札幌", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"]

CLASS_LEVELS = [
    ("G1", 7), ("GI", 7), ("G2", 6), ("GII", 6), ("G3", 5), ("GIII", 5),
    ("オープン", 4), ("OP", 4), ("3勝", 3), ("2勝", 2), ("1勝", 1),
    ("未勝利", 0), ("新馬", 0),
]


def dist_class(d):
    if d is None:
        return ""
    if d <= 1400:
        return "短距離"
    if d <= 1800:
        return "マイル"
    if d <= 2400:
        return "中距離"
    return "長距離"


def class_level(text):
    if not text:
        return None
    for key, lv in CLASS_LEVELS:
        if key in text:
            return lv
    return None


def to_int(v):
    try:
        s = re.sub(r"[^0-9]", "", str(v))
        return int(s) if s else None
    except Exception:
        return None


def to_float(v):
    try:
        return float(v)
    except Exception:
        return None


# ---------------------------------------------------------------- 入力の正規化

def normalize_run(r):
    """recent_runs の1走分を正規化。欠けているフィールドは raw から補完する。"""
    raw = r.get("raw", "") or ""
    joined = raw.replace(" ", "")
    out = dict(r)

    if out.get("finish") is not None:
        out["finish"] = to_int(out["finish"])
    if out.get("finish") is None:
        cands = [int(x) for x in re.findall(r"(\d{1,2})着", joined) if int(x) <= 18]
        out["finish"] = cands[0] if cands else None

    if not out.get("surface") or not out.get("distance"):
        m = re.search(r"(\d{3,4})(芝|ダ)", joined) or re.search(r"(芝|ダ)(\d{3,4})", joined)
        if m:
            g1, g2 = m.group(1), m.group(2)
            if g1 in ("芝", "ダ"):
                out.setdefault("surface", g1)
                out.setdefault("distance", g2)
            else:
                out.setdefault("distance", g1)
                out.setdefault("surface", g2)
    out["distance"] = to_int(out.get("distance"))

    if not out.get("course"):
        m = re.search("(" + "|".join(VENUES) + ")", joined)
        if m:
            out["course"] = m.group(1)

    if not out.get("position"):
        m = re.search(r"(?:^|\s)(\d{1,2}(?:-\d{1,2}){1,3})(?:\s|$)", raw)
        if m:
            out["position"] = m.group(1)

    if not out.get("last3f"):
        m = re.search(r"3\s*F\s*(\d{2}\.\d)", raw) or re.search(r"(\d{2}\.\d)\s*$", raw.strip())
        if m:
            out["last3f"] = m.group(1)
    out["last3f"] = to_float(out.get("last3f"))

    if not out.get("margin"):
        m = re.search(r"\((\d+\.\d+)\)", joined)
        if m:
            out["margin"] = m.group(1)
    out["margin"] = to_float(out.get("margin"))

    out["class_level"] = class_level(joined)
    out["has_data"] = bool(joined or raw) and out["finish"] is not None
    return out


def normalize_entry(e):
    out = dict(e)
    out["horse_number"] = to_int(e.get("horse_number"))
    out["popularity"] = to_int(e.get("popularity")) or 99  # 不明は99扱い
    out["odds"] = to_float(e.get("odds"))  # 単勝オッズ。買い目(uma-bet)で使用
    weight_text = e.get("body_weight") or e.get("record_prize_weight") or ""
    m = re.search(r"\(([+-]?\d+)\)", str(weight_text))
    out["weight_change"] = abs(int(m.group(1))) if m else None
    runs = [normalize_run(r) for r in e.get("recent_runs", [])]
    out["recent_runs"] = [r for r in runs if r.get("has_data")]
    return out


def parse_race(race_md_text, n_entries):
    """race.md からレース条件を取得（uma-full版・layout版どちらの形式でも動く）。"""
    info = {}
    for line in race_md_text.splitlines():
        m = re.match(r"-\s*(\w+):\s*(.+)", line.strip())
        if m:
            info[m.group(1)] = m.group(2).strip()
    text = race_md_text
    distance = to_int(info.get("distance"))
    if distance is None:
        m = re.search(r"(\d{3,4})m", text)
        distance = to_int(m.group(1)) if m else None
    surface_src = info.get("surface") or text
    surface = "ダ" if ("ダ" in surface_src) else ("芝" if "芝" in surface_src else "")
    venue = info.get("venue") or next((v for v in VENUES if v in text), "")
    cls = info.get("class") or next((c for c in ["未勝利", "新馬", "1勝クラス", "2勝クラス", "3勝クラス", "オープン", "G1", "G2", "G3"] if c in text), "")
    return {
        "venue": venue,
        "distance": distance,
        "dist_class": dist_class(distance),
        "surface": surface,
        "class": cls,
        "class_level": class_level(cls),
        "race_number": info.get("race_number", ""),
        "handicap": "ハンデ" in text,
        "jump": "障害" in text,
        "headcount": n_entries,
    }


# ---------------------------------------------------------------- uma-score

RUN_STYLE_TABLE = {
    # 脚質: (馬番1-4, 馬番5-9, 馬番10以上)
    "逃げ": (6, 4, 2),
    "先行": (5, 4, 3),
    "差し": (3, 4, 3),
    "追込": (3, 4, 4),
}


def run_style(entry):
    """前走（無ければ以降で最初に通過順位が取れた走）の平均通過順位から脚質判定。"""
    for r in entry["recent_runs"]:
        if r.get("position"):
            nums = [int(x) for x in r["position"].split("-")]
            avg = sum(nums) / len(nums)
            if avg < 2.5:
                return "逃げ"
            if avg < 4.5:
                return "先行"
            if avg < 7.5:
                return "差し"
            return "追込"
    return "差し"  # データ欠損時は中立的な「差し」扱い


def score_style(entry):
    style = run_style(entry)
    n = entry["horse_number"] or 99
    col = 0 if n <= 4 else (1 if n <= 9 else 2)
    return RUN_STYLE_TABLE[style][col], style


def score_distance(entry, race):
    best = 0
    for r in entry["recent_runs"]:
        if r.get("surface") != race["surface"]:
            continue
        if dist_class(r.get("distance")) != race["dist_class"]:
            continue
        f = r.get("finish")
        if f and f <= 3:
            best = max(best, 2)
        elif f and 4 <= f <= 5:
            best = max(best, 1)
    return best


def score_same_cond(entry, race):
    best = 0
    for r in entry["recent_runs"]:
        if r.get("surface") != race["surface"]:
            continue
        if dist_class(r.get("distance")) != race["dist_class"]:
            continue
        f = r.get("finish")
        if not f:
            continue
        same_venue = r.get("course") == race["venue"]
        if same_venue and f <= 3:
            best = max(best, 3)
        elif same_venue and 4 <= f <= 5:
            best = max(best, 1)
        elif (not same_venue) and f <= 3:
            best = max(best, 2)
    return best


def score_recent(entry):
    runs = entry["recent_runs"]
    if not runs:
        return 0
    r = runs[0]
    f = r.get("finish")
    margin = r.get("margin")
    if f == 1:
        return 3
    if f in (2, 3):
        return 2
    if f is not None and (f >= 10 or (margin is not None and margin >= 1.5)):
        return -1
    if f in (4, 5):
        # 着差不明は 0.5秒超扱い（保守的）
        return 1 if (margin is not None and margin <= 0.5) else 0
    return 0


def last3f_avg(entry, race):
    vals = [r["last3f"] for r in entry["recent_runs"]
            if r.get("last3f") and r.get("surface") == race["surface"]]
    return round(sum(vals) / len(vals), 2) if vals else None


def score_adjust(entry, race):
    s = 0
    if entry.get("weight_change") is not None and entry["weight_change"] >= 10:
        s -= 1
    runs = entry["recent_runs"]
    if runs and runs[0].get("class_level") is not None and race.get("class_level") is not None:
        if race["class_level"] > runs[0]["class_level"]:
            s -= 1  # 昇級初戦
    for r in runs:
        if (r.get("course") == race["venue"] and r.get("surface") == race["surface"]
                and dist_class(r.get("distance")) == race["dist_class"]
                and r.get("finish") and r["finish"] <= 3):
            s += 1
            break
    return max(s, -2)


def ranked_order(horses):
    """合計降順。同点は 同条件点 → 近走点 → 人気 で決める。"""
    return sorted(horses, key=lambda h: (-h["total"], -h["scores"]["cond"], -h["scores"]["recent"], h["popularity"]))


def cmd_score(workdir, quiet_footer=False):
    wd = Path(workdir)
    entries = [normalize_entry(json.loads(line))
               for line in (wd / "entries.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    race = parse_race((wd / "race.md").read_text(encoding="utf-8"), len(entries))

    # 上がり3F 全馬ランキング（同馬場のみ・昇順）
    avgs = {e["horse_number"]: last3f_avg(e, race) for e in entries}
    ranked_vals = sorted({v for v in avgs.values() if v is not None})
    l3f_pts = {1: 3, 2: 2, 3: 1}

    horses = []
    for e in entries:
        style_pt, style = score_style(e)
        avg = avgs.get(e["horse_number"])
        rank = ranked_vals.index(avg) + 1 if avg is not None else None
        scores = {
            "style": style_pt,
            "dist": score_distance(e, race),
            "cond": score_same_cond(e, race),
            "recent": score_recent(e),
            "last3f": l3f_pts.get(rank, 0) if rank else 0,
            "adjust": score_adjust(e, race),
        }
        horses.append({
            "num": e["horse_number"],
            "name": e.get("horse_name", ""),
            "popularity": e["popularity"],
            "odds": e.get("odds"),
            "run_style": style,
            "last3f_avg": avg,
            "scores": scores,
            "total": sum(scores.values()),
        })

    result = {"race": race, "horses": horses}
    (wd / "score.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")

    rn = f"{race['race_number']}R" if race.get("race_number") else ""
    lines = [
        f"【レース】{race['venue']}{rn} / {race['surface']}{race['distance']}m（{race['dist_class']}）/ {race['class']} / {race['headcount']}頭",
        "",
        "| 馬番 | 馬名 | 脚質点 | 距離 | 同条件 | 近走 | 上がり | 補正 | 合計 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for h in horses:
        s = h["scores"]
        lines.append(f"| {h['num']} | {h['name']} | {s['style']} | {s['dist']} | {s['cond']} | {s['recent']} | {s['last3f']} | {s['adjust']} | {h['total']} |")
    order = ranked_order(horses)
    rank_line = " ".join(f"{i+1}位:{h['num']}番({h['total']}点)" for i, h in enumerate(order))
    lines += ["", f"【合計順位】{rank_line}"]
    print("\n".join(lines))
    if not quiet_footer:
        print("\n→ uma-markで印付けを行えます")
    return result


# ---------------------------------------------------------------- uma-mark

def parse_paddock(arg):
    """'17◎,2〇' → {17: '◎', 2: '〇'}"""
    result = {}
    if not arg:
        return result
    for token in re.split(r"[,、\s]+", arg.strip()):
        m = re.match(r"(\d+)([◎〇○▲△])", token) or re.match(r"([◎〇○▲△])(\d+)", token)
        if m:
            a, b = m.group(1), m.group(2)
            num, mark = (int(a), b) if a.isdigit() else (int(b), a)
            result[num] = mark.replace("○", "〇")
    return result


def cmd_mark(workdir, paddock_arg=None, quiet_footer=False):
    wd = Path(workdir)
    data = json.loads((wd / "score.json").read_text(encoding="utf-8"))
    race, horses = data["race"], data["horses"]
    order = ranked_order(horses)
    paddock = parse_paddock(paddock_arg)

    # パドック◎一変示唆ルール
    pad_best = next((n for n, m in paddock.items() if m == "◎"), None)
    if pad_best is not None:
        rank = next((i for i, h in enumerate(order) if h["num"] == pad_best), None)
        if rank is not None:
            if rank <= 2:          # スコア1〜3位 → ◎に選ぶ
                order.insert(0, order.pop(rank))
            elif rank <= 5:        # スコア4〜6位 → ▲に繰り上げ
                order.insert(2, order.pop(rank))
            # 7位以下 → 無視（データ優先）

    keys = ("num", "name", "popularity", "odds", "total", "scores")
    mark_labels = ["◎", "〇", "▲", "△A", "△B", "△B"]
    marks = []
    for i, label in enumerate(mark_labels):
        if i < len(order):
            marks.append({"mark": label, **{k: order[i][k] for k in keys}})

    # 穴1頭必須ルール
    ana_needed = (("未勝利" in (race.get("class") or "")) or race.get("jump")
                  or race.get("headcount", 0) >= 16 or race.get("handicap"))
    marked_nums = {m["num"] for m in marks}
    if ana_needed and not any(m["popularity"] >= 7 for m in marks if m["mark"] == "△B"):
        cand = next((h for h in order if h["num"] not in marked_nums and h["popularity"] >= 7), None)
        if cand:
            marks.append({"mark": "△B", **{k: cand[k] for k in keys}})

    # 自信度
    top = next(m for m in marks if m["mark"] == "◎")
    second = next((m for m in marks if m["mark"] == "〇"), None)
    diff = top["total"] - second["total"] if second else 99
    fav_rank = next((i + 1 for i, h in enumerate(ranked_order(horses)) if h["popularity"] == 1), None)
    if (fav_rank is not None and fav_rank >= 4) or diff <= 2:
        conf = "C"
    elif diff >= 3 and top["scores"]["cond"] >= 1:
        conf = "A"
    else:
        conf = "B"

    henge_in_b = any(m["mark"] == "△B" and m["num"] in paddock for m in marks)
    field = [{"num": h["num"], "name": h["name"], "odds": h.get("odds")} for h in horses]
    result = {"race": race, "marks": marks, "confidence": conf,
              "henge_in_anaB": henge_in_b, "paddock": paddock,
              "field": field,
              "top_popularity": top["popularity"], "score_diff_top2": diff}
    (wd / "mark.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")

    line = " / ".join(f"{m['mark']}{m['num']}番 {m['name']}" for m in marks)
    print(f"【印】\n{line}\n")
    print(f"【自信度】{conf}")
    print("理由: （AIが1〜2文で記入）\n")
    print("【各馬コメント】")
    for m in marks:
        print(f"{m['mark']}{m['name']}: （AIが1文で記入）")
    if not quiet_footer:
        print("\n→ uma-betで買い目を作れます")
    return result


# ---------------------------------------------------------------- uma-bet
# 保証配分方式（単勝のみ）
#
#   候補すべてに単勝を張り、「買った候補のどれが勝っても投資総額を上回る」ように配分する。
#   総投資 T、馬i に a_i 円、単勝オッズ o_i のとき
#     全候補で 払戻 a_i*o_i > T を満たすには a_i > T/o_i
#     総和をとると T > T*Σ(1/o_i)  ∴ Σ(1/o_i) < 1 ⇔ 合成オッズ C = 1/Σ(1/o_i) > 1.0
#   C は保証できる回収率の理論上限そのもの。
#
#   注意: 「どの馬が勝っても」は「買った候補のどれかが勝てば」の意味。
#         候補外が勝てば全損。アービトラージではない。
#         損益分岐的中率 = 1/C。これを実力で超えられなければ長期では負ける。

UNIT = 100                      # JRA最低購入単位
MIN_COMPOSITE = 1.10            # これ未満の合成オッズでは買わない
MIN_TOTAL = 200                 # 最低投資額
MAX_TOTAL = 3000                # 既定の投資上限
MIN_KEEP = 4                    # 候補の最低頭数。これを下回るまで削るなら見送る


def _inv(o):
    return 1.0 / o


def _composite(odds_list):
    d = sum(_inv(o) for o in odds_list)
    if d <= 0:
        raise ValueError("候補が空です")
    return 1.0 / d


def _alloc_for_payout(cands, target_payout):
    """どの候補が勝っても払戻が target_payout 以上になる最小の100円単位配分。"""
    return {c["num"]: max(1, math.ceil((target_payout / c["odds"]) / UNIT)) * UNIT
            for c in cands}


def _evaluate(cands, alloc):
    total = sum(alloc.values())
    rows = []
    for c in cands:
        st = alloc[c["num"]]
        pay = st * c["odds"]
        rows.append({"num": c["num"], "name": c["name"], "mark": c["mark"],
                     "odds": c["odds"], "popularity": c.get("popularity"),
                     "stake": st, "payout": pay,
                     "roi": pay / total, "profit": pay - total})
    rows.sort(key=lambda r: r["roi"])
    return {"total": total, "rows": rows, "min_roi": rows[0]["roi"],
            "max_roi": rows[-1]["roi"], "min_profit": rows[0]["profit"],
            "guaranteed": rows[0]["profit"] > 0}


def _best_plan(cands, min_total=MIN_TOTAL, max_total=MAX_TOTAL):
    """min_total〜max_total の範囲で最低回収率が最大になる配分を選ぶ。"""
    if _composite([c["odds"] for c in cands]) <= 1.0:
        return None
    best = None
    for target in range(min_total, int(max_total * 3) + UNIT, 50):
        alloc = _alloc_for_payout(cands, float(target))
        ev = _evaluate(cands, alloc)
        if not (min_total <= ev["total"] <= max_total) or not ev["guaranteed"]:
            continue
        key = (round(ev["min_roi"], 6), -ev["total"])
        if best is None or key > best["_key"]:
            ev["_key"] = key
            ev["alloc"] = alloc
            best = ev
    return best


def _trim_to_composite(cands, min_composite=MIN_COMPOSITE, min_keep=MIN_KEEP):
    """
    合成オッズが min_composite 以上になるまで、1/o の大きい馬(=人気馬)から削る。

    ただし min_keep 頭を下回ってまでは削らない。頭数を削れば合成オッズはいくらでも
    上げられるが、それは単に「人気薄だけを買う」ことであり、保証回収率が高く見えても
    的中率が伴わない。頭数を維持できないなら見送りとする。
    """
    pool, dropped = list(cands), []
    while len(pool) > min_keep:
        if _composite([c["odds"] for c in pool]) >= min_composite:
            break
        worst = max(pool, key=lambda c: _inv(c["odds"]))
        pool.remove(worst)
        dropped.append(worst)
    C = _composite([c["odds"] for c in pool]) if len(pool) >= 2 else 0.0
    ok = len(pool) >= min(min_keep, len(cands)) and C >= min_composite
    return {"kept": pool, "dropped": dropped, "composite": C, "ok": ok}


def cmd_bet(workdir, max_total=MAX_TOTAL, min_composite=MIN_COMPOSITE):
    wd = Path(workdir)
    data = json.loads((wd / "mark.json").read_text(encoding="utf-8"))
    conf = data["confidence"]

    base = [m for m in data["marks"] if m.get("odds")]
    missing = [m["num"] for m in data["marks"] if not m.get("odds")]
    if len(base) < 2:
        print("【買い目】見送り（0円）")
        print(f"理由: 単勝オッズが読み取れた印馬が{len(base)}頭しかない（要2頭以上）。")
        return {"total": 0, "bets": [], "skip": "odds_missing"}

    field = [f for f in data.get("field", []) if f.get("odds")]
    S = sum(_inv(f["odds"]) for f in field) if field else None
    p_mkt = {f["num"]: _inv(f["odds"]) / S for f in field} if S else {}

    C_all = _composite([m["odds"] for m in base])
    trim = _trim_to_composite(base, min_composite)

    if not trim["ok"]:
        print("【買い目】見送り（0円）")
        print(f"理由: 候補を{MIN_KEEP}頭まで残した状態では合成オッズが "
              f"{min_composite:.2f} に届かない"
              f"（印馬{len(base)}頭の合成オッズ {C_all:.3f}、"
              f"{len(trim['kept'])}頭まで削って {trim['composite']:.3f}）。")
        print(f"      これ以上削ると人気薄だけを買うことになり、保証回収率が高く見えても")
        print(f"      的中率が伴わない。合成オッズ1.0以下では保証配分自体が数学的に不可能。")
        result = {"confidence": conf, "total": 0, "bets": [], "skip": "low_composite",
                  "composite_all": C_all}
        (wd / "bet.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        return result

    cands = trim["kept"]
    plan = _best_plan(cands, MIN_TOTAL, max_total)
    if plan is None:
        print("【買い目】見送り（0円）")
        print(f"理由: 合成オッズ {trim['composite']:.3f} だが、"
              f"{MIN_TOTAL}〜{max_total}円の範囲で保証配分が組めなかった。")
        return {"confidence": conf, "total": 0, "bets": [], "skip": "no_alloc"}

    C = trim["composite"]
    q_star = 1.0 / C
    q_mkt = sum(p_mkt.get(c["num"], 0) for c in cands) if p_mkt else None

    result = {"confidence": conf, "composite": C, "guaranteed_roi": plan["min_roi"],
              "breakeven_hit": q_star, "market_hit": q_mkt, "overround": S,
              "total": plan["total"],
              "bets": [{"num": r["num"], "name": r["name"], "mark": r["mark"],
                        "odds": r["odds"], "amount": r["stake"],
                        "payout": r["payout"], "roi": r["roi"]} for r in plan["rows"]],
              "dropped": [{"num": d["num"], "name": d["name"], "odds": d["odds"],
                           "mark": d["mark"]} for d in trim["dropped"]]}
    (wd / "bet.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")

    if missing:
        print(f"※ 単勝オッズが読めず候補から除外: {missing}")
    if trim["dropped"]:
        d = ", ".join(f"{x['num']}番{x['name']}({x['odds']:.1f}倍{x['mark']})"
                      for x in trim["dropped"])
        print(f"【候補から除外】{d}")
        print(f"   理由: 合成オッズを {min_composite:.2f} 以上にするため（人気サイドから）")
        print()

    print(f"【候補】{len(cands)}頭 / 自信度{conf}")
    print(f"  合成オッズ        : {C:.3f} 倍　← 保証回収率の理論上限")
    print(f"  実際の保証回収率  : {plan['min_roi']*100:.1f}%（100円単位の丸め込み）")
    print(f"  損益分岐的中率    : {q_star*100:.1f}%")
    if q_mkt is not None:
        print(f"  市場が見込む的中率: {q_mkt*100:.1f}%")
        print(f"  必要優位性        : {q_star/q_mkt:.3f} 倍（= S = {S:.3f}）")
    print()

    print(f"【買い目】単勝のみ / 投資合計 {plan['total']}円")
    print("| 馬番 | 馬名 | 印 | 単勝 | 購入額 | 的中時払戻 | 回収率 | 損益 |")
    print("|---|---|---|---:|---:|---:|---:|---:|")
    for r in sorted(plan["rows"], key=lambda x: x["odds"]):
        print(f"| {r['num']} | {r['name']} | {r['mark']} | {r['odds']:.1f} | "
              f"{r['stake']}円 | {r['payout']:.0f}円 | {r['roi']*100:.0f}% | {r['profit']:+.0f}円 |")
    print()
    print(f"→ 候補のどれが勝っても {plan['min_profit']:+.0f}円 以上"
          f"（回収率 {plan['min_roi']*100:.0f}%〜{plan['max_roi']*100:.0f}%）")
    print(f"→ 候補外の馬が勝てば -{plan['total']}円（全損）")
    print()
    print("【注意】（AIが1〜2文で記入）")
    print(f"※「どの馬が勝っても勝ち越す」は「買った{len(cands)}頭のどれかが勝てば」の意味です。"
          f"アービトラージではなく、この{len(cands)}頭から1着が出る確率が{q_star*100:.0f}%を"
          "超えなければ長期では負けます。的中を保証するものではありません。")
    return result


# ---------------------------------------------------------------- main

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cmd, workdir = sys.argv[1], sys.argv[2]

    def opt(flag, cast, default):
        if flag in sys.argv:
            i = sys.argv.index(flag)
            if i + 1 < len(sys.argv):
                return cast(sys.argv[i + 1])
        return default

    paddock = opt("--paddock", str, None)
    max_total = opt("--max-total", int, MAX_TOTAL)
    min_comp = opt("--min-composite", float, MIN_COMPOSITE)

    if cmd == "score":
        cmd_score(workdir)
    elif cmd == "mark":
        cmd_mark(workdir, paddock)
    elif cmd == "bet":
        cmd_bet(workdir, max_total, min_comp)
    elif cmd == "full":
        cmd_score(workdir, quiet_footer=True)
        print("\n" + "=" * 8 + "\n")
        cmd_mark(workdir, paddock, quiet_footer=True)
        print("\n" + "=" * 8 + "\n")
        cmd_bet(workdir, max_total, min_comp)
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
