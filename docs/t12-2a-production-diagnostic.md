# T12-2a 案X: 本番と同じoriginでの限定診断

2026-10-06。実装とローカル検証済み、leader検収・限定デプロイ・実S3/iPhone実機確認待ち。**CORSは依頼者がコンソールから適用する。適用済み連絡はまだ受けていないため、未適用として扱う。coderはAWSを変更していない。**

## 依頼者が行う設定（Vercel Production）

1. leaderの検収後、今回のコードを本番へデプロイする。環境変数が未設定なら診断ルートは404、履歴に診断リンクは出ない。既存アップロード・履歴はそのまま。
2. Vercelの対象プロジェクト → Settings → Environment Variablesで、**Productionだけ**に次を設定する。Preview/Developmentに同じ値を広げない。

   |名前|最初の値|意味|
   |---|---|---|
   |`POSE_DISPLAY_DIAGNOSTIC_ENABLED`|`true`|サーバー専用フラグ。厳密に小文字trueだけON|
   |`POSE_DISPLAY_DIAGNOSTIC_USER_IDS`|未設定、または空|最初は全員の動画診断を拒否|

   変更は既存デプロイへ反映されないので、Productionを**再デプロイ**する。NEXT_PUBLICの変数は作らない。
3. 自分のアカウントで本番にログインし、同じブラウザで `https://tricksight-theta.vercel.app/diagnostics/identity` を開く。ログイン中の**自分のIDだけ**が表示される。未認証は404、他人を指定する入力欄/APIはない。このページはallowlist設定用なので、フラグONならallowlistが空でも本人IDだけ確認できる。動画・モデルへはアクセスしない。
4. 表示されたIDを `POSE_DISPLAY_DIAGNOSTIC_USER_IDS` のProduction値へ貼る。1人ならID1個だけ。複数ならカンマ区切り、前後の空白は除去される。部分一致ではなく完全一致。**IDをagmsg・文書・コミットへ貼らない。** 設定後にProductionを再デプロイし、IDページを閉じ、クリップボードを無害な文字で上書きする。
5. 承認済み [CORS候補](t12-2a-cors-proposed.json) を依頼者が適用したらleaderへ連絡する。直前の現値と競合がないことを確認し、既存POSTルールを保つ。coderは適用済み連絡の後にget-bucket-corsだけで一致を確認する。診断ルートは本番originを使うのでトンネルoriginやlocalhostの追加は不要。
6. 自分の動画の履歴詳細を再読み込みし「表示診断」を開く。表示されない場合はフラグ、Production対象、再デプロイ、ログイン中IDとallowlistの一致を確認する。別ユーザーや別所有者動画へ権限を広げて回避しない。

## 実機テスト: 小さいMP4を先に

Safari、Chromeでそれぞれ行う。署名URLのコピー、開発者ツール、Mac/トンネルは不要。途中で止めても、診断JSONは最後までの結果を保持する。

**第1段階（主要3項目）**

1. 所有する小さいMP4の履歴から「表示診断」→「1. 動画を取得」。`READY_TO_START`、blobBytes、fetchMsが出ればS3 CORS fetch/Blob化を通過。`FETCH_FAILED_OR_CORS_BLOCKED`ならここで結果を共有して止める。期限切れなら履歴へ戻って再読み込みする（署名はページ描画から15分）。
2. 取得完了を待って、別操作で「2. 計測と表示テストを開始」。このクリックで非表示A1と通常videoを同期playする。`synchronousPlayCalls=1`、`visiblePlay=true`、`peakVideoElements=2`を確認。`FINISHED`でもanalysisStatusがCOMPLETEDとは限らないので状態を確認する。
3. 緑の枠と十字を目視し、`displayTransferred=true`、`displayPainted=true`、`pixelReadable=true`、`pixelNonUniform=true`を確認。枠は骨格ではなく描画面の検査。動画を再生できること、枠が映像領域へ合うことも確認する。「安全な診断JSONをコピー」で結果だけを共有する。

**第2段階（主要3項目が通った後）**

- 元MOVでも同じ操作。MIMEだけ変えたMP4を元MOVの代わりにしない。元MOVがなければ未検証と記録する。
- 同じ動画で終了→再取得を含め3回反復。最後に計測中の「終了・破棄」も試す。`DISPOSED`、video残数1、旧枠なしを確認する。
- 計測中にホームへ5秒移り復帰。`BACKGROUND_DISPOSED`、旧枠なし、自動再開なし。手動で再取得できることを確認する。
- seek、縦横回転、全画面/PiPと復帰。全画面/PiPは元動画のみ。
- 20秒/100MiBに近い所有素材があれば同様に確認。なければ大容量は未検証。発熱、UI停止、OSによるタブ再読み込み/クラッシュを記録する。

共有するものは安全な診断JSON、端末/iOS/ブラウザ名、MP4か元MOVか、どこまで実施したか、反復回数と体感結果だけ。動画・座標・ユーザーID・署名URL・HAR・URL入りスクリーンショットは不要。ブラウザ内部のNetworkには署名URLが存在するためそこを保存/共有しない。

## 試験終了後にOFFへ戻す

1. 診断を「終了・破棄」し、本人IDページを含む診断タブを閉じる。
2. Vercel Productionの `POSE_DISPLAY_DIAGNOSTIC_ENABLED` を `false` に変更、allowlistは削除または空にする。
3. **Productionを再デプロイ**し、履歴の診断リンクが消えること、診断/identity直URLが404になることを確認。
4. 本番GET CORSルールは製品でも必要なため、テストごとに削除しない。製品化を取りやめる場合だけ別途判断する。OFFでも既に開いたタブや既発行の15分署名URLは即時失効しない。

## 実装の境界と検証

- サーバー専用フラグ、空なら拒否のallowlist、認証、UUID検証、`getPracticeSessionDetail(user.id,sessionId)`の所有者スコープ、再生可能statusを通過後だけ署名する。生の署名エラーは固定メッセージにし、ログへ渡さない。
- `/diagnostics/pose-display/[sessionId]` と本人IDページはforce-dynamic。診断パスのレスポンスはno-store/no-referrer/noindex。署名URLをURLパラメーターに置かず、共有キャッシュへ入れない。診断Clientはサーバー許可後だけrenderし、dynamic importで遅延ロード。Worker/modelはさらに明示開始後だけ。
- 履歴詳細の変更はサーバー専用条件リンクのみ。OFF時はnull、追加queryなし、クライアントmoduleやWorkerをimportしない。`/videos/new`と既存計測/保存処理は未変更。root layoutにanalytics/replayはなく、診断コードにconsoleや外部レポート送信は追加していない。
- 生点列は既存計測Worker内のみ。表示Workerは枠/十字とpainted真偽値だけ。Jev、時点評価、骨格保持（T12-2b）は含めない。
- 取得100MiB/120秒、計測は製品既定120秒。取消/hidden/pagehide/unmountでabort/cancel/terminate/revoke、世代番号で遅延応答を除外する。メモリの解放呼出しはOSの実RSS回収を保証しない。

自動検証:

- ゲートと実ページ/履歴リンク: 22テスト。OFF/未認証/対象者外/空allowlist/他人session/再生不能/不正IDの拒否、未許可時の署名なし、Client未render、署名エラーの非露出、本人IDだけの表示。
- 全体: 50 files / 341 tests成功（既存アップロード・S3/LLM独立性・履歴比較を含む）。lint、型検査成功。
- フラグ未設定で `pnpm build` 成功。最初はsandboxのポート制約で失敗したため権限付き再実行。診断2routeがdynamicとして出力された。
- `test-production-off.mjs`: 実際の本番ビルドを起動して診断2routeの404/no-store、Worker/model/S3要求なし、未認証 `/history`・`/videos/new` の従来loginリダイレクトを確認。認証済みの実利用者データでE2Eを行ったとは扱わない。
- 案Xの実controllerをsame-origin fixtureでChromium/WebKit各3回実行: 各89frame/COMPLETED、同期A1 play1、video2、pixel nonuniform、表示移譲・描画・通常play成功。Chromium 4407/4399/4403ms、WebKit 4564/4495/4519ms。署名失効相当の403時にエラー本文を表示せず通常再生を維持すること、effect cleanup/再mount/途中unmountも確認。テストはmodel URL/Worker loaderだけを独立サーバー向けに上書きするため、Next生成Workerと実S3/iPhoneの確認は限定公開時に別途必要。

## scriptsの扱いと撤去一覧

`scripts/pose-display-diagnostic/` は中間検収時の比較基準とオフラインfixtureハーネスとして残す。実機の推奨導線は案Xへ移し、署名URL手渡し・トンネル手順は再開しない。新しいtest-app-controllerは案Xの実controllerを読み、古いpage.mjsの試験だけで案Xの合格とはしない。テスト用endpointはfixture=trueのローカルserverだけで有効、本番アプリには配信しない。

診断撤去時:

- `app/diagnostics/identity/`、`app/diagnostics/pose-display/`。
- `lib/diagnostics/` のゲート/リンク/controller/枠Workerと専用テスト（製品へ再利用する部分が確定したら個別移管）。
- 履歴詳細の診断リンクimport/呼出し、next.configのdiagnostics専用headers。
- Vercelの診断フラグとallowlist。
- scriptsの診断サーバーと3本の診断テスト、package.jsonのdiagnose:pose-display（独立検証基準として残す場合は明示判断）。

CORSの本番GET、既存アップロード計測Worker、製品のpose-assets、研究・検証文書は診断撤去だけを理由に削除しない。
