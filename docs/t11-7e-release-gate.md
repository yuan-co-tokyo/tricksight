# T11-7e リリースゲートのカバレッジとiPhone Safari確認手順

作成: 2026-10-04。製品コード基準: `88258a1`。製品コード・DB・AWS設定は変更していない。今回の変更は検証用スクリプトと文書のみ。

## 確認の現在地

- leader報告: 2026-10-03、本番iPhone Chromeで短い動画のフォーム計測完了を依頼者が確認。アップロード・AI分析完了も本番実機操作で確認済み。
- leaderのローカル実アプリ確認: Chromiumの `/videos/new` から投稿し、pose COMPLETED 89/89・5,020ms、保存API 201、LLM COMPLETED。
- **iPhone Safariの元MOV / MP4、20秒付近、background復帰、cancel、実端末でのtimeout・低検出時の表示とLLM継続は未確認。** 以下のローカルテスト通過で実機確認済みへ置き換えない。
- **Android Chrome: 実機未検証・今回は対象外（端末なし、依頼者判断 2026-10-03）。** 端末を用意できた時点で、同じ項目の確認を再開する。ChromiumやCriOS-UA再現でAndroid実機合格とはしない。

## テストコードに基づくカバレッジ

以下のテスト名はリポジトリ内の名前そのもの。ユニットテストはFakeWorker / FrameSource / mock API等を使うため、OSの停止や実通信を保証しない。

| 項目 | ローカルで担保済みの範囲・テスト名 | 実機で残る範囲 |
| --- | --- | --- |
| Safari元MOV / MP4 | `scripts/test-pose-browser-integration.ts` の `verifyBrowser` がChromium / WebKit / CriOS-UA各2ケースで製品骨格コアと本物のMediaPipeを実行。COMPLETED・4指標・生landmarks非露出・初期/終端progress・同期play 1回を検証 | ファイル選択のユーザー操作、iOSのデコーダ・メモリ・Safari制約、元MOV / HEVCの実バイト。本テストのMOVは同一MP4を `video/quicktime` で配信するケースで、元QuickTimeコンテナの証明ではない |
| 20秒付近 | 今回の6ケースで199/199完走（次節）。`lib/uploads/client-video-validation.test.ts` の `accepts a %s second video` は3 / 3.001 / 20秒を受理。`rejects invalid duration %s` は2.999 / 20.001 / NaN / Infinityを拒否 | カメラ撮影の実20秒動画、iPhoneの発熱・デコード負荷・キャッシュ条件。長さの境界テストは推論性能テストではない |
| background復帰 | 現行 `lib/pose/browser-analysis.test.ts` / coordinatorテスト / integrationにページ非表示・端末ロック・OS復帰を行うテストはない。コードにもvisibility復帰専用処理はない | Safariを非表示にする実操作、復帰後の進捗・終了・操作性。ブラウザ停止中のタイマー発火時刻はFakeTimerの結果から保証できない |
| cancel | `lib/pose/browser-analysis.test.ts`: `cancelするとWorkerを止めてCANCELEDを返す`（terminate / source close）。`lib/uploads/pose-upload-coordinator.test.ts`: `cancels the active task on explicit cancel and dispose`、`cancels the old task and discards its late progress/result` | Safariの「中止」ボタンの実配線、選び直し後の進捗、保存状態、結果画面遷移。unitはReact画面を操作していない |
| timeout | `browser-analysis.test.ts`: `absolute timeoutでWorkerを止めてTIMED_OUTを返す` はFakeTimer・20ms指定でWorker停止を検証。coordinatorの選び直しテストで120,000msの引き渡しを検証 | 本番120秒の壁時計・OS停止後の実際のタイマー挙動、端末上のTIMED_OUT保存。製品にtimeout強制用UIはなく、正常に速く完了したケースでtimeout確認済みとはしない |
| 低検出 | `lib/pose/measurement.test.ts`: `品質ゲート未達では集約値をWorker外へ出さない`（pose 0.7 / 下半身0.6 → UNASSESSABLE、metrics null、理由2種）。`app/(protected)/history/[sessionId]/pose-measurement-card.test.tsx`: `keeps AI analysis as the primary action when measurement is unassessable`（警告・撮り直し案内・AI主操作） | 実映像の検出結果、選択→推論→保存→履歴表示の接続。テストは与えた品質値や静的HTMLを確認している |
| LLM継続 | `pose-upload-coordinator.test.ts`: `starts LLM analysis for pose terminal status %s` をCOMPLETED / UNASSESSABLE / FAILED / TIMED_OUT / CANCELEDの5状態で実行。`keeps LLM analysis successful when pose persistence fails`、`starts LLM analysis without waiting for a pending pose result` | mockでLLM開始と骨格保存の独立性を担保。実S3転送と外部LLMの完了を5状態で通したE2Eではない。実機はcancel・低検出・background時のアップロード→AI結果まで確認する |

S3経路は `video-upload-form.tsx` の `isReadyToSubmit` が骨格状態を条件にせず、`handleSubmit` が署名→S3→完了通知を済ませてから `startIndependentPostUploadTasks` を呼ぶことをコードで確認した。これは構造上の根拠であり、全終了状態の実S3 E2Eを実施したという意味ではない。

integrationは独立HTTPサーバで製品TSをtranspileし、ローカルmodelとmodule Workerを使う。本番Next.js bundle / classic Worker / CDN model download / 認証 / 保存API / S3 / LLMを含まない。CriOS-UA再現は**ChromiumにUA文字列を渡したもの**で、iOS WebKitの再現ではない。T11-2で過去に取得した実機名MOVについても、B-4では実バイトが `mp42` と判明しているため、拡張子だけで元MOV検証済みとはしない。

### 今回の再実行

- `pnpm test`: 48 files / 319 tests成功。
- `pnpm lint`: 成功。
- 長尺integration: 3ブラウザ条件×2MIME、6ケース成功（COMPLETED、199フレーム、4有限指標、同期play 1回）。
- 製品コードの変更がないため、本番ビルド・本番投稿・追加LLM呼び出しは行っていない。

## 20秒付近のローカル実測

### 素材と測定方法

`eval/input` の20本をmp4boxで読み、3.9706〜11.8452秒であることを確認した。最大は `kickflip_4.mp4`。20秒付近の原本はなかった。

既存 `kickflip_10.mp4`（8.9423秒 / H.264 `avc1.640028` / 1920×1080 / 268動画サンプル）の時間尺度を変更し、**19.988674秒**の派生ファイルを作成した。再エンコードせずvideoの時間を約2.24倍へ伸ばし、音声trackのメタデータはfree boxへ置換して除外。mdatとchunk offset、原本は保持する。生成スクリプトは既存出力を上書きしない。

- 出力: `eval/input/pose-long-19.99s.mp4`（gitignore対象、9,044,439 bytes）。動画やmodelはコミットしない。
- SHA-256: `5c035ef1e8d0e4af1b1885a1dc4d9498568fef914feea6ab1fa4a9ca952c735d`
- 要求フレーム数: `floor(19.988674 × 10) = 199`。199/199は期待どおりで、1フレーム欠落ではない。
- full float16 / CPU / 固定10fps、製品既定timeout 120,000ms。
- macOS arm64、Playwright headless。実行はブラウザ・MIMEの順に逐次各1回、同じブラウザでMP4→QuickTime MIMEの順。平均値・p95・cold/warmを分離したベンチマークではない。
- 時間はBlob取得後、`startPoseVideoAnalysis`直前からresult完了までの `performance.now()` 差。video準備・Worker初期化・推論・後処理を含み、テストサーバからの素材fetchは除く。Worker内の `processingDurationMs` とは測定区間が異なる。

| ローカル条件 | video/mp4 | 同じMP4バイト + video/quicktime | 処理数（両ケース） |
| --- | ---: | ---: | --- |
| Chromium 153.0.8010.12 | 9,519.3ms | 9,353.0ms | 199/199 |
| Playwright WebKit 26.6 | 8,220.0ms | 8,085.0ms | 199/199 |
| CriOS-UA再現 / Chromium 153.0.8010.12 | 9,158.9ms | 9,170.7ms | 199/199 |

最長9.5193秒で120秒との差は約110.48秒、約12.6倍の枠があった。この派生素材は約200回の推論・seekを走らせる負荷確認には使えるが、元動画よりGOP間隔・再生fpsが変わり、実撮影20秒のエンコードやcodec・音声・メモリ負荷を代表しない。品質指標の妥当性を評価する素材でもない。

再現コマンド（repoルート。model cacheと既存依存・Playwright browserがある環境）:

```sh
node scripts/create-pose-long-fixture.mjs
POSE_INTEGRATION_VIDEO=eval/input/pose-long-19.99s.mp4 POSE_INTEGRATION_EXPECTED_FRAMES=199 pnpm test:pose-integration
```

出力が既に存在する場合は生成を省略する。検証スクリプトは素材パス・期待フレーム数・実測時間を記録できるよう拡張し、従来の60秒overrideを外して製品既定120秒を使用する。MP4 / QuickTime MIMEの区別も出力へ明記した。

### iPhone 200フレームの見積もり

既存C1実機値89フレーム / 8.2秒を単純比例させると `8.2 × 200 / 89 = 18.43秒`。120秒に対し約101.57秒の差、約6.5倍の枠になる。固定初期化費まで比例させる便宜的な見積もりで、熱・メモリ・background・codecが変わる条件の上限保証ではない。今回は120秒を変更しない。実機で撮った19〜20秒動画の値を次のチェックで記録する。

## 依頼者向け: iPhone Safariで一度に行うチェックリスト

対象は**本番URLを直接開いたiPhone Safari**。アプリ内ブラウザやiPhone Chromeでは代用しない。今回はAndroid操作は不要。

### 最初に用意するもの

- iPhone機種、iOS版、実施日時をメモ。途中でタブを閉じず、同じSafariタブを使う。
- ログインし、プロフィールのスタンスを設定。通信が安定した状態で開始する。
- A: カメラ撮影の元MOV（3〜20秒、100MB以下、人物・全身・足元が写るもの）。拡張子変更ではなく元ファイルを「ファイル」に用意する。共有時にMP4変換されたものは元MOVの確認に数えない。元コンテナが不明なら「元MOV未確認」としてleaderにファイル情報を渡す。
- B: 同様に全身が写るMP4を19〜20秒、100MB以下で用意する（20秒を少し超えると受理されないため19.5秒程度が扱いやすい）。長尺が無ければAと短いMP4を先に確認し、長尺を未確認として残す。ローカル派生素材だけで実撮影長尺合格にはしない。
- C: 人物が写らない、または足元が大半の時間切れた3〜5秒の動画を用意（低検出確認用）。
- 各投稿メモに `T11-7e Safari / 項目名` を入れると後で識別できる。AI分析の回数上限に当たった場合は制限を回避せず、未実施項目を記録する。

通常完了・低検出のチェックでは、計測中に「結果画面へ進む」を押さない。この操作は進行中の骨格計測を中止するため、計測結果を確認してから進む。中止確認ではフォーム計測欄の「中止」を使う。

| 順序 | 操作 | 何が見えれば合格か・残す記録 |
| --- | --- | --- |
| 1 元MOV通常完了 | `/videos/new` で練習情報を入力しAを選択。時刻を測り、フォーム計測の完了を待つ。「S3へ動画をアップロード」→保存表示を待つ→「結果画面へ進む」 | フォーム計測が完了し、結果で膝・腰の数値または比較基準値が見える。動画再生とAI分析結果も表示。選択から完了までの秒数・ファイル名・長さ・画面を記録。判定不能なら通常完了合格とせず、その状態を報告 |
| 2 長尺MP4通常完了 | 新規登録画面でBを選び、Safariを前面に保つ。手順1と同様に完了・アップロード・結果を確認 | 120秒以内に計測完了し数値が保存・表示され、AI結果が出る。長さ・所要秒数を記録。進捗が止まる、タブが再読み込みされる場合は不合格として記録 |
| 3 短いbackground復帰 | 新規画面でBを選び、計測中であることを見てすぐホームへ戻る。5秒後にSafariの同じタブへ戻る。復帰後の計測終了を待ち、アップロード→結果へ | 入力・選択動画が保持され、進捗が再開または既に完了している。計測数値保存とAI結果まで確認。FAILED/TIMED_OUTならbackground計測成功には数えず、アップロード・LLM継続の成否を別に記録。非表示前に完了した場合は再選択で1回だけやり直す |
| 4 明示cancel | 新規画面でBを選び、計測中にフォーム計測欄の「中止」を押す。先にアップロードする必要はない。そのまま「S3へ動画をアップロード」→結果へ | 「フォーム計測を中止しました。動画アップロードとAI分析には影響しません。」が表示され、アップロード・AI結果が得られる。履歴のフォーム計測は中止として扱われる。押す前に完了したらcancel未検証。別の投稿時に再選択後の計測が動けば、選び直しも確認できる |
| 5 低検出 | 新規画面でCを選び、計測終了を待つ。アップロード→保存後に結果へ | 「フォームを十分に計測できませんでした。動画アップロードとAI分析は続行できます。」が出て、履歴には人物/足元の検出不足・撮り直し案内が出る。フォームの数値を誤表示せず「AI分析を見る」が主操作になる。AI分析は骨格を理由に阻止されず結果まで進む。予想外に計測成功したら低検出経路は未確認とする |
| 6 長いbackgroundとtimeout観察 | 新規画面でBを選択し計測中にホームへ戻り、130秒待って同じSafariタブへ復帰。表示を記録し、アップロード→結果を確認 | TIMED_OUTになった場合、計測不可の案内が出てもS3・AI結果へ進める。完了していた場合は長いbackground復帰のみ成功でtimeoutは未検証。タブ再読み込み・入力消失も記録。復帰後も処理中なら前面で最大120秒だけ観察し、それでも終わらなければ「中止」で退出してleaderへ報告 |

順序6はtimeoutの**観察候補**で、強制再現ではない。iOSがどの処理やタイマーを停止するかに依存するため、待っただけではtimeout合格にしない。アップロード画面はFAILEDとTIMED_OUTで同じ「フォーム計測を完了できませんでした…」を使う。履歴で「フォーム計測に時間がかかったため省略しました」と表示されることを確認し、履歴URLと時刻もleaderへ報告する（状態が不明なら保存結果を照合する）。再現しなければ「timeout: unit合格 / 実機未再現」のまま残し、診断専用の強制手段を用意するかはleader判断とする。製品のtimeout値は変更しない。

各行でS3成功とAI開始だけでなく、AI結果の表示まで確認する。AIがプロバイダー等の理由で失敗したら骨格の結果とは分けて記録し、LLM完了の合格扱いにはしない。フォームの値やAIの成功判定が上手さを表すかどうかはこの動作チェックの合否条件に含めない。

### 報告テンプレート

```text
機種 / iOS / Safari / 実施日時:
項目番号:
ファイル名 / 元MOVか / 長さ / サイズ:
選択→計測終了の秒数（backgroundは非表示・復帰時刻も）:
フォーム計測の表示（完了・中止・計測不可など）:
S3アップロード: 成功 / 失敗 / 未実施
AI結果表示: 成功 / 失敗 / 未実施
履歴URL:
スクリーンショット:
再読み込み・入力消失・横スクロール・タップできない箇所:
未実施 / 未再現の項目と理由:
```

各項目が未確認の間はT11-7全体を完了にしない。実機で問題を見つけたら再現操作と記録をleaderへ渡し、承認なしに製品の修正へ進めない。

## T12表示確認と共通の素材待ち（2026-10-06）

Safari元MOVと実撮影20秒は未検証・保留（素材待ち、依頼者判断 2026-10-06）。3〜20秒の元MOVと19〜20秒の実撮影MP4を用意できたら、上表1/2のアップロード・保存値・AI結果まで確認した同じ履歴を使い、T12の「骨格と数値を表示」→取得後「計測を開始」も確認する。再撮影を別々に依頼しない。アップロード時の計測と履歴表示の計測は別経路なので、片方の成功で両方を合格にしない。T12-2aの反復・背景復帰・全画面/回転は依頼者確認済みだが、T11の保存/AI結果を含むゲートまで代替しない。
