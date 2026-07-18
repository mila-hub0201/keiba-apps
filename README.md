# ウマフル(keiba-apps)

JRA出馬表(馬柱)PDFを読み込むと、**採点 → 印付け → 単勝の保証配分による買い目**までを
一気通貫で行うWebアプリ。Claude スキル uma-full / uma-score / uma-mark / uma-bet の
計算ロジックをそのままJavaScriptに移植したもので、**すべて端末内で完結**する
(サーバー・API・課金なし)。

## 使い方

1. ブラウザでアプリを開き、出馬表PDFをドロップ(スマホはタップして選択)
2. 採点表・印・買い目が自動で表示される
3. 必要に応じて:
   - **オッズ欄を当日オッズに修正** → 買い目が自動再計算
   - **パドック列をタップ**して ◎〇▲△ を指定 → 印・買い目に反映
   - 投資上限・合成オッズ下限を調整
4. 「結果をテキストでコピー」でスキル版と同じ形式のテキストを取得できる

### スマホ(Android)でアプリとして使う

ChromeでアプリのURLを開き、メニューから**「ホーム画面に追加」**を選ぶと
アプリとしてインストールされる(PWA)。一度開けばオフラインでも動作する。

## 構成

| パス | 役割 |
|---|---|
| `index.html` / `css/` / `js/app.js` | UI本体 |
| `js/extract.js` | PDF抽出(convert_racecard.py の移植、pdf.js使用) |
| `js/pipeline.js` | 採点・印・買い目の計算(uma_pipeline.py の1:1移植) |
| `js/comments.js` | 自信度理由・各馬コメントの定型文生成 |
| `vendor/pdfjs/` | pdf.js 4.10.38(cMap・標準フォント同梱、オフライン用) |
| `manifest.webmanifest` / `sw.js` / `icons/` | PWA(ホーム画面追加・オフライン対応) |
| `demo/` | デモデータ(合成レース) |
| `reference/skill-scripts/` | 移植元のPythonスクリプト(参照用) |
| `tools/` | 検証・生成スクリプト(下記) |

## 検証(Python版との一致確認)

計算ロジックとPDF抽出は、移植元のPythonスクリプトと出力が一致することを
機械照合してある。ロジックを変更したら再実行すること。

```bash
# 計算ロジック: 乱数生成した60レースで score/mark/bet のJSONを突き合わせ
node tools/verify_pipeline.mjs reference/skill-scripts/uma_pipeline.py <作業dir>

# PDF抽出: 座標仕様どおりの合成PDFを作って抽出結果を突き合わせ
#(要: pip install pdfplumber reportlab / npm install pdfjs-dist)
python tools/gen_test_pdf.py <作業dir>
node tools/verify_extract.mjs reference/skill-scripts/convert_racecard.py <pdfjs-distのbuildディレクトリ> <作業dir>
```

アイコンの再生成は `python tools/gen_icons.py`(要 Pillow)。

## ローカルで動かす

```bash
python -m http.server 8330
# → http://localhost:8330
```

(`file://` 直開きはモジュール読み込みが動かないため、必ずHTTPサーバー経由で)

## 免責

- 買い目の「保証」は「買った候補のどれかが勝てば投資額を上回る」配分という意味で、
  的中そのものを保証するものではない。候補外の馬が勝てば全損。
- オッズは変動するため、購入直前に合成オッズを確認すること。
- 馬券の購入は20歳以上・自己責任で。
