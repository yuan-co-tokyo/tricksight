# T12-2a 技術検証報告

承認依頼: **診断ページとローカル検証は完了。実S3 CORS確認・iPhone Safari/Chromeの実機検証は保留**。現在値の読取を可能にするSSO再認証と、診断originのCORS確認を依頼する。T12-2b/製品組込みへ自動で進まない。

2026-10-06。検収済みT12-3 `a825b34` / `d5c9841` はmainへpush済み。今回変更は `scripts/pose-display-diagnostic/`、package.jsonの診断コマンド、この文書のみ。製品app/lib/DB/AWS設定・Jev/APIキーは変更していない。

## CORSの実環境確認（着手時に実施）

- `.env.local` が指定するバケットにGetBucketCorsを要求: **AccessDenied**。秘密値は出力していない。
- 管理用 `tricksight-dev` プロファイルで再試行: **SSO token expired / refresh failed**。設定を変更する操作や別プロジェクトのプロファイル利用はしていない。
- 同じS3 regional endpointへ非変更のOPTIONSを送信。Origin=`http://localhost:3000` と `http://127.0.0.1:4175`、Access-Control-Request-Method=GET、Access-Control-Request-Headers=rangeの両方で **403 / Access-Control-Allow-Origin・Methods・Headersなし**。
- この観測では両originのGET/Range preflightは通らない。**設定全体、実本番origin、今回のトンネルorigin、署名GETからのピクセル取得が通るかは未確認**。単純GETがpreflightを使わないこともあるため、上記403だけで署名GETの全ケースを失敗と断定しない。docs/aws-iam-setup.mdの例を実値と扱わない。

leaderへ認証復旧依頼済み。依頼者による `aws sso login --profile tricksight-dev`、またはコンソールの現CORS JSONが必要。実際のトンネルorigin確定後、現設定を保ったままそのoriginのGET/HEAD・Rangeを追加する案を正確な差分にする。[README](../scripts/pose-display-diagnostic/README.md)に追加候補JSONを記載したが、**現値が読めないため完成差分ではない**。許可前にAWS変更は行わず、wildcardトンネル許可・no-cors・server proxyも使わない。

## 実装した診断経路

所有者が既存履歴から取得した署名URLをpassword欄へ貼る→ブラウザが許可S3 hostnameへCORS fetch→100MiB制限のBlob→READY_TO_START→二段階目のクリック内で製品startPoseVideoAnalysisのA1同期play、同時に通常video再生。非表示videoと表示videoが並存する。full/CPU/固定10fpsの現行処理を未変更で利用する。

別Workerに表示canvasをtransferして、object-containに合わせた緑の枠/十字を描く。Workerからpaintedだけを返し、canvas readbackも確認。これは骨格実装ではなく表示surfaceのspike。生点列は製品Worker内で既存どおり破棄され、mainへ出ない。完成後に表示videoの32x32 pixelが読み取れ、画像が一様でないかを検査する。画像・ピクセル配列は送信/保存せず真偽値だけを残す。

URLを入力欄・診断JSON・サーバーログに保持しない。失敗原文も収集しない。固定asset以外/POSTを拒否、no-store/no-referrer/CSPを設定。実URLはブラウザ内部Networkやvideo srcに存在するため「どこにも残らない」とは保証しない。HARやコンソールの共有を避け、終了時にsrc/Blob URLを除去する。元の所有者確認は製品が行う。診断ページ自体が所有権を再認証するわけではなく、ユーザーが所有する有効な署名URLだけを使う手順に限定する。

取消/hidden/pagehideはfetch abort、計測cancel、表示Worker terminate、canvas再生成、video src除去、Blob URL revoke。世代番号で遅延結果を破棄する。取得/CORS失敗とcanvas非対応は通常再生を残す。終了・背景移動では通常videoのsrcも消し、復帰後の自動開始はしない。

## ローカル検証

コマンド: `node scripts/pose-display-diagnostic/test.mjs`、対象mjsのESLint。Mac上Playwright Chromium/WebKit、既存kickflip_10.mp4（9,044,439 bytes、89frame）。下表は修正後の最後の完全実行、各条件1回。ベンチマーク/実機予測ではない。

|ブラウザ|配信MIME|取得ms|計測ms|結果|
|---|---|---:|---:|---|
|Chromium|MP4|33|4502|COMPLETED 89/89|
|Chromium|QuickTime|21|4408|COMPLETED 89/89|
|WebKit|MP4|11|4581|COMPLETED 89/89|
|WebKit|QuickTime|10|4507|COMPLETED 89/89|

全4条件で同期A1 play=1、video最大2、通常play=true、表示canvas移譲/描画=true、pixel readable/nonuniform=true。QuickTimeは**同じMP4バイトのMIME変更**であり、元MOV互換性の検証ではない。

最初のWebKit試験では通常videoを停止したままのreadbackが一様だった。二段階目で通常videoも同期playする診断に修正し、同時decode条件で通過した。実機で一様画像が再現したら未合格として記録し、推論成功だけでピクセル取得成功としない。

追加の自動検証: 320px/seek後の再生継続、取得失敗を模擬してnative再生継続、transfer非対応を模擬して計測・通常再生継続、終了/計測中cancel後のvideo1個、pagehideで破棄、未許可URLの拒否、POST405、外部通信/GET以外なし。ローカルfixtureのsame-origin取得であり、実S3/署名期限/所有権/CORSのテストではない。pagehideイベントの模擬もiPhoneの実backgroundではない。

## 依頼者の実機確認とT12-2b以降の懸念

[READMEの手順](../scripts/pose-display-diagnostic/README.md)に、pnpm + cloudflared起動、所有者URLを本人のクリップボードで渡す方法、CORS承認、MP4/元MOV、Safari/Chrome、3回反復、途中取消、背景移動、fullscreen、終了までをまとめた。実データのURL/動画/座標をleaderへ送る必要はなく、安全な診断JSONと端末・体感結果だけを報告する。

未確認は実S3 CORS、iPhoneの二段階play/表示canvas、元MOV、上限付近100MiBと2decoderによるメモリ・発熱。DOM数とrevoke/terminate呼出しは実RSS解放の証明ではない。モデルのWASMやdecode面を含む総メモリをデスクトップ小素材の通過で保証しない。

T12-2bでは表示専用Workerの列保持・描画・現在値だけのprotocolが別途必要。この診断はその完成品ではなく、推論Workerと表示Workerを分けたsurface検証。最終1Workerでモデルと描画を共存させる際の負荷・終了処理は再検証する。T12-2c以降は既定OFFフラグ、製品非露出を守る。頂点検出改善とJevは保留のまま。
