// comments.js — スキル版でAIが書いていた文章を定型文で組み立てる。
// score.json 相当のデータ(scores・run_style・last3f_avg)だけを根拠にする。

/** 自信度の理由(1〜2文)。 */
export function confidenceReason(mark, score) {
  const { confidence, score_diff_top2: diff, marks } = mark;
  const top = marks.find((m) => m.mark === "◎");
  const order = [...score.horses].sort((a, b) => b.total - a.total);
  const favRank = order.findIndex((h) => h.popularity === 1) + 1;

  const parts = [];
  if (confidence === "A") {
    parts.push(`スコア1位と2位の差が${diff}点と大きく、◎${top.name}は同条件での実績も備えている。`);
  } else if (confidence === "C") {
    if (favRank >= 4) parts.push(`1番人気馬のスコアが${favRank}位にとどまり、波乱含みの一戦。`);
    if (diff <= 2) parts.push(`上位のスコア差が${diff}点しかなく混戦模様。`);
  } else {
    parts.push(`◎${top.name}が上位だがスコア差は${diff}点で、決め手までは欠く標準的な信頼度。`);
  }
  return parts.join("");
}

/** 各馬コメント(1文)。scores・run_style・last3f_avg を根拠に組み立てる。 */
export function horseComment(m, score) {
  const h = score.horses.find((x) => x.num === m.num);
  if (!h) return "";
  const s = h.scores;
  const good = [];
  const bad = [];

  if (s.cond >= 3) good.push("当該コース・同条件で複勝圏の実績");
  else if (s.cond === 2) good.push("同条件で複勝圏の実績");
  if (s.dist === 2 && s.cond < 2) good.push("この距離帯で好走歴");
  if (s.recent === 3) good.push("前走勝ちの勢い");
  else if (s.recent === 2) good.push("前走連対と好調");
  if (s.last3f === 3) good.push("上がり最速級の末脚");
  else if (s.last3f >= 1) good.push("上がり上位の脚");
  if (s.recent === -1) bad.push("前走の大敗");
  if (s.adjust < 0) bad.push("馬体重の大幅増減か昇級初戦");

  const style = h.run_style;
  let sentence = `${style}型で`;
  if (good.length) sentence += good.slice(0, 2).join("と") + "が強み";
  else sentence += "決め手となる実績は乏しい";
  if (bad.length) sentence += `だが${bad.join("と")}が割引材料`;
  return sentence + "。";
}

/** 買い目の【注意】(1〜2文)。 */
export function betCaution(bet) {
  if (bet.skip) return "";
  const parts = [
    "オッズは発走直前まで変動するため、購入直前に合成オッズが下限を維持しているか確認すること。",
  ];
  if (bet.dropped?.length) {
    parts.push(`人気側の${bet.dropped.length}頭を外した分、的中率は印通りより下がっている点に注意。`);
  }
  return parts.join("");
}

/** 見送り理由の説明文。 */
export function skipReason(bet) {
  if (bet.skip === "odds_missing") {
    return `単勝オッズが読み取れた印馬が${(6 - (bet.missing?.length ?? 0))}頭未満のため見送り(要2頭以上)。オッズ欄を編集して再計算できます。`;
  }
  if (bet.skip === "low_composite") {
    return `候補を${bet.min_keep}頭まで残した状態では合成オッズが ${bet.min_composite.toFixed(2)} に届かない` +
      `(印馬の合成オッズ ${bet.composite_all.toFixed(3)}、${bet.trim_kept}頭まで削って ${bet.trim_composite.toFixed(3)})。` +
      "これ以上削ると人気薄だけを買うことになり、保証回収率が高く見えても的中率が伴わない。";
  }
  if (bet.skip === "no_alloc") {
    return `合成オッズ ${bet.composite.toFixed(3)} だが、${bet.min_total}〜${bet.max_total}円の範囲で保証配分が組めなかった。`;
  }
  return "";
}
