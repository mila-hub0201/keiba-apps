// extract.js — JRA出馬表PDFを構造化データに変換する(convert_racecard.py の移植)。
// pdfplumber の extract_words 相当を pdf.js の textContent から再構成し、
// 以降の座標ベース抽出ロジックは Python 版と同じ判定を行う。
//
// 語オブジェクトは pdfplumber と同じ {text, x0, x1, top, bottom} 形式(PDFポイント、上原点)。

const VENUES_RE = "函館|札幌|福島|新潟|東京|中山|中京|京都|阪神|小倉";
const VENUES = VENUES_RE.split("|");

const cx = (w) => (w.x0 + w.x1) / 2;
const cy = (w) => (w.top + w.bottom) / 2;

function wordsIn(words, x0, x1, y0, y1) {
  return words.filter((w) => x0 <= cx(w) && cx(w) < x1 && y0 <= cy(w) && cy(w) < y1);
}

function mergeText(ws) {
  return [...ws].sort((a, b) => a.x0 - b.x0).map((w) => w.text).join("").trim();
}

function clusterRows(ws, tol = 3.0) {
  if (!ws.length) return [];
  const sorted = [...ws].sort((a, b) => cy(a) - cy(b));
  const rows = [];
  let cur = [sorted[0]];
  for (const w of sorted.slice(1)) {
    if (Math.abs(cy(w) - cy(cur[cur.length - 1])) <= tol) cur.push(w);
    else { rows.push(cur); cur = [w]; }
  }
  rows.push(cur);
  return rows;
}

// ---------------------------------------------------------------- 語の再構成

// 全角文字は幅1、半角は0.5の重みでアイテム幅を按分する(グリフ個別幅は取れないため)
function charWeight(ch) {
  return /[ -ɏ]/.test(ch) ? 0.5 : 1.0;
}

/**
 * pdf.js の textContent アイテム群から pdfplumber.extract_words 相当の語リストを作る。
 * keep_blank_chars=False と同じく空白は語の区切りとして捨てる。
 */
export function buildWords(textContent, pageHeight) {
  // 1) アイテムを空白で分割した「チャンク」に展開する
  const chunks = [];
  let pendingSpace = false;
  for (const item of textContent.items) {
    const str = item.str;
    if (!str || !str.trim()) continue;
    const t = item.transform; // [a, b, c, d, e, f]
    const fs = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
    const xStart = t[4];
    const baseline = t[5];
    // pdfplumber の top/bottom 近似(ascent 0.85 / descent 0.15)
    const top = pageHeight - (baseline + fs * 0.85);
    const bottom = pageHeight - (baseline - fs * 0.15);

    const weights = [...str].map(charWeight);
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    const scale = item.width / totalW;

    let x = xStart;
    let seg = null;
    const chars = [...str];
    for (let i = 0; i < chars.length; i++) {
      const w = weights[i] * scale;
      if (chars[i].trim() === "") {
        if (seg) { chunks.push(seg); seg = null; }
        pendingSpace = true; // 空白グリフは語の区切り(pdfplumberのkeep_blank_chars=False相当)
      } else {
        if (!seg) {
          seg = { text: "", x0: x, x1: x, top, bottom, spaceBefore: pendingSpace };
          pendingSpace = false;
        }
        seg.text += chars[i];
        seg.x1 = x + w;
      }
      x += w;
    }
    if (seg) chunks.push(seg);
  }

  // 2) 同じ行(縦位置の差3pt以内)で水平ギャップ3pt以内のチャンクを1語に結合する。
  //    ただし空白グリフを挟んだ場合はギャップが小さくても結合しない
  const words = [];
  for (const row of clusterRows(chunks, 3.0)) {
    const sorted = [...row].sort((a, b) => a.x0 - b.x0);
    let cur = null;
    for (const c of sorted) {
      if (cur && !c.spaceBefore && c.x0 - cur.x1 <= 3.0) {
        cur.text += c.text;
        cur.x1 = Math.max(cur.x1, c.x1);
        cur.top = Math.min(cur.top, c.top);
        cur.bottom = Math.max(cur.bottom, c.bottom);
      } else {
        if (cur) words.push(cur);
        cur = { ...c };
      }
    }
    if (cur) words.push(cur);
  }
  return words;
}

// ---------------------------------------------------------------- レース情報

export function parseRaceInfo(words) {
  const header = words.filter((w) => cy(w) < 90);
  const joined = [...header]
    .sort((a, b) => (cy(a) - cy(b)) || (a.x0 - b.x0))
    .map((w) => w.text).join("");
  const info = {};

  let m = joined.match(/(\d{3,4})m\s*(ダート|芝).?(右|左)?/);
  if (m) {
    info.distance = m[1];
    info.surface = m[2].includes("ダート") ? "ダ" : "芝";
    info.direction = m[3] || "";
  }

  m = joined.match(/発[⾛走]\s*([0-9:]+)/);
  if (m) info.start_time = m[1];

  for (const v of VENUES) {
    if (joined.includes(v)) { info.venue = v; break; }
  }

  for (const c of ["未勝利", "1勝クラス", "2勝クラス", "3勝クラス", "オープン", "G1", "G2", "G3"]) {
    if (joined.includes(c)) { info.class = c; break; }
  }

  m = joined.match(/(\d+)R/);
  if (m) info.race_number = m[1];

  // race_name: NNR直後の日本語文字列。数字か開催場名で打ち切る
  m = joined.match(new RegExp("\\d+R([぀-ヿ一-鿿]{2,12}?)(?:\\d|" + VENUES_RE + ")"));
  if (m) info.race_name = m[1];

  const cond = ["牝", "混合", "定量", "ハンデ", "別定"].filter((c) => joined.includes(c));
  if (cond.length) info.condition = cond.join(" ");

  return info;
}

// ---------------------------------------------------------------- 馬ごとの抽出

export function detectAnchors(words) {
  const anchors = [];
  for (const w of words) {
    if (!/^\d{1,2}$/.test(w.text)) continue;
    if (!(62 <= cx(w) && cx(w) <= 76)) continue;
    const nearby = words.filter((f) => /^\d{1,2}$/.test(f.text) &&
      46 <= cx(f) && cx(f) <= 63 && Math.abs(cy(f) - cy(w)) <= 8);
    if (nearby.length) {
      anchors.push({ frame: nearby[0].text, horse_number: w.text, anchor_y: cy(w) });
    }
  }
  return anchors.sort((a, b) => a.anchor_y - b.anchor_y);
}

function parseRecentRun(ws) {
  if (!ws.length) return {};
  const wsSorted = [...ws].sort((a, b) => (cy(a) - cy(b)) || (a.x0 - b.x0));
  const joined = wsSorted.map((w) => w.text).join("");
  const spaced = wsSorted.map((w) => w.text).join(" ");
  const r = { raw: spaced }; // uma-score が raw を参照する
  let m = joined.match(/\d{4}\.\d{2}\.\d{2}/);
  if (m) r.date = m[0];
  m = joined.match(new RegExp("(" + VENUES_RE + ")"));
  if (m) r.course = m[1];
  m = joined.match(/(\d{3,4})(芝|ダ)/);
  if (m) { r.distance = m[1]; r.surface = m[2]; }
  // finish: 1-2桁+着 で18以下の最初の値(18超は別データの混入)
  const validFinish = [...joined.matchAll(/(\d{1,2})着/g)]
    .map((x) => x[1]).filter((v) => parseInt(v, 10) <= 18);
  if (validFinish.length) r.finish = validFinish[0];
  // position (通過順): N-N(-N)(-N) 形式に完全一致する語
  const posWords = wsSorted.filter((w) => /^\d{1,2}(?:-\d{1,2}){1,3}$/.test(w.text));
  if (posWords.length) r.position = posWords[0].text;
  // last3f: XX.X 形式
  m = joined.match(/3\s*F(\d{2}\.\d)/);
  if (m) r.last3f = m[1];
  // margin
  m = joined.match(/\((\d+\.\d+)\)/);
  if (m) r.margin = m[1];
  return r;
}

function parseEntry(words, anchor, bandY0, bandY1) {
  const ay = anchor.anchor_y;
  const band = words.filter((w) => bandY0 <= cy(w) && cy(w) < bandY1);

  // ── 右側 (x=214-251): 斤量 → 性齢 / 騎手 ──
  const rightWs = wordsIn(band, 214, 251, bandY0, bandY1);
  const rightRows = clusterRows(rightWs);
  const wgtRow = rightRows.find((r) => /\d+\.?\d*k/.test(mergeText(r))) ?? null;
  let carriedWeight = "", sexColor = "", jockey = "";
  if (wgtRow) {
    const wy = cy(wgtRow[0]);
    const rowAt = (y) => rightRows.find((r) => Math.abs(cy(r[0]) - y) <= 3) ?? [];
    carriedWeight = mergeText(wgtRow);
    sexColor = mergeText(rowAt(wy - 6.0));
    jockey = mergeText(rowAt(wy + 6.0));
  }

  // ── オッズ (x=168-215): 帯内の最上段行にオッズと人気が入る ──
  const oddsWs = wordsIn(band, 168, 215, bandY0, bandY1);
  const oddsRows = clusterRows(oddsWs);
  let oddsY = ay, oddsText = "";
  if (oddsRows.length) {
    const oddsRow = oddsRows.reduce((a, b) => (cy(b[0]) < cy(a[0]) ? b : a));
    oddsY = cy(oddsRow[0]);
    oddsText = mergeText(oddsRow);
  }

  const oddsM = oddsText.match(/^(\d+(?:\.\d+)?)/);
  const popM = oddsText.match(/(\d+)番/);
  const odds = oddsM ? oddsM[1] : "";
  const pop = popM ? popM[1] : "";

  // ── 馬名: オッズと同じ行 ──
  const nameWs = wordsIn(band, 74, 168, oddsY - 3, oddsY + 3);
  const horseName = mergeText(nameWs);

  // ── 馬体重 (x=74-115, 数字+kg パターン) ──
  const leftWs = wordsIn(band, 74, 115, bandY0, bandY1);
  let bodyWeight = "";
  for (const row of clusterRows(leftWs)) {
    if (/\d{3,4}k/.test(mergeText(row))) { bodyWeight = mergeText(row); break; }
  }

  // ── 父 / 母: アンカー直下26pt以内 ──
  const sdWords = words.filter((w) => ay <= cy(w) && cy(w) < ay + 26 && 74 <= cx(w) && cx(w) < 220);
  const sireLabel = sdWords.find((w) => (w.text === "⽗" || w.text === "父") && cx(w) <= 95) ?? null;
  const damLabel = sdWords.find((w) => (w.text === "⺟" || w.text === "母") && cx(w) <= 95) ?? null;
  const sire = mergeText(sdWords.filter((w) =>
    sireLabel && Math.abs(cy(w) - cy(sireLabel)) <= 3 && cx(w) > 95));
  const dam = mergeText(sdWords.filter((w) =>
    damLabel && Math.abs(cy(w) - cy(damLabel)) <= 3 && cx(w) > 95));

  // ── 近走 (x=250-600) ──
  const slots = [["previous", 250, 346], ["two_back", 346, 426],
                 ["three_back", 426, 506], ["four_back", 506, 600]];
  const runs = [];
  for (const [slot, rx0, rx1] of slots) {
    const rws = wordsIn(band, rx0, rx1, bandY0, bandY1);
    const parsed = parseRecentRun(rws);
    parsed.slot = slot;
    runs.push(parsed);
  }

  return {
    frame: anchor.frame,
    horse_number: anchor.horse_number,
    horse_name: horseName,
    body_weight: bodyWeight,
    odds,
    popularity: pop,
    sex_color: sexColor,
    carried_weight: carriedWeight,
    jockey,
    sire,
    dam,
    recent_runs: runs,
  };
}

// ---------------------------------------------------------------- 変換本体

/** 語リストから entries / race情報 を組み立てる(テスト用に分離)。 */
export function convertFromWords(words) {
  const raceInfo = parseRaceInfo(words);
  const anchors = detectAnchors(words);

  if (!anchors.length) {
    throw new Error("馬番を検出できませんでした。JRA出馬表(馬柱)PDFか確認してください。");
  }

  const gaps = anchors.slice(1).map((a, i) => a.anchor_y - anchors[i].anchor_y);
  const medGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 36.0;

  const entries = anchors.map((anchor, i) => {
    const ay = anchor.anchor_y;
    const bandY0 = i > 0
      ? Math.max(0, (anchors[i - 1].anchor_y + ay) / 2)
      : Math.max(0, ay - medGap * 0.5);
    const bandY1 = i + 1 < anchors.length
      ? (ay + anchors[i + 1].anchor_y) / 2
      : ay + medGap * 0.9;
    return parseEntry(words, anchor, bandY0, bandY1);
  });

  return { raceInfo, entries };
}

/** Python 版と同じ形式の race.md テキストを作る(pipeline.parseRace への入力)。 */
export function buildRaceMd(raceInfo, entries) {
  const md = ["## Race", ""];
  for (const [k, v] of Object.entries(raceInfo)) {
    if (v) md.push(`- ${k}: ${v}`);
  }
  md.push("", "## Entries", "");
  const headers = ["枠", "馬番", "馬名", "馬体重", "人気", "性齢", "斤量", "騎手", "父", "母", "前走着", "前走3F"];
  md.push("| " + headers.join(" | ") + " |");
  md.push("| " + headers.map(() => "---").join(" | ") + " |");
  for (const e of entries) {
    const prev = e.recent_runs.find((r) => r.slot === "previous") ?? {};
    const row = [e.frame, e.horse_number, e.horse_name, e.body_weight,
                 e.popularity, e.sex_color, e.carried_weight, e.jockey,
                 e.sire, e.dam, prev.finish ?? "", prev.last3f ?? ""];
    md.push("| " + row.map((v) => String(v).replaceAll("|", "\\|")).join(" | ") + " |");
  }
  return md.join("\n") + "\n";
}

/**
 * PDFの ArrayBuffer から entries / raceMd を得る。
 * pdfjsLib は呼び出し側で import して渡す(ブラウザ/Node 両対応のため)。
 * options には cMapUrl / standardFontDataUrl など getDocument の追加パラメータを渡せる。
 */
export async function convertPdf(pdfjsLib, data, options = {}) {
  const doc = await pdfjsLib.getDocument({ data, ...options }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const words = buildWords(textContent, viewport.height);
    const { raceInfo, entries } = convertFromWords(words);
    return { raceInfo, entries, raceMd: buildRaceMd(raceInfo, entries) };
  } finally {
    await doc.destroy();
  }
}
