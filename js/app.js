// app.js — ウマフル本体。PDF読込→採点→印→買い目のUI制御。
// 計算は pipeline.js / 抽出は extract.js に委譲し、ここでは状態管理と描画のみ行う。

import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { convertPdf } from "./extract.js";
import { computeScore, computeMark, computeBet, rankedOrder, MIN_TOTAL } from "./pipeline.js";
import { confidenceReason, horseComment, betCaution, skipReason } from "./comments.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const PDF_OPTIONS = {
  cMapUrl: new URL("../vendor/pdfjs/cmaps/", import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
};

const $ = (id) => document.getElementById(id);

const state = {
  entries: null,   // 抽出した出走馬(オッズはユーザー編集可)
  raceMd: "",
  paddock: {},     // 馬番 -> ◎〇▲△
  score: null,
  mark: null,
  bet: null,
};

// ---------------------------------------------------------------- 計算と再描画

function paddockString() {
  const tokens = Object.entries(state.paddock)
    .filter(([, m]) => m)
    .map(([num, m]) => `${num}${m}`);
  return tokens.length ? tokens.join(",") : null;
}

function recompute() {
  if (!state.entries) return;
  const maxTotal = parseInt($("max-total").value, 10) || 3000;
  const minComposite = parseFloat($("min-composite").value) || 1.10;
  state.score = computeScore(state.entries, state.raceMd);
  state.mark = computeMark(state.score, paddockString());
  state.bet = computeBet(state.mark, Math.max(maxTotal, MIN_TOTAL), minComposite);
  render();
}

function render() {
  renderRace();
  renderScore();
  renderMark();
  renderBet();
  for (const id of ["race-card", "score-card", "mark-card", "bet-settings-card", "bet-card"]) {
    $(id).hidden = false;
  }
  $("result-actions").hidden = false;
  $("upload-card").hidden = true;
}

function fmtOdds(o) {
  return (o === null || o === undefined) ? "—" : Number(o).toFixed(1);
}
function fmtPop(p) {
  return p === 99 ? "—" : `${p}`;
}
function fmtYen(n) {
  return `${Math.round(n).toLocaleString("ja-JP")}円`;
}

function renderRace() {
  const r = state.score.race;
  const rn = r.race_number ? `${r.race_number}R` : "";
  $("race-line").textContent =
    `${r.venue}${rn} / ${r.surface}${r.distance ?? "?"}m(${r.dist_class})/ ${r.class || "クラス不明"} / ${r.headcount}頭`;
}

const PAD_CYCLE = ["", "◎", "〇", "▲", "△"];
const PAD_NAMES = { "": "指定なし", "◎": "本命", "〇": "対抗", "▲": "単穴", "△": "連下" };

function renderScore() {
  const table = $("score-table");
  table.innerHTML = "";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>馬番</th><th>馬名</th><th>人気</th><th>単勝</th><th>脚質</th>" +
    "<th>距離</th><th>同条件</th><th>近走</th><th>上がり</th><th>補正</th><th>合計</th><th>パドック</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const order = rankedOrder(state.score.horses);
  const top3 = new Set(order.slice(0, 3).map((h) => h.num));

  for (const h of state.score.horses) {
    const s = h.scores;
    const tr = document.createElement("tr");
    if (top3.has(h.num)) tr.classList.add("top3");

    const oddsInput = document.createElement("input");
    oddsInput.className = "odds-input";
    oddsInput.type = "text";
    oddsInput.inputMode = "decimal";
    oddsInput.value = h.odds ?? "";
    oddsInput.placeholder = "—";
    oddsInput.setAttribute("aria-label", `${h.num}番の単勝オッズ`);
    oddsInput.addEventListener("focus", () => oddsInput.select());
    oddsInput.addEventListener("change", () => {
      const e = state.entries.find((x) => String(x.horse_number).replace(/[^0-9]/g, "") === String(h.num));
      if (e) { e.odds = oddsInput.value.trim(); recompute(); }
    });

    const padMark = state.paddock[h.num] ?? "";
    const padBtn = document.createElement("button");
    padBtn.type = "button";
    padBtn.className = "pad-btn" + (padMark ? " active" : "");
    padBtn.textContent = padMark || "－";
    padBtn.setAttribute("aria-label",
      `${h.num}番${h.name}のパドック評価: ${PAD_NAMES[padMark]}。押すと次の評価に切り替え`);
    padBtn.addEventListener("click", () => {
      const cur = PAD_CYCLE.indexOf(state.paddock[h.num] ?? "");
      const next = PAD_CYCLE[(cur + 1) % PAD_CYCLE.length];
      if (next) state.paddock[h.num] = next;
      else delete state.paddock[h.num];
      recompute();
    });

    const cells = [
      `<td>${h.num}</td>`,
      `<td class="name">${escapeHtml(h.name)}</td>`,
      `<td>${fmtPop(h.popularity)}</td>`,
    ];
    tr.innerHTML = cells.join("");
    const oddsTd = document.createElement("td");
    oddsTd.appendChild(oddsInput);
    tr.appendChild(oddsTd);
    tr.insertAdjacentHTML("beforeend",
      `<td>${s.style}<small>(${h.run_style})</small></td>` +
      `<td>${s.dist}</td><td>${s.cond}</td><td>${s.recent}</td>` +
      `<td>${s.last3f}</td><td>${s.adjust}</td><td class="total">${h.total}</td>`);
    const padTd = document.createElement("td");
    padTd.appendChild(padBtn);
    tr.appendChild(padTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  $("rank-line").textContent = "【合計順位】" +
    order.map((h, i) => `${i + 1}位:${h.num}番(${h.total}点)`).join(" ");
}

function renderMark() {
  const list = $("mark-list");
  list.innerHTML = "";
  for (const m of state.mark.marks) {
    const row = document.createElement("div");
    row.className = "mark-row" + (m.mark === "◎" ? " hon" : "");
    row.innerHTML =
      `<span class="mk">${m.mark}</span>` +
      `<span class="mk-num">${m.num}番</span>` +
      `<span class="mk-name">${escapeHtml(m.name)}</span>` +
      `<span class="mk-pts">${m.total}点 / ${fmtPop(m.popularity)}人気 / ${fmtOdds(m.odds)}倍</span>`;
    list.appendChild(row);
  }

  const conf = state.mark.confidence;
  const badge = $("conf-badge");
  badge.textContent = conf;
  badge.className = `conf-badge conf-${conf}`;
  $("conf-reason").textContent = confidenceReason(state.mark, state.score);

  const ul = $("horse-comments");
  ul.innerHTML = "";
  for (const m of state.mark.marks) {
    const li = document.createElement("li");
    li.textContent = `${m.mark}${m.name}: ${horseComment(m, state.score)}`;
    ul.appendChild(li);
  }
}

function renderBet() {
  const body = $("bet-body");
  const bet = state.bet;
  body.innerHTML = "";

  if (bet.skip) {
    const div = document.createElement("div");
    div.className = "bet-skip";
    div.innerHTML = `<strong>【買い目】見送り(0円)</strong><br>${escapeHtml(skipReason(bet))}`;
    body.appendChild(div);
    return;
  }

  const stats = document.createElement("div");
  stats.className = "bet-stats";
  const statItems = [
    ["合成オッズ", `${bet.composite.toFixed(3)}倍`],
    ["保証回収率", `${(bet.guaranteed_roi * 100).toFixed(1)}%`],
    ["損益分岐的中率", `${(bet.breakeven_hit * 100).toFixed(1)}%`],
  ];
  if (bet.market_hit !== null) {
    statItems.push(["市場が見込む的中率", `${(bet.market_hit * 100).toFixed(1)}%`]);
  }
  for (const [label, value] of statItems) {
    const el = document.createElement("div");
    el.className = "stat";
    el.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>`;
    stats.appendChild(el);
  }
  body.appendChild(stats);

  if (bet.missing?.length) {
    const p = document.createElement("p");
    p.className = "bet-note";
    p.textContent = `※ 単勝オッズが読めず候補から除外: ${bet.missing.join(", ")}番(オッズ欄を入力すると候補に入ります)`;
    body.appendChild(p);
  }
  if (bet.dropped.length) {
    const p = document.createElement("p");
    p.className = "bet-note";
    p.textContent = "【候補から除外】" +
      bet.dropped.map((d) => `${d.num}番${d.name}(${d.odds.toFixed(1)}倍${d.mark})`).join(", ") +
      " — 合成オッズ確保のため人気サイドから外した";
    body.appendChild(p);
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "dense";
  table.innerHTML = "<thead><tr><th>馬番</th><th>馬名</th><th>印</th><th>単勝</th>" +
    "<th>購入額</th><th>的中時払戻</th><th>回収率</th><th>損益</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const r of [...bet.bets].sort((a, b) => a.odds - b.odds)) {
    const profit = r.payout - bet.total;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.num}</td><td class="name">${escapeHtml(r.name)}</td><td>${r.mark}</td>` +
      `<td class="amount">${r.odds.toFixed(1)}</td><td class="amount">${fmtYen(r.amount)}</td>` +
      `<td class="amount">${fmtYen(r.payout)}</td>` +
      `<td class="amount">${Math.round(r.roi * 100)}%</td>` +
      `<td class="amount ${profit >= 0 ? "profit-plus" : ""}">${profit >= 0 ? "+" : "−"}${fmtYen(Math.abs(profit))}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);

  const totalLine = document.createElement("p");
  totalLine.className = "bet-total-line";
  totalLine.textContent = `投資合計 ${fmtYen(bet.total)} / 候補${bet.bets.length}頭 / 自信度${bet.confidence}`;
  body.appendChild(totalLine);

  const guarantee = document.createElement("p");
  guarantee.className = "bet-note";
  guarantee.textContent =
    `→ 候補のどれが勝っても +${fmtYen(bet.min_profit)}以上` +
    `(回収率 ${Math.round(bet.min_roi * 100)}%〜${Math.round(bet.max_roi * 100)}%)。` +
    `候補外の馬が勝てば −${fmtYen(bet.total)}(全損)。`;
  body.appendChild(guarantee);

  const caution = document.createElement("p");
  caution.className = "bet-caution";
  caution.textContent = "【注意】" + betCaution(bet) +
    `「どの馬が勝っても勝ち越す」は「買った${bet.bets.length}頭のどれかが勝てば」の意味です。` +
    `アービトラージではなく、この${bet.bets.length}頭から1着が出る確率が` +
    `${Math.round(bet.breakeven_hit * 100)}%を超えなければ長期では負けます。的中を保証するものではありません。`;
  body.appendChild(caution);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------- テキスト出力

function buildResultText() {
  const { score, mark, bet } = state;
  const r = score.race;
  const rn = r.race_number ? `${r.race_number}R` : "";
  const lines = [];

  lines.push(`【レース】${r.venue}${rn} / ${r.surface}${r.distance}m(${r.dist_class})/ ${r.class} / ${r.headcount}頭`, "");
  lines.push("| 馬番 | 馬名 | 脚質点 | 距離 | 同条件 | 近走 | 上がり | 補正 | 合計 |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const h of score.horses) {
    const s = h.scores;
    lines.push(`| ${h.num} | ${h.name} | ${s.style} | ${s.dist} | ${s.cond} | ${s.recent} | ${s.last3f} | ${s.adjust} | ${h.total} |`);
  }
  const order = rankedOrder(score.horses);
  lines.push("", "【合計順位】" + order.map((h, i) => `${i + 1}位:${h.num}番(${h.total}点)`).join(" "));

  lines.push("", "========", "");
  lines.push("【印】", mark.marks.map((m) => `${m.mark}${m.num}番 ${m.name}`).join(" / "), "");
  lines.push(`【自信度】${mark.confidence}`);
  lines.push(`理由: ${confidenceReason(mark, score)}`, "");
  lines.push("【各馬コメント】");
  for (const m of mark.marks) lines.push(`${m.mark}${m.name}: ${horseComment(m, score)}`);

  lines.push("", "========", "");
  if (bet.skip) {
    lines.push("【買い目】見送り(0円)", `理由: ${skipReason(bet)}`);
  } else {
    lines.push(`【候補】${bet.bets.length}頭 / 自信度${bet.confidence}`);
    lines.push(`  合成オッズ: ${bet.composite.toFixed(3)}倍 / 保証回収率: ${(bet.guaranteed_roi * 100).toFixed(1)}% / 損益分岐的中率: ${(bet.breakeven_hit * 100).toFixed(1)}%`);
    lines.push("", `【買い目】単勝のみ / 投資合計 ${bet.total}円`);
    lines.push("| 馬番 | 馬名 | 印 | 単勝 | 購入額 | 的中時払戻 | 回収率 | 損益 |");
    lines.push("|---|---|---|---:|---:|---:|---:|---:|");
    for (const b of [...bet.bets].sort((a, c) => a.odds - c.odds)) {
      const profit = b.payout - bet.total;
      lines.push(`| ${b.num} | ${b.name} | ${b.mark} | ${b.odds.toFixed(1)} | ${b.amount}円 | ${Math.round(b.payout)}円 | ${Math.round(b.roi * 100)}% | ${profit >= 0 ? "+" : ""}${Math.round(profit)}円 |`);
    }
    lines.push("", `→ 候補のどれが勝っても ${bet.min_profit >= 0 ? "+" : ""}${Math.round(bet.min_profit)}円以上(回収率 ${Math.round(bet.min_roi * 100)}%〜${Math.round(bet.max_roi * 100)}%)`);
    lines.push(`→ 候補外の馬が勝てば -${bet.total}円(全損)`);
    lines.push("", `【注意】${betCaution(bet)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- 入力処理

async function loadPdf(arrayBuffer) {
  const errorBox = $("error-box");
  errorBox.hidden = true;
  document.body.classList.add("busy");
  try {
    const { entries, raceMd } = await convertPdf(pdfjsLib, new Uint8Array(arrayBuffer), PDF_OPTIONS);
    state.entries = entries;
    state.raceMd = raceMd;
    state.paddock = {};
    recompute();
  } catch (err) {
    errorBox.textContent = `読み込みに失敗しました: ${err.message}`;
    errorBox.hidden = false;
  } finally {
    document.body.classList.remove("busy");
  }
}

async function loadDemo() {
  const errorBox = $("error-box");
  errorBox.hidden = true;
  try {
    const [entriesText, raceMd] = await Promise.all([
      fetch("demo/entries.jsonl").then((r) => r.text()),
      fetch("demo/race.md").then((r) => r.text()),
    ]);
    state.entries = entriesText.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    state.raceMd = raceMd;
    state.paddock = {};
    recompute();
  } catch (err) {
    errorBox.textContent = `デモデータの読み込みに失敗しました: ${err.message}`;
    errorBox.hidden = false;
  }
}

function reset() {
  state.entries = null;
  state.paddock = {};
  for (const id of ["race-card", "score-card", "mark-card", "bet-settings-card", "bet-card"]) {
    $(id).hidden = true;
  }
  $("result-actions").hidden = true;
  $("upload-card").hidden = false;
  $("file-input").value = "";
}

function setup() {
  const dropzone = $("dropzone");
  const fileInput = $("file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (f) loadPdf(await f.arrayBuffer());
  });
  for (const ev of ["dragover", "dragenter"]) {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); });
  }
  dropzone.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) loadPdf(await f.arrayBuffer());
  });

  $("demo-btn").addEventListener("click", loadDemo);
  $("reset-btn").addEventListener("click", reset);
  $("max-total").addEventListener("change", recompute);
  $("min-composite").addEventListener("change", recompute);

  $("copy-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildResultText());
      $("copy-btn").textContent = "コピーしました ✓";
      setTimeout(() => { $("copy-btn").textContent = "結果をテキストでコピー"; }, 1500);
    } catch {
      alert("コピーに失敗しました");
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* オフライン化は任意 */ });
  }
}

setup();

// 動作テスト用フック(URLからPDFを読み込む)
window.umafull = { loadPdf, loadDemo, state };
