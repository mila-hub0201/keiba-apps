---
name: uma-full
description: 競馬の出馬表・馬柱のPDFまたは画像を添付して「全部やって」「一気に分析して」「買い目まで出して」と言われたときに使うスキル。uma-score → uma-mark → uma-bet の3ステップを自動で連続実行し、データ抽出から単勝の保証配分による買い目作成まで一気通貫で出力する。途中のコピペは不要。
---

# uma-full

採点・印付け・買い目の計算はすべて同梱スクリプト `scripts/uma_pipeline.py` が決定的に行う（ルールは uma-score / uma-mark / uma-bet と同一のものを実装済み。各SKILL.mdを読み込む必要はない）。AIの仕事はスクリプトの実行と、出力内の文章プレースホルダーを埋めることだけ。

## 手順

`SKILL_DIR` = このSKILL.mdがあるディレクトリ（bashから見えるスキルのマウントパス）。

### 1. PDF変換

```bash
python3 "$SKILL_DIR/scripts/convert_racecard.py" <アップロードPDFのフルパス> /tmp/uma_work
```

`pdfplumber` が無ければ `pip install pdfplumber --break-system-packages` してから再実行。

### 2. 一括計算（採点→印→買い目）

```bash
python3 "$SKILL_DIR/scripts/uma_pipeline.py" full /tmp/uma_work
```

オプション:

| オプション | 既定 | 説明 |
|---|---:|---|
| `--paddock "17◎,2〇"` | なし | パドック評価がある場合のみ |
| `--max-total 3000` | 3000 | 投資額の上限。上げるほど保証回収率が理論値に近づく |
| `--min-composite 1.10` | 1.10 | 要求する合成オッズの下限。上げるほど候補が絞られる |

### 3. 結果の提示

スクリプトが出力した3ブロック（採点表 / 印・自信度 / 買い目）を**そのまま**提示し、以下の「（AIが…記入）」プレースホルダーだけを埋める:

- 【自信度】の理由: 1〜2文
- 【各馬コメント】: 各馬1文（score.json の scores・run_style・last3f_avg を根拠に）
- 【注意】: 1〜2文

数値・印・金額・順位は一切変更しない。出力は3ブロックのみ。ステップ間の説明・途中経過の要約は出力しない。
