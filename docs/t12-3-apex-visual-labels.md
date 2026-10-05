# T12-3 目視ラベル（改善案評価前に固定）

2026-10-05、coder が全17本の原動画から作った overview/detail 連続静止画を確認。Pose の重ね描き・新候補の出力は使わない。T12-1で確認済みの6本の現行結果は既知であり、完全な盲検ではない。単独評価者による暫定区間で、人体重心の物理的頂点の真値ではなく、跳躍中に見える腰付近が高い区間を扱う。

単位 ms、両端を含む。ブラウザ seek 時刻であり厳密なフレームPTSではない。同一映像フレームが複数時刻に現れる。100msサンプリングに後付けの許容幅は加えない。区間幅は画角・衣服・スローの不確実性を含む。

kickflip-004 は上半身が切れ、腰も衣服で判断しにくいため低確信。除外時の集計も出す。kickflip-005 は空中の腰が画面外で判定不能。足の高い区間は約6400–7600msだが腰の正解の代用にはしない。選択時刻の正誤率の分母は16、棄却/出力の総数は17とする。

|動画|区間 ms|確信|
|---|---|---|
|ollie-001|[3250, 3400]|medium|
|ollie-002|[2100, 2300]|medium|
|ollie-003|[2450, 2600]|medium|
|kickflip-004|[6800, 7800]|low|
|kickflip-005|None|unobservable|
|kickflip-006|[2550, 2700]|medium|
|kickflip-007|[3300, 3450]|medium|
|kickflip-008|[2250, 2350]|medium|
|kickflip-009|[4600, 5000]|medium|
|kickflip-010|[4800, 5100]|medium|
|ollie-004|[1650, 1800]|medium|
|ollie-005|[2580, 2730]|medium|
|ollie-006|[4150, 4300]|medium|
|ollie-007|[1630, 1800]|medium|
|ollie-008|[1380, 1530]|medium|
|ollie-009|[2420, 2570]|medium|
|ollie-010|[5220, 5600]|medium|

再現: `node scripts/apex-study/contact-sheets.mjs`、次に `node scripts/apex-study/contact-sheets.mjs scripts/apex-study/visual-ranges.json`。生成画像は `eval/output/apex-study/`（git対象外）。detail は縦動画の黒帯を中央1/3に切り、視認しやすく拡大する。原動画のSHA256は `scripts/apex-study/visual-labels.json` に固定。比較後にラベルを変更しない。
