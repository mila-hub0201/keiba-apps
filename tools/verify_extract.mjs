// verify_extract.mjs — extract.js が Python 版 convert_racecard.py と同じ抽出結果を返すか照合する。
//
// 使い方: node tools/verify_extract.mjs <convert_racecard.py> <pdfjs-distのbuildディレクトリ> [作業ディレクトリ]
// 事前に tools/gen_test_pdf.py で合成PDFを作っておくこと。

import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { convertPdf, buildRaceMd } from "../js/extract.js";

const PY_CONVERT = process.argv[2];
const PDFJS_BUILD = process.argv[3];
const WORK = resolve(process.argv[4] ?? "pdf_work");
if (!PY_CONVERT || !PDFJS_BUILD) {
  console.error("usage: node tools/verify_extract.mjs <convert_racecard.py> <pdfjs build dir> [workdir]");
  process.exit(1);
}

// Node では legacy ビルドを使う(pdfjs の推奨)
const legacyPath = join(PDFJS_BUILD, "..", "legacy", "build", "pdf.mjs");
const pdfjsLib = await import(pathToFileURL(existsSync(legacyPath) ? legacyPath : join(PDFJS_BUILD, "pdf.mjs")).href);
// Node の pdfjs はファイルシステム経路で cMap を読むため素のパスを渡す
const pdfOptions = {
  cMapUrl: join(PDFJS_BUILD, "..", "cmaps") + "/",
  cMapPacked: true,
  standardFontDataUrl: join(PDFJS_BUILD, "..", "standard_fonts") + "/",
};

const pdfs = readdirSync(WORK).filter((f) => f.endsWith(".pdf"));
if (!pdfs.length) {
  console.error(`PDFが見つかりません: ${WORK}(先に gen_test_pdf.py を実行)`);
  process.exit(1);
}

let failures = 0;
for (const pdf of pdfs) {
  const pdfPath = join(WORK, pdf);
  const pyDir = join(WORK, pdf.replace(".pdf", "_py"));
  mkdirSync(pyDir, { recursive: true });
  execFileSync("python", [PY_CONVERT, pdfPath, pyDir], { encoding: "utf-8" });

  const pyEntries = readFileSync(join(pyDir, "entries.jsonl"), "utf-8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  // Windows の Python は \r\n で書くため正規化して比較する
  const pyRaceMd = readFileSync(join(pyDir, "race.md"), "utf-8").replaceAll("\r\n", "\n");

  const data = new Uint8Array(readFileSync(pdfPath));
  const jsRes = await convertPdf(pdfjsLib, data, pdfOptions);

  const errors = [];
  if (jsRes.entries.length !== pyEntries.length) {
    errors.push(`頭数: py=${pyEntries.length} js=${jsRes.entries.length}`);
  } else {
    pyEntries.forEach((pe, i) => {
      const je = jsRes.entries[i];
      for (const k of Object.keys(pe)) {
        if (k === "recent_runs") {
          pe.recent_runs.forEach((pr, ri) => {
            const jr = je.recent_runs[ri] ?? {};
            for (const rk of Object.keys(pr)) {
              if (String(pr[rk]) !== String(jr[rk] ?? "")) {
                errors.push(`[${i}].recent_runs[${ri}].${rk}: py=${JSON.stringify(pr[rk])} js=${JSON.stringify(jr[rk])}`);
              }
            }
          });
        } else if (String(pe[k]) !== String(je[k] ?? "")) {
          errors.push(`[${i}].${k}: py=${JSON.stringify(pe[k])} js=${JSON.stringify(je[k])}`);
        }
      }
    });
  }
  if (jsRes.raceMd !== pyRaceMd) {
    const pyLines = pyRaceMd.split("\n"), jsLines = jsRes.raceMd.split("\n");
    for (let i = 0; i < Math.max(pyLines.length, jsLines.length); i++) {
      if (pyLines[i] !== jsLines[i]) {
        errors.push(`race.md 行${i + 1}: py=${JSON.stringify(pyLines[i])} js=${JSON.stringify(jsLines[i])}`);
      }
    }
  }

  if (errors.length) {
    failures++;
    console.error(`\n✗ ${pdf} 不一致 ${errors.length}件:`);
    for (const e of errors.slice(0, 20)) console.error("  " + e);
  } else {
    console.log(`✓ ${pdf}: entries ${pyEntries.length}頭 + race.md 完全一致`);
  }
}

process.exit(failures ? 1 : 0);
