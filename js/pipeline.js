// pipeline.js — uma-score / uma-mark / uma-bet のルールを決定的に計算する共通モジュール。
// スキル版 uma_pipeline.py の 1:1 移植。数値・順位・金額のロジックは変更しないこと。
// ブラウザ(ES module)と Node の両方から使える純粋関数のみで構成する。

export const VENUES = ["函館", "札幌", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"];

const CLASS_LEVELS = [
  ["G1", 7], ["GI", 7], ["G2", 6], ["GII", 6], ["G3", 5], ["GIII", 5],
  ["オープン", 4], ["OP", 4], ["3勝", 3], ["2勝", 2], ["1勝", 1],
  ["未勝利", 0], ["新馬", 0],
];

// Python の truthiness を再現する(None/0/""/NaN は偽)
function truthy(v) {
  return !(v === null || v === undefined || v === 0 || v === "" ||
           (typeof v === "number" && Number.isNaN(v)));
}

// Python round() 相当(偶数丸め)。doubleのビット表現から正確な10進値で丸める。
// 浮動小数の掛け算で近似すると境界ちょうどの値でPythonとずれるため、BigIntで厳密に計算する
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x) || x === 0) return x;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = (bits >> 63n) ? -1 : 1;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & 0xfffffffffffffn;
  let exp;
  if (expBits === 0) { exp = 1 - 1075; } else { mant |= 0x10000000000000n; exp = expBits - 1075; }
  // |x| = mant * 2^exp を 10^nd 倍して整数商・余りを厳密に求める
  const p = 10n ** BigInt(nd);
  let num, den;
  if (exp >= 0) { num = mant * p << BigInt(exp); den = 1n; }
  else { num = mant * p; den = 1n << BigInt(-exp); }
  let q = num / den;
  const twiceRem = (num % den) * 2n;
  if (twiceRem > den || (twiceRem === den && (q & 1n) === 1n)) q += 1n;
  return sign * Number(q) / Number(p);
}

export function distClass(d) {
  if (d === null || d === undefined) return "";
  if (d <= 1400) return "短距離";
  if (d <= 1800) return "マイル";
  if (d <= 2400) return "中距離";
  return "長距離";
}

export function classLevel(text) {
  if (!truthy(text)) return null;
  for (const [key, lv] of CLASS_LEVELS) {
    if (String(text).includes(key)) return lv;
  }
  return null;
}

export function toInt(v) {
  const s = String(v ?? "").replace(/[^0-9]/g, "");
  return s ? parseInt(s, 10) : null;
}

export function toFloat(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

// ---------------------------------------------------------------- 入力の正規化

export function normalizeRun(r) {
  const raw = r.raw ?? "";
  const joined = raw.replaceAll(" ", "");
  const out = { ...r };

  if (out.finish !== null && out.finish !== undefined) {
    out.finish = toInt(out.finish);
  }
  if (out.finish === null || out.finish === undefined) {
    const cands = [...joined.matchAll(/(\d{1,2})着/g)]
      .map((m) => parseInt(m[1], 10)).filter((x) => x <= 18);
    out.finish = cands.length ? cands[0] : null;
  }

  if (!truthy(out.surface) || !truthy(out.distance)) {
    const m = joined.match(/(\d{3,4})(芝|ダ)/) || joined.match(/(芝|ダ)(\d{3,4})/);
    if (m) {
      const [g1, g2] = [m[1], m[2]];
      // Python の setdefault と同じく「キーが無いときだけ」入れる
      if (g1 === "芝" || g1 === "ダ") {
        if (!("surface" in out)) out.surface = g1;
        if (!("distance" in out)) out.distance = g2;
      } else {
        if (!("distance" in out)) out.distance = g1;
        if (!("surface" in out)) out.surface = g2;
      }
    }
  }
  out.distance = toInt(out.distance);

  if (!truthy(out.course)) {
    const m = joined.match(new RegExp("(" + VENUES.join("|") + ")"));
    if (m) out.course = m[1];
  }

  if (!truthy(out.position)) {
    const m = raw.match(/(?:^|\s)(\d{1,2}(?:-\d{1,2}){1,3})(?:\s|$)/);
    if (m) out.position = m[1];
  }

  if (!truthy(out.last3f)) {
    const m = raw.match(/3\s*F\s*(\d{2}\.\d)/) || raw.trim().match(/(\d{2}\.\d)\s*$/);
    if (m) out.last3f = m[1];
  }
  out.last3f = toFloat(out.last3f);

  if (!truthy(out.margin)) {
    const m = joined.match(/\((\d+\.\d+)\)/);
    if (m) out.margin = m[1];
  }
  out.margin = toFloat(out.margin);

  out.class_level = classLevel(joined);
  out.has_data = Boolean(joined || raw) && out.finish !== null;
  return out;
}

export function normalizeEntry(e) {
  const out = { ...e };
  out.horse_number = toInt(e.horse_number);
  out.popularity = toInt(e.popularity) || 99; // 不明は99扱い
  out.odds = toFloat(e.odds); // 単勝オッズ。買い目(uma-bet)で使用
  const weightText = (truthy(e.body_weight) ? e.body_weight : e.record_prize_weight) ?? "";
  const m = String(weightText).match(/\(([+-]?\d+)\)/);
  out.weight_change = m ? Math.abs(parseInt(m[1], 10)) : null;
  const runs = (e.recent_runs ?? []).map(normalizeRun);
  out.recent_runs = runs.filter((r) => r.has_data);
  return out;
}

export function parseRace(raceMdText, nEntries) {
  const info = {};
  for (const line of raceMdText.split("\n")) {
    const m = line.trim().match(/^-\s*([\p{L}\p{N}_]+):\s*(.+)/u);
    if (m) info[m[1]] = m[2].trim();
  }
  const text = raceMdText;
  let distance = toInt(info.distance);
  if (distance === null) {
    const m = text.match(/(\d{3,4})m/);
    distance = m ? toInt(m[1]) : null;
  }
  const surfaceSrc = truthy(info.surface) ? info.surface : text;
  const surface = surfaceSrc.includes("ダ") ? "ダ" : (surfaceSrc.includes("芝") ? "芝" : "");
  const venue = truthy(info.venue) ? info.venue : (VENUES.find((v) => text.includes(v)) ?? "");
  const clsCands = ["未勝利", "新馬", "1勝クラス", "2勝クラス", "3勝クラス", "オープン", "G1", "G2", "G3"];
  const cls = truthy(info.class) ? info.class : (clsCands.find((c) => text.includes(c)) ?? "");
  return {
    venue,
    distance,
    dist_class: distClass(distance),
    surface,
    class: cls,
    class_level: classLevel(cls),
    race_number: info.race_number ?? "",
    handicap: text.includes("ハンデ"),
    jump: text.includes("障害"),
    headcount: nEntries,
  };
}

// ---------------------------------------------------------------- uma-score

const RUN_STYLE_TABLE = {
  // 脚質: [馬番1-4, 馬番5-9, 馬番10以上]
  "逃げ": [6, 4, 2],
  "先行": [5, 4, 3],
  "差し": [3, 4, 3],
  "追込": [3, 4, 4],
};

export function runStyle(entry) {
  // 前走(無ければ以降で最初に通過順位が取れた走)の平均通過順位から脚質判定
  for (const r of entry.recent_runs) {
    if (truthy(r.position)) {
      const nums = r.position.split("-").map((x) => parseInt(x, 10));
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      if (avg < 2.5) return "逃げ";
      if (avg < 4.5) return "先行";
      if (avg < 7.5) return "差し";
      return "追込";
    }
  }
  return "差し"; // データ欠損時は中立的な「差し」扱い
}

function scoreStyle(entry) {
  const style = runStyle(entry);
  const n = entry.horse_number || 99;
  const col = n <= 4 ? 0 : (n <= 9 ? 1 : 2);
  return [RUN_STYLE_TABLE[style][col], style];
}

function scoreDistance(entry, race) {
  let best = 0;
  for (const r of entry.recent_runs) {
    if (r.surface !== race.surface) continue;
    if (distClass(r.distance) !== race.dist_class) continue;
    const f = r.finish;
    if (truthy(f) && f <= 3) best = Math.max(best, 2);
    else if (truthy(f) && f >= 4 && f <= 5) best = Math.max(best, 1);
  }
  return best;
}

function scoreSameCond(entry, race) {
  let best = 0;
  for (const r of entry.recent_runs) {
    if (r.surface !== race.surface) continue;
    if (distClass(r.distance) !== race.dist_class) continue;
    const f = r.finish;
    if (!truthy(f)) continue;
    const sameVenue = r.course === race.venue;
    if (sameVenue && f <= 3) best = Math.max(best, 3);
    else if (sameVenue && f >= 4 && f <= 5) best = Math.max(best, 1);
    else if (!sameVenue && f <= 3) best = Math.max(best, 2);
  }
  return best;
}

function scoreRecent(entry) {
  const runs = entry.recent_runs;
  if (!runs.length) return 0;
  const r = runs[0];
  const f = r.finish;
  const margin = r.margin;
  if (f === 1) return 3;
  if (f === 2 || f === 3) return 2;
  if (f !== null && (f >= 10 || (margin !== null && margin >= 1.5))) return -1;
  if (f === 4 || f === 5) {
    // 着差不明は 0.5秒超扱い(保守的)
    return (margin !== null && margin <= 0.5) ? 1 : 0;
  }
  return 0;
}

function last3fAvg(entry, race) {
  const vals = entry.recent_runs
    .filter((r) => truthy(r.last3f) && r.surface === race.surface)
    .map((r) => r.last3f);
  return vals.length ? pyRound(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null;
}

function scoreAdjust(entry, race) {
  let s = 0;
  if (entry.weight_change !== null && entry.weight_change !== undefined && entry.weight_change >= 10) s -= 1;
  const runs = entry.recent_runs;
  if (runs.length && runs[0].class_level !== null && race.class_level !== null) {
    if (race.class_level > runs[0].class_level) s -= 1; // 昇級初戦
  }
  for (const r of runs) {
    if (r.course === race.venue && r.surface === race.surface &&
        distClass(r.distance) === race.dist_class &&
        truthy(r.finish) && r.finish <= 3) {
      s += 1;
      break;
    }
  }
  return Math.max(s, -2);
}

export function rankedOrder(horses) {
  // 合計降順。同点は 同条件点 → 近走点 → 人気 で決める(安定ソート)
  return [...horses].sort((a, b) =>
    (b.total - a.total) ||
    (b.scores.cond - a.scores.cond) ||
    (b.scores.recent - a.scores.recent) ||
    (a.popularity - b.popularity));
}

/** entries.jsonl の各行(オブジェクト配列)と race.md のテキストから採点する。 */
export function computeScore(entriesRaw, raceMdText) {
  const entries = entriesRaw.map(normalizeEntry);
  const race = parseRace(raceMdText, entries.length);

  // 上がり3F 全馬ランキング(同馬場のみ・昇順)
  const avgs = new Map(entries.map((e) => [e.horse_number, last3fAvg(e, race)]));
  const rankedVals = [...new Set([...avgs.values()].filter((v) => v !== null))].sort((a, b) => a - b);
  const l3fPts = { 1: 3, 2: 2, 3: 1 };

  const horses = [];
  for (const e of entries) {
    const [stylePt, style] = scoreStyle(e);
    const avg = avgs.get(e.horse_number) ?? null;
    const rank = avg !== null ? rankedVals.indexOf(avg) + 1 : null;
    const scores = {
      style: stylePt,
      dist: scoreDistance(e, race),
      cond: scoreSameCond(e, race),
      recent: scoreRecent(e),
      last3f: truthy(rank) ? (l3fPts[rank] ?? 0) : 0,
      adjust: scoreAdjust(e, race),
    };
    horses.push({
      num: e.horse_number,
      name: e.horse_name ?? "",
      popularity: e.popularity,
      odds: e.odds ?? null,
      run_style: style,
      last3f_avg: avg,
      scores,
      total: Object.values(scores).reduce((a, b) => a + b, 0),
    });
  }
  return { race, horses };
}

// ---------------------------------------------------------------- uma-mark

export function parsePaddock(arg) {
  // '17◎,2〇' → {17: '◎', 2: '〇'}
  const result = {};
  if (!truthy(arg)) return result;
  for (const token of arg.trim().split(/[,、\s]+/)) {
    const m = token.match(/^(\d+)([◎〇○▲△])/) || token.match(/^([◎〇○▲△])(\d+)/);
    if (m) {
      const [a, b] = [m[1], m[2]];
      const [num, mark] = /^\d+$/.test(a) ? [parseInt(a, 10), b] : [parseInt(b, 10), a];
      result[num] = mark.replace("○", "〇");
    }
  }
  return result;
}

/** score(computeScoreの戻り値)とパドック文字列から印・自信度を決める。 */
export function computeMark(scoreData, paddockArg = null) {
  const { race, horses } = scoreData;
  const order = rankedOrder(horses);
  const paddock = parsePaddock(paddockArg);

  // パドック◎一変示唆ルール
  const padBest = Object.entries(paddock).find(([, m]) => m === "◎")?.[0];
  if (padBest !== undefined) {
    const padNum = parseInt(padBest, 10);
    const rank = order.findIndex((h) => h.num === padNum);
    if (rank !== -1) {
      if (rank <= 2) {              // スコア1〜3位 → ◎に選ぶ
        order.splice(0, 0, ...order.splice(rank, 1));
      } else if (rank <= 5) {       // スコア4〜6位 → ▲に繰り上げ
        order.splice(2, 0, ...order.splice(rank, 1));
      }
      // 7位以下 → 無視(データ優先)
    }
  }

  const keys = ["num", "name", "popularity", "odds", "total", "scores"];
  const pick = (h) => Object.fromEntries(keys.map((k) => [k, h[k]]));
  const markLabels = ["◎", "〇", "▲", "△A", "△B", "△B"];
  const marks = [];
  markLabels.forEach((label, i) => {
    if (i < order.length) marks.push({ mark: label, ...pick(order[i]) });
  });

  // 穴1頭必須ルール
  const anaNeeded = (race.class ?? "").includes("未勝利") || race.jump ||
    (race.headcount ?? 0) >= 16 || race.handicap;
  const markedNums = new Set(marks.map((m) => m.num));
  if (anaNeeded && !marks.some((m) => m.mark === "△B" && m.popularity >= 7)) {
    const cand = order.find((h) => !markedNums.has(h.num) && h.popularity >= 7);
    if (cand) marks.push({ mark: "△B", ...pick(cand) });
  }

  // 自信度
  const top = marks.find((m) => m.mark === "◎");
  const second = marks.find((m) => m.mark === "〇") ?? null;
  const diff = second ? top.total - second.total : 99;
  const favIdx = rankedOrder(horses).findIndex((h) => h.popularity === 1);
  const favRank = favIdx !== -1 ? favIdx + 1 : null;
  let conf;
  if ((favRank !== null && favRank >= 4) || diff <= 2) conf = "C";
  else if (diff >= 3 && top.scores.cond >= 1) conf = "A";
  else conf = "B";

  const hengeInB = marks.some((m) => m.mark === "△B" && (m.num in paddock));
  const field = horses.map((h) => ({ num: h.num, name: h.name, odds: h.odds ?? null }));
  return {
    race, marks, confidence: conf,
    henge_in_anaB: hengeInB, paddock,
    field,
    top_popularity: top.popularity, score_diff_top2: diff,
  };
}

// ---------------------------------------------------------------- uma-bet
// 保証配分方式(単勝のみ)
//
//   候補すべてに単勝を張り、「買った候補のどれが勝っても投資総額を上回る」ように配分する。
//   総投資 T、馬i に a_i 円、単勝オッズ o_i のとき
//     全候補で 払戻 a_i*o_i > T を満たすには a_i > T/o_i
//     総和をとると T > T*Σ(1/o_i)  ∴ Σ(1/o_i) < 1 ⇔ 合成オッズ C = 1/Σ(1/o_i) > 1.0
//   C は保証できる回収率の理論上限そのもの。
//
//   注意: 「どの馬が勝っても」は「買った候補のどれかが勝てば」の意味。
//         候補外が勝てば全損。アービトラージではない。
//         損益分岐的中率 = 1/C。これを実力で超えられなければ長期では負ける。

export const UNIT = 100;            // JRA最低購入単位
export const MIN_COMPOSITE = 1.10;  // これ未満の合成オッズでは買わない
export const MIN_TOTAL = 200;       // 最低投資額
export const MAX_TOTAL = 3000;      // 既定の投資上限
export const MIN_KEEP = 4;          // 候補の最低頭数。これを下回るまで削るなら見送る

const inv = (o) => 1.0 / o;

function composite(oddsList) {
  const d = oddsList.reduce((a, o) => a + inv(o), 0);
  if (d <= 0) throw new Error("候補が空です");
  return 1.0 / d;
}

function allocForPayout(cands, targetPayout) {
  // どの候補が勝っても払戻が targetPayout 以上になる最小の100円単位配分
  const alloc = {};
  for (const c of cands) {
    alloc[c.num] = Math.max(1, Math.ceil((targetPayout / c.odds) / UNIT)) * UNIT;
  }
  return alloc;
}

function evaluate(cands, alloc) {
  const total = Object.values(alloc).reduce((a, b) => a + b, 0);
  const rows = cands.map((c) => {
    const st = alloc[c.num];
    const pay = st * c.odds;
    return {
      num: c.num, name: c.name, mark: c.mark,
      odds: c.odds, popularity: c.popularity ?? null,
      stake: st, payout: pay,
      roi: pay / total, profit: pay - total,
    };
  });
  rows.sort((a, b) => a.roi - b.roi);
  return {
    total, rows, min_roi: rows[0].roi,
    max_roi: rows[rows.length - 1].roi, min_profit: rows[0].profit,
    guaranteed: rows[0].profit > 0,
  };
}

function bestPlan(cands, minTotal = MIN_TOTAL, maxTotal = MAX_TOTAL) {
  // minTotal〜maxTotal の範囲で最低回収率が最大になる配分を選ぶ
  if (composite(cands.map((c) => c.odds)) <= 1.0) return null;
  let best = null;
  for (let target = minTotal; target < Math.trunc(maxTotal * 3) + UNIT; target += 50) {
    const alloc = allocForPayout(cands, target);
    const ev = evaluate(cands, alloc);
    if (!(minTotal <= ev.total && ev.total <= maxTotal) || !ev.guaranteed) continue;
    const key = [pyRound(ev.min_roi, 6), -ev.total];
    if (best === null || key[0] > best._key[0] ||
        (key[0] === best._key[0] && key[1] > best._key[1])) {
      ev._key = key;
      ev.alloc = alloc;
      best = ev;
    }
  }
  return best;
}

function trimToComposite(cands, minComposite = MIN_COMPOSITE, minKeep = MIN_KEEP) {
  // 合成オッズが minComposite 以上になるまで、1/o の大きい馬(=人気馬)から削る。
  // ただし minKeep 頭を下回ってまでは削らない。頭数を削れば合成オッズはいくらでも
  // 上げられるが、それは単に「人気薄だけを買う」ことであり、保証回収率が高く見えても
  // 的中率が伴わない。頭数を維持できないなら見送りとする。
  const pool = [...cands];
  const dropped = [];
  while (pool.length > minKeep) {
    if (composite(pool.map((c) => c.odds)) >= minComposite) break;
    // Python max() と同じく「最大が並んだら先頭」を選ぶ
    let worst = pool[0];
    for (const c of pool) {
      if (inv(c.odds) > inv(worst.odds)) worst = c;
    }
    pool.splice(pool.indexOf(worst), 1);
    dropped.push(worst);
  }
  const C = pool.length >= 2 ? composite(pool.map((c) => c.odds)) : 0.0;
  const ok = pool.length >= Math.min(minKeep, cands.length) && C >= minComposite;
  return { kept: pool, dropped, composite: C, ok };
}

/** mark(computeMarkの戻り値)から買い目を作る。 */
export function computeBet(markData, maxTotal = MAX_TOTAL, minComposite = MIN_COMPOSITE) {
  const conf = markData.confidence;

  const base = markData.marks.filter((m) => truthy(m.odds));
  const missing = markData.marks.filter((m) => !truthy(m.odds)).map((m) => m.num);
  if (base.length < 2) {
    return {
      total: 0, bets: [], skip: "odds_missing", confidence: conf,
      missing,
      skip_reason: `単勝オッズが読み取れた印馬が${base.length}頭しかない(要2頭以上)。`,
    };
  }

  const field = (markData.field ?? []).filter((f) => truthy(f.odds));
  const S = field.length ? field.reduce((a, f) => a + inv(f.odds), 0) : null;
  const pMkt = S ? new Map(field.map((f) => [f.num, inv(f.odds) / S])) : new Map();

  const CAll = composite(base.map((m) => m.odds));
  const trim = trimToComposite(base, minComposite);

  if (!trim.ok) {
    return {
      confidence: conf, total: 0, bets: [], skip: "low_composite",
      composite_all: CAll, missing,
      trim_kept: trim.kept.length, trim_composite: trim.composite,
      min_composite: minComposite, min_keep: MIN_KEEP,
    };
  }

  const cands = trim.kept;
  const plan = bestPlan(cands, MIN_TOTAL, maxTotal);
  if (plan === null) {
    return {
      confidence: conf, total: 0, bets: [], skip: "no_alloc",
      composite: trim.composite, missing,
      min_total: MIN_TOTAL, max_total: maxTotal,
    };
  }

  const C = trim.composite;
  const qStar = 1.0 / C;
  const qMkt = pMkt.size ? cands.reduce((a, c) => a + (pMkt.get(c.num) ?? 0), 0) : null;

  return {
    confidence: conf, composite: C, guaranteed_roi: plan.min_roi,
    breakeven_hit: qStar, market_hit: qMkt, overround: S,
    total: plan.total,
    min_profit: plan.min_profit, min_roi: plan.min_roi, max_roi: plan.max_roi,
    missing,
    bets: plan.rows.map((r) => ({
      num: r.num, name: r.name, mark: r.mark,
      odds: r.odds, amount: r.stake,
      payout: r.payout, roi: r.roi,
    })),
    dropped: trim.dropped.map((d) => ({
      num: d.num, name: d.name, odds: d.odds, mark: d.mark,
    })),
  };
}

/** score→mark→bet を一括実行する。 */
export function computeFull(entriesRaw, raceMdText, { paddock = null, maxTotal = MAX_TOTAL, minComposite = MIN_COMPOSITE } = {}) {
  const score = computeScore(entriesRaw, raceMdText);
  const mark = computeMark(score, paddock);
  const bet = computeBet(mark, maxTotal, minComposite);
  return { score, mark, bet };
}
