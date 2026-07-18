// verify_pipeline.mjs — pipeline.js が Python 版 uma_pipeline.py と同じ出力を返すか照合する。
// 乱数シード固定でレースデータを大量生成し、score/mark/bet の JSON を突き合わせる。
//
// 使い方: node tools/verify_pipeline.mjs <uma_pipeline.pyのパス> [作業ディレクトリ]

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { computeFull } from "../js/pipeline.js";

const PY_PIPELINE = process.argv[2];
const WORK = resolve(process.argv[3] ?? "verify_work");
if (!PY_PIPELINE) {
  console.error("usage: node tools/verify_pipeline.mjs <uma_pipeline.py> [workdir]");
  process.exit(1);
}

// ---------------------------------------------------------------- 乱数(シード固定)
let seed = 20260718;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ---------------------------------------------------------------- ケース生成
const VENUES = ["函館", "札幌", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"];
const CLASSES = ["未勝利", "新馬", "1勝クラス", "2勝クラス", "3勝クラス", "オープン", "G3", "G1"];

function genRun(surface) {
  // uma-full 形式(構造化フィールドあり)と layout 形式(rawのみ)を混ぜる
  const venue = pick(VENUES);
  const dist = pick([1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600]);
  const surf = rnd() < 0.75 ? surface : (surface === "芝" ? "ダ" : "芝");
  const finish = rint(1, 18);
  const p1 = rint(1, 16), p2 = rint(1, 16), p3 = rint(1, 16);
  const pos = rnd() < 0.85 ? `${p1}-${p2}${rnd() < 0.5 ? `-${p3}` : ""}` : "";
  const l3f = (rnd() < 0.85) ? (33 + rnd() * 5).toFixed(1) : "";
  const margin = (rnd() < 0.7) ? (rnd() * 2.2).toFixed(1) : "";
  const cls = pick(CLASSES);
  const parts = [`2026.0${rint(1, 6)}.${rint(10, 28)}`, venue, `${dist}${surf}`, cls,
                 `${finish}着`];
  if (pos) parts.push(pos);
  if (l3f) parts.push(`3F${l3f}`);
  if (margin) parts.push(`(${margin})`);
  const raw = parts.join(" ");

  if (rnd() < 0.5) {
    // 構造化フィールド付き(uma-full 版 convert_racecard の出力相当)
    const r = { raw };
    if (rnd() < 0.9) r.finish = String(finish);
    if (pos && rnd() < 0.9) r.position = pos;
    if (l3f && rnd() < 0.9) r.last3f = l3f;
    if (margin && rnd() < 0.9) r.margin = margin;
    if (rnd() < 0.9) { r.distance = String(dist); r.surface = surf; }
    if (rnd() < 0.9) r.course = venue;
    if (rnd() < 0.15) r.surface = ""; // 空文字キー(setdefault挙動の確認)
    return r;
  }
  return { raw };
}

function genCase(idx) {
  const venue = pick(VENUES);
  const surface = pick(["芝", "ダ"]);
  const dist = pick([1200, 1400, 1600, 1800, 2000, 2400, 2600]);
  const cls = pick(CLASSES);
  const head = pick([5, 8, 12, 14, 16, 18]);
  const handicap = rnd() < 0.25;
  const jump = rnd() < 0.1;

  const lines = ["## Race", "",
    `- distance: ${dist}`,
    `- surface: ${surface}`,
    `- venue: ${venue}`,
    `- class: ${cls}`,
    `- race_number: ${rint(1, 12)}`,
  ];
  if (handicap) lines.push("- condition: ハンデ");
  if (jump) lines.push("- race_name: テスト障害ステークス");
  const raceMd = lines.join("\n") + "\n";

  const pops = Array.from({ length: head }, (_, i) => i + 1);
  // 人気をシャッフル
  for (let i = pops.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pops[i], pops[j]] = [pops[j], pops[i]];
  }

  const entries = [];
  for (let n = 1; n <= head; n++) {
    const nRuns = rint(0, 4);
    const runs = Array.from({ length: nRuns }, () => genRun(surface));
    const odds = rnd() < 0.12 ? "" :
      (pops[n - 1] <= 3 ? (1.2 + rnd() * 6) : (2 + rnd() * 80)).toFixed(1);
    const e = {
      horse_number: String(n),
      horse_name: `テスト馬${idx}の${n}`,
      popularity: rnd() < 0.06 ? "" : String(pops[n - 1]),
      odds,
      recent_runs: runs,
    };
    if (rnd() < 0.5) e.body_weight = `${rint(420, 540)}kg(${pick(["+", "-"])}${rint(0, 14)})`;
    else if (rnd() < 0.3) e.record_prize_weight = `${rint(420, 540)}(${pick(["+", "-"])}${rint(0, 14)})`;
    entries.push(e);
  }

  // オプション(ケース番号で決定的に変える)
  const paddocks = [null, null, null, "3◎", `${rint(1, head)}◎,${rint(1, head)}〇`,
                    `◎${rint(1, head)} ○${rint(1, head)}`, "▲2、△5"];
  const opts = {
    paddock: paddocks[idx % paddocks.length],
    maxTotal: [3000, 3000, 5000, 2000, 10000][idx % 5],
    minComposite: [1.10, 1.10, 1.05, 1.30, 1.20][idx % 5],
  };
  return { raceMd, entries, opts };
}

// ---------------------------------------------------------------- 比較
let failures = 0;
function approxEqual(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return true;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

// Python 側に存在するキーだけを再帰比較する
function diff(py, js, path, errors) {
  if (py === null || typeof py !== "object") {
    if (!approxEqual(py, js)) errors.push(`${path}: py=${JSON.stringify(py)} js=${JSON.stringify(js)}`);
    return;
  }
  if (Array.isArray(py)) {
    if (!Array.isArray(js) || js.length !== py.length) {
      errors.push(`${path}: 配列長 py=${py.length} js=${Array.isArray(js) ? js.length : typeof js}`);
      return;
    }
    py.forEach((v, i) => diff(v, js[i], `${path}[${i}]`, errors));
    return;
  }
  if (js === null || typeof js !== "object") {
    errors.push(`${path}: py=object js=${JSON.stringify(js)}`);
    return;
  }
  for (const k of Object.keys(py)) {
    diff(py[k], js[k], `${path}.${k}`, errors);
  }
}

// ---------------------------------------------------------------- 実行
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const N = 60;
for (let i = 0; i < N; i++) {
  const dir = join(WORK, `case_${String(i).padStart(2, "0")}`);
  mkdirSync(dir, { recursive: true });
  const { raceMd, entries, opts } = genCase(i);
  writeFileSync(join(dir, "race.md"), raceMd, "utf-8");
  writeFileSync(join(dir, "entries.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

  // Python 版を実行
  const args = [PY_PIPELINE, "full", dir];
  if (opts.paddock) args.push("--paddock", opts.paddock);
  args.push("--max-total", String(opts.maxTotal), "--min-composite", String(opts.minComposite));
  let pyOut;
  try {
    pyOut = execFileSync("python", args, { encoding: "utf-8" });
  } catch (err) {
    console.error(`case ${i}: python 実行失敗\n${err.stderr ?? err}`);
    failures++;
    continue;
  }

  // JS 版を実行
  const jsRes = computeFull(entries, raceMd, opts);

  const errors = [];
  const pyScore = JSON.parse(readFileSync(join(dir, "score.json"), "utf-8"));
  diff(pyScore, jsRes.score, "score", errors);
  const pyMark = JSON.parse(readFileSync(join(dir, "mark.json"), "utf-8"));
  diff(pyMark, jsRes.mark, "mark", errors);

  const betPath = join(dir, "bet.json");
  if (existsSync(betPath)) {
    const pyBet = JSON.parse(readFileSync(betPath, "utf-8"));
    diff(pyBet, jsRes.bet, "bet", errors);
  } else {
    // bet.json が無い = 見送り(odds_missing / no_alloc)。JS も同じ見送り種別のはず
    if (!["odds_missing", "no_alloc"].includes(jsRes.bet.skip)) {
      errors.push(`bet: python は見送り(ファイルなし)だが js.skip=${jsRes.bet.skip}`);
    }
    if (!pyOut.includes("見送り")) {
      errors.push("bet: bet.json が無いのに python 出力に『見送り』が無い");
    }
  }

  if (errors.length) {
    failures++;
    console.error(`\n✗ case ${i} (${dir}) 不一致 ${errors.length}件:`);
    for (const e of errors.slice(0, 10)) console.error("  " + e);
  }
}

if (failures === 0) {
  console.log(`✓ 全${N}ケースで Python 版と JS 版の出力が一致`);
} else {
  console.error(`\n${failures}/${N} ケースで不一致`);
  process.exit(1);
}
