# T12-2a 実動画取得・表示canvas診断

製品の `/history` は変更しない独立診断ページ。`pnpm diagnose:pose-display` で起動する。新しいAPI、保存、proxy、Jev呼び出しはない。

このページは **S3 CORSが診断originを許可した後**に、所有者の実動画で使う。2026-10-06時点で `.env.local` の認証はGetBucketCorsがAccessDenied、`tricksight-dev` はSSO期限切れ。設定全体は未確認。127.0.0.1:4175とlocalhost:3000へのGET/Range preflightは403だった。ローカルfixture試験を実S3通過と扱わない。

## 事前確認・承認（AWSを変更するコマンドは実行しない）

1. 所有者が `aws sso login --profile tricksight-dev` で再認証する。以後leaderへ連絡し、現在のCORSルールを読み取り確認する。コンソールのCORS JSONを共有してもよい（キー/署名URLは共有しない）。CORS読取権限がなければ管理者へJSONの確認を依頼する。
2. Macで下記2コマンドを別ターミナルで起動する。

   ```sh
   pnpm diagnose:pose-display
   cloudflared tunnel --url http://127.0.0.1:4175
   ```

   `.env.local` のS3_BUCKET_NAME/AWS_REGIONから許可するS3 hostnameだけを構成する。秘密値やファイル全体は配信しない。診断中は両プロセスとMacを起動したままにする。ポート変更時は `PORT=5175 pnpm diagnose:pose-display` とトンネルのポートを合わせる。テスト専用fixtureサーバーをトンネルへ公開しない。
3. 表示された **その回の正確な `https://...trycloudflare.com` origin** がS3 CORSのGETで許可されるか確認する。未許可なら以下の追加案をleader経由で承認依頼する。既存ルールを消さない。`*` originや `https://*.trycloudflare.com` を許可しない。

   ```json
   {
     "AllowedOrigins": ["https://<今回のトンネル名>.trycloudflare.com"],
     "AllowedMethods": ["GET", "HEAD"],
     "AllowedHeaders": ["Range"],
     "MaxAgeSeconds": 300
   }
   ```

   このページのfetchはカスタムheaderなしの単純GET。Rangeは通常再生の確認用、HEADは診断時の読取用。既存ルールで既に許可される場合は追加不要。**現値未取得なのでこれは追加候補であって適用可能な完成差分ではない。** 現値とトンネルoriginが判明した時点で正確な追加/削除差分を作り、承認後に管理者が変更する。診断後の一時origin削除も承認範囲に含める。トンネルを再起動してoriginが変わったら再確認が必要。
4. CORSの確認が済むまで実動画試験は待つ。no-cors、server proxy、権限拡大での回避はしない。

## 所有動画の署名URLを安全に渡す

- **所有者自身がログインした製品履歴詳細**で動画を開く。そのページが所有権確認して発行したvideo要素の `src/currentSrc` だけを使用する。任意S3 keyを入力して署名する機能は作らない。
- Mac Chrome/Safariの開発者ツールのElementsで対象videoのsrc値をコピーする。iPhoneで開いた履歴なら、ペアリング済みMac SafariのWebインスペクタでそのiPhone Safariの対象videoを選ぶ方法でもよい。Consoleへ値を出力する操作、HAR/Networkのエクスポート、URL入りスクリーンショットはしない。
- 同じ所有者のiPhoneへは本人管理のクリップボード経路（利用可能ならUniversal Clipboard）で渡し、診断ページのpassword欄へ直接貼り付ける。メール・チャット・agmsg・リポジトリ・URLクエリ/fragment・メモファイルには貼らない。安全に本人の端末間で渡せない場合はここで止め、leaderへ方法を相談する。
- 「1. 動画を取得」で入力欄は消える。URLはブラウザから許可したS3 hostnameへ直接GETし、診断サーバーへは送らない。パス・URL・動画・座標を診断JSONへ含めない。取得したBlobは端末内のみ。サーバーはGETの固定assetだけを返し、POSTや任意ファイル配信は拒否する。
- 署名URLは有効期限内のアクセス権そのもの。試験後にクリップボードを無害な文字で上書きし、診断タブを閉じる。ブラウザ内部のNetwork/エラー表示にURLが現れ得るため、それを保存・共有しない。診断コードはconsole/error原文を収集せず、結果は固定の状態名だけにする。
- 取得失敗/期限切れなら所有者の履歴を再読み込みして新URLを取り直す。診断ページから再署名・認証回避は行わない。所有者の別動画や他人のURLを探す作業は不要。

## iPhoneで1回の診断セッションにまとめて確認

SafariとChromeでそれぞれ実施する。デスクトップWebKitやCriOSのUA代替を実機合格とはしない。

1. 元のMP4を使う。署名URLを貼り「1. 動画を取得」。READY_TO_START、blobBytes、fetchMsを確認。取得待ちを経てから別操作で「2. 計測と表示テストを開始」を押す。
2. 同じクリック内で、製品A1が非表示videoをplayし、通常表示videoもplayする。表示canvasを別Workerへ移譲して緑の枠と十字を描く（**骨格ではない**）。表示videoと非表示videoが同時に存在する最大数2を記録する。
3. FINISHED、analysisStatus=COMPLETED、synchronousPlayCalls=1、peakVideoElements=2、visiblePlay=true、pixelReadable=true、pixelNonUniform=true、displayTransferred=true、displayPainted=trueを確認。枠が映像領域に合うか、動画が再生できるかを目視する。これは描画とdecodeの検査で、骨格位置の正確さはT12-2b以降。
4. seek、回転、通常動画の全画面と復帰を試す。全画面/PiPは元動画のみ。枠が復帰することを確認。「終了・破棄」後はDISPOSED、remainingVideoElements=1。再取得して同じ操作を計3回、最後の回は計測中に終了して反応を確認する。
5. 再取得して計測中に5秒ほどホームへ移り、復帰時BACKGROUND_DISPOSED、旧枠なし、自動再開なしを確認する。pagehide/hidden時は再生URLも含め破棄する。
6. **本物の元MOV**（iPhoneで撮ったQuickTimeコンテナ）でも1–3を実施。拡張子/MIMEだけ変えたMP4をMOV合格と扱わない。アプリにアップロード済みで所有者が閲覧可能な素材を使う。元MOVがなければ未検証と記録する。
7. 大きい素材（20秒/100MiB上限に近いもの）が手元にあれば同様に確認する。タブの再読み込み・クラッシュ・発熱・UI停止の有無を記録。小さい素材しかなければ大容量メモリ検証は未完とする。
8. 「安全な診断JSONをコピー」の内容、機種/iOS/ブラウザ名、MP4か元MOVか、3回の完否、枠/再生/背景復帰、発熱・強制再読み込みの有無をleaderへ報告する。動画が写るスクリーンショットは不要。
9. タブを閉じ、両ターミナルをCtrl+Cで終了。一時CORS originは承認した手順で管理者が削除する。

取得/計測失敗やcanvas非対応時は通常再生を残す（ただし元動画自体の認証・codec・通信失敗は別）。非対応時に点列をメインへ戻すfallbackはしない。Blobは100MiBまでの読み込み上限、取得120秒、計測は製品既定120秒。固定メモリ内Blobだけでも大容量になり、decoder/Worker/WASMを含む実RSSやOSが回収したことはJSONでは測れない。DOM数・解放呼出し・反復後の挙動を、実メモリの保証と混同しない。

## ローカル再現

```sh
node scripts/pose-display-diagnostic/test.mjs
pnpm exec eslint scripts/pose-display-diagnostic/*.mjs
```

既存ローカルfixtureとモデルキャッシュを使用。Chromium/WebKit、MP4と同じバイトのQuickTime MIME、通常再生との同時利用、canvas移譲、seek/320px、取得失敗/非対応fallback、キャンセル、pagehide、URL拒否、POST拒否を確認する。HTTP fixtureはsame-originであり、実S3のCORSや署名失効・所有権を検証したことにはならない。実動画URLや動画bodyをテストログへ出力しない。
