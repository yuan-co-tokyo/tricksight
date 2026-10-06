# T12-2b 表示専用Worker

2026-10-06。4872779でleader検収合格・push済み。iPhone本番の骨格描画も依頼者確認済み。18,048,818 bytesのMP4、118frame、取得1210ms/計測6077ms、READY/ASSESSABLE、同期play1/video2、移譲/描画/通常play/pixel取得成功。再生7616.44msにsample7600ms、膝161.48°・腰1.610胴長、24点描画。ブラウザ名とseek/回転の詳細は確認中。PARTIAL_SKELETONは省略した骨格点がある意味で、指標に必要な部位が揃っていれば数値は有効。既存のフラグ＋本人allowlist診断内を骨格表示へ置換した。履歴プレイヤーへの組込み（T12-2c）、Jevへの送信、時点評価は含まない。

## 実装と境界

- `pose-display.worker.ts` / `display-worker-core.ts` が固定10fpsのnormalized/world 33点と派生列をWorker内だけで保持する。full/CPU、モデルSHA検証と既存の設定を使用。finalizeでモデルをcloseし、列と移譲canvasだけを描画用に残す。
- 既存 `pose-landmarker.worker.ts` は無変更。アップロードWorkerのfinish後破棄、集計保存とS3/LLMの終端状態は維持する。`browser-analysis.ts` は既存A1フレーム源の公開exportだけ変更。
- `frame-metrics.ts` に既存のderiveFrame、可視判定、quantileを純粋な公開関数として抽出。計算式・既存4集計・algorithmVersionは変更しない。表示実装は診断用のprivate export注入に依存しない。
- Workerへの要求はinitialize / attach / detect / finalize / render / clear / dispose。応答は初期化等のACK、処理枚数、全体quality、現在sample、固定error codeだけ。`display-protocol.ts` の型と厳密なキー検査を送受信双方に適用し、点配列・時系列・任意の追加フィールドを拒否する。
- 現在sampleには再生時刻 `playbackTimestampMs` と計測時刻 `sampleTimestampMs`、名前付き `values`、欠測理由、描画点数だけを返す。valuesは膝平均角 `meanKneeAngleDeg` と腰相対高さ `hipRelativeHeightTorsoUnits` のみ。後者は（有効フレーム腰Yの80%点 − 当該腰Y）/胴長中央値で、上方向を正とする。膝は既存同様world 3D優先。成功率や採点ではない。
- 全体UNASSESSABLEでは数値をnullにする。有効な骨格部分は表示できる。部分欠測、core/lower不確実、範囲外、全体quality不足などをコードで返す。低visibility/presence、非有限/画面外の点とその接続線は描かない。高visibilityでも画面外なら省略する。
- object-containの余白・縦横比に合わせてWorkerが直接描画する。補間せず、直前sampleを100ms未満だけ使用する。欠測slot・間隔・終端を跨いで過去poseを延長しない。描画要求は最大1件進行＋最新1件で、世代番号により古いseek/resize結果を採用しない。
- disposeではモデル/列/canvas参照を解放しcanvasを縮小。mainからの取消はWorkerを即terminateし、非表示video/フレーム源をabort/closeする。detect bitmapは成功・失敗ともfinallyでclose。診断の終了・背景・unmountではBlob URLと表示video srcも解放する。OSのRSSが即時低下する保証ではない。

## 検証

- 全体52 files / 353 tests合格。新規12件でprotocolの追加点列拒否、集計との一致、欠測/100ms/終端、部分信頼度、高信頼度の画面外、contain座標、Worker内保持、古い世代破棄、dispose/初期化中取消/失敗時bitmap破棄、mainでのraw応答拒否を検証。
- `aggregate-baseline.json` は変更前0b79df6の17動画×3回=51runの集計のみ。既存ローカルevalデータを `check-metrics.ts` で再計算し、4集計を含む全集計オブジェクトとalgorithmVersionが一致。生点列をgoldenへ追加していない。
- `pnpm test:pose-integration` 合格。既存アップロード計測のChromium/WebKit/CriOS UA模擬×MP4/QuickTime MIMEの6条件が通過。QuickTime MIMEはMP4と同一bytesであり、元MOV実証ではない。
- `test-app-controller.mjs` は実controllerと表示Workerをfixtureで実行。Chromium3回: 4398/4364/4432ms、WebKit3回: 4607/4769/4721ms。すべて89frame、READY/ASSESSABLE、同期play1、video2、pixel readable/nonuniform、canvas移譲/骨格描画成功。3秒seek時のsample=3000ms、膝値、403失敗時の本文非露出と通常再生、cleanup/remount/途中破棄も確認。
- ローカル画像を両エンジンで目視し、縦動画の左右余白を除いた人物上への骨格配置を確認。ハーネスHTMLはT12-2a比較基準なので画面文言は旧版、実アプリの文言は骨格・現在値へ更新済み。
- lint、tsc成功。診断フラグ/allowlist未設定のbuild成功。`test-production-off.mjs` で実Next本番HTTPの診断/identity 404・no-store、Worker/model/S3要求なし、history/videos/newの従来login redirectを確認。
- ゲート・所有権・履歴リンクは無変更。T12-2aの実S3/iPhone第1段階成功とCORS適用状況は[記録](t12-2a-production-diagnostic.md)を更新済み。

## 検収後のiPhone確認手順

T12-2aのProductionフラグと本人allowlistをそのまま用いる。検収後のT12-2bデプロイで、Chrome/Safariそれぞれ次を確認する。署名URLのコピーやトンネルは不要。

1. 自分の小さいMP4の履歴から表示診断→「1. 動画を取得」。READY_TO_START後、別タップで「2. 計測と表示テストを開始」。FINISHEDかつanalysisStatus=READY、89frame等の枚数とqualityを確認する。READYは準備完了で、全体qualityのASSESSABLEとは別。
2. 緑の骨格が人物に重なることを目視する。動画は取得時点から通常再生可能で、計測中は骨格未準備。準備後は再生/一時停止/seekで現在値が更新される。再生時刻と計測時刻は別表示で、同じsampleを使うのは100ms未満。欠測は「—」と理由、終端では骨格を消す。
3. 3秒などへseek→停止し、同時刻の骨格を目視する。素早い連続seek、320px程度の幅、縦横回転後に旧時刻の骨格が残らないことを確認する。全画面/PiPは元動画のみ、戻ればinline骨格へ戻る。
4. 終了→再取得を3回、計測途中で取消、計測/表示中にiPhoneの画面下から上へスワイプしてホーム画面に戻り、5秒待ってSafari（Chromeの場合はChrome）のアイコンを押す。終了の案内が出て、古い骨格/数値が残らず、勝手に計測が始まらないことを確認する。
5. 元MOV・20秒/100MiB近い素材は利用可能なら追加し、発熱、停止、タブ再読込等を記録する。なければ未検証のまま残す。

共有は安全な診断JSONと端末/ブラウザ、素材形式、目視結果だけ。実動画・座標列・署名URLは報告不要。今回のローカルテストはMODULE loader上書きの独立サーバーであり、Next生成表示Worker/CLASSIC loaderと実S3を組み合わせたiPhone骨格表示は後日通過済み。ブラウザ名と追加操作の詳細は確認中。T12-2aの実機通過でT12-2bまで通過扱いにしない。
