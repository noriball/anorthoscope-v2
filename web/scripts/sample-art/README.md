# サンプル元画像の生成スクリプト

`public/data/` のサンプル画像（5 分割＝72°用）を作るのに使ったスクリプトです。
扇形（円の 1/5）の中に絵を描き、`src/engine/wedge.ts` の `wedgeToFull` と同じ式で 360° 全周へ展開して 800×800 の PNG にします。

- `gen_samples.py` … 花・金魚・木・月と星・曼荼羅・スピログラフ・極座標チェッカー・フラワーオブライフ、
  ミヤマクワガタ／ニホンカワトンボ（作者本人の標本写真。`photos/miyama.jpg`、`photos/kawatonbo.jpg` が必要）
- `gen_art2.py` … トランプのカード面（`gen_art3.py` が使う）
- `gen_art3.py` … 3 枚→15 枚の重なるトランプ（5 回対称のシーンを 1/5 に切り出す方式）
- `cat_disc.py` … 別に作られた「猫が輪になる 5 分割像」から 72° 分を切り出して 360° 原盤にする
  （元画像 `images/9.webp` と、その円のフィット結果 `cat_circle.npy` が必要）

使い方：`python3 gen_samples.py out` / `python3 gen_art3.py out3`（Pillow と numpy が必要）。
写真・元画像はこのリポジトリには含めていません。
