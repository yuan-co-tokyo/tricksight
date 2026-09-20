# T11-2 骨格機能の設計

作成日: 2026-09-20

状態: **leader承認済み。T11-3でブラウザ骨格コアまで実装し、DB・画面には未適用**

## 結論

- ブラウザ上のWeb Workerで固定10fpsのPose Landmarkerを動かす構成を採る
- 骨格数値は成功・失敗の判定器やLLM入力にせず、AI分析と独立した履歴比較に使う
- 判定不能は例外ではなく通常状態として扱い、AI分析とアップロードは必ず続ける
- 33点の生ランドマークは端末メモリから出さず、品質情報と少数の集約値だけを別テーブルへ保存する
- 比較は同じユーザー、技、撮影速度、撮影角度、処理版、サンプルレート、delegate、ブラウザ系統が一致するときだけ行う
- DBマイグレーションは必要である。leader承認後、Drizzleスキーマから生成し、SQLは手書きしない

## 1. WebKit + MOVの先行検証

設計前提を確認するため、DBを読み取り専用で照会し、`status=UPLOADED`の実機動画`kickflip_10.mov`をS3から`GetObject`相当の読み取りだけで一時取得した。S3オブジェクトの変更・削除は行っていない。

対象は9,044,439 bytesで、拡張子とContent-TypeはMOV / `video/quicktime`、実コンテナのmajor brandは`mp42`だった。これはB-4で実機だけの形式不一致を発見したものと同じファイルである。

| 項目 | WebKit実測 |
| --- | ---: |
| Playwright / WebKit | 1.63.0 / 26.6 |
| デコード結果 | 1920×1080、8,942.27ms |
| 固定10fps | 89フレーム、3,205ms |
| 全提示フレーム | 267フレーム、33,857ms |
| `presentedFrames` gap | 0 |
| pose / 下半身検出率 | 100% / 100% |
| 固定10fps 2走の比較値 | 23,496座標値 |
| 固定10fps 2走の最大差 | 0 |

WebKitでMOVのmetadata取得、フレームseek、`createImageBitmap(HTMLVideoElement)`、module Worker、WASM初期化、CPU delegateの`detectForVideo()`、`requestVideoFrameCallback()`が全て成功した。したがって、**Playwright WebKitと今回の実機MOVでは設計前提は崩れなかった**。

同じバイト列をChromiumでも固定10fps処理したところ、フレーム数とtimestampは一致したが、集約値は完全一致しなかった。

| 指標 | Chromium | WebKit | 絶対差 |
| --- | ---: | ---: | ---: |
| 膝角度の最小値 | 64.57° | 63.44° | 1.13° |
| 膝伸展幅 | 81.55° | 82.33° | 0.79° |
| 腰上下幅 / 胴長 | 0.794 | 0.800 | 0.006 |
| 着地体幹傾斜 | 7.86° | 7.92° | 0.057° |

Playwright WebKitはiPhone実機Safariの完全な代替ではない。実機Safari、ページのbackground移行、端末の発熱・メモリ制約は未確認なので、iPhone実機MOV / MP4をリリースゲートに残す。

## 2. 中心体験への組み込み

計画書§2の7ステップには次のように入れる。

| 中心体験 | 骨格機能 |
| --- | --- |
| 3. 動画をアップロード | ファイルのmetadata確認後、端末内Workerで計測を先に開始する |
| 4. 撮影条件を入力 | 撮影速度を`通常` / `スローモーション`から必ず選ぶ。撮影角度は既存項目を使う |
| 5. AI分析を待つ | 骨格計測は別進捗として表示する。失敗・中止・timeoutでもAI分析は継続する |
| 6. 分析結果を確認 | AI結果とは別の「フォーム計測」カードに今回の数値と品質状態を表示する |
| 7. 履歴を振り返る | 同条件の直近1件があれば、現在値、前回値、差分を表示する |

履歴詳細では、動画と登録情報の後、AI分析結果の前に「フォーム計測」カードを置く。AIの文章やスコアと混ぜず、数値が成功判定ではないことを明記する。

### 判定可能で比較対象がある場合

同条件の前回日付と詳細ページへのリンクを示し、次の2項目を表示する。

1. 膝の曲がり: 左右膝角度平均の最小値。角度が小さいほど深く曲がっている
2. 腰の上下動: 腰中心のp90-p10を胴長で正規化した値。絶対的な跳躍高ではない

値は小数1桁で表示する。色で良し悪しを付けず、「5.2°深く曲がった」のように変化だけを記述する。WebKit / Chromium差を踏まえ、膝は2°以内、腰上下は0.02胴長以内を暫定的に「ほぼ同じ」とする。この許容幅は実機比較後に確定し、処理版へ含める。

膝伸展幅と着地時の体幹傾斜もWorkerで計測してDBへ保存するが、MVPのUIには表示しない。膝伸展幅はT11-1で分布差が見えたため将来の表示候補として残す一方、初期画面は理解しやすい2指標へ絞る。体幹傾斜は事前仮説と逆方向で、利用者へ意味を説明できる根拠がないため表示しない。

### 比較対象がない場合

今回の数値は「次回比較の基準値」として表示する。条件が揃わない直前動画と無理に比較しない。比較できない理由を次から簡潔に示し、撮影条件に由来する場合だけ次回の合わせ方を案内する。

- 同じ技の過去計測がない
- 撮影速度が異なる、または既存履歴で不明
- 撮影角度が異なる
- 処理版またはブラウザ系統が異なる

検索対象は単なる直前動画ではなく、条件が一致する直近の過去動画とする。成功・失敗の自己申告は一致条件に含めず、失敗から成功への変化も比較できるようにする。

### 比較可能条件

すべて一致した場合だけ差分を出す。

- 所有ユーザー
- トリック
- 撮影速度（通常 / スロー）
- 撮影角度
- 骨格処理アルゴリズム版
- MediaPipeモデルSHA-256
- 固定サンプルレート10fps
- CPU delegate
- runtime family（`WEBKIT` / `CHROMIUM`）

同じアルゴリズム版でもruntime familyを跨ぐと今回の同一動画で差が出たため、MVPでは厳密比較から外す。ブラウザを跨いだ許容差比較は実機データを増やしてから別途判断する。

## 3. 判定不能時の体験

T11-1では6/17本が80%品質ゲートを通らなかった。判定不能をエラー画面にせず、通常の結果状態として用意する。

### 既定動作

- アップロード、S3検証、LLM分析を止めない
- 骨格数値と前回差分は表示しない
- AI分析結果は通常どおり表示する
- 警告色の「フォーム計測」カードで、数値を出せなかった理由と撮影ガイドを示す
- 主操作は「AI分析を見る」のままにし、撮り直しは任意の副操作にする

品質不足と実行失敗は分ける。

| 状態 | 利用者向け表示 | 次の行動 |
| --- | --- | --- |
| `UNASSESSABLE` | 人物または足元を十分な時間検出できなかった | SIDE、全身と足先を画角内、人物サイズ一定、スローを案内 |
| `FAILED` | この動画ではフォーム計測を完了できなかった | AI分析は継続。必要なら別動画で再試行 |
| `TIMED_OUT` | 端末上のフォーム計測に時間がかかったため省略した | AI分析は継続 |
| `CANCELED` | フォーム計測をスキップした | AI分析は継続 |
| 結果行なし | 旧履歴など、フォーム計測を行っていない | AI分析だけを表示 |

品質ゲートはpose検出率80%以上かつ下半身検出率80%以上を維持する。ゲート未達の集約値は保存・表示せず、群比較や履歴差分へ混ざらないようにする。

## 4. LLM分析との関係

MVPでは**独立表示だけを採用し、骨格数値をLLMプロンプトへ渡さない**。

理由は次のとおり。

- 骨格を追加した目的は、LLMの揺らぎから独立した履歴軸を作ることだった
- 35%が判定不能なので、骨格あり / なしでプロンプトが分岐し、LLM結果の比較条件がさらに増える
- T11-1は骨格を与えたときのLLM正答率・安定性を測っていない
- 体幹系は成功・失敗の事前仮説と逆方向で、説明文へ入れる根拠が不足している
- LLM再分析は複数回可能だが、同じ動画の骨格計測は1件でよく、ライフサイクルが異なる

これにより計画書§10の「独立した時系列指標」をMVPの決定とする。§18の改善順序8「骨格情報を追加する」は、将来のversion付きA/B評価候補として残す。試す場合も骨格結果自体は上書きせず、別の`promptVersion`でLLMの正答率と反復安定性を再評価してから採否を決める。

## 5. データモデル

### analysesとは別テーブルにする

`analyses`はLLM provider、model、prompt、再分析ごとの状態を持つ。骨格計測は端末内アルゴリズムで、失敗してもLLMを失敗させず、同じ動画のLLM再分析でも再計測不要である。このため`analyses.result_json`へ同居させず、`videos`と1対1の`pose_measurements`を新設する。

提案スキーマは次のとおり。

```text
pose_measurements
  id uuid primary key
  video_id uuid unique not null references videos(id) on delete cascade
  status pose_measurement_status not null
  quality_reasons jsonb not null default []
  error_code text null
  algorithm_version text not null
  tasks_vision_version text not null
  model_sha256 text not null
  sample_rate_fps integer not null
  delegate text not null
  runtime_family text not null
  frame_count integer null
  pose_frame_count integer null
  lower_body_frame_count integer null
  pose_coverage double precision null
  lower_body_coverage double precision null
  minimum_mean_knee_angle_deg double precision null
  knee_extension_range_deg double precision null
  hip_vertical_range_torso_units double precision null
  landing_trunk_tilt_deg double precision null
  processing_duration_ms integer null
  completed_at timestamptz not null
  created_at timestamptz not null
  updated_at timestamptz not null
```

`pose_measurement_status`は`COMPLETED`、`UNASSESSABLE`、`FAILED`、`TIMED_OUT`、`CANCELED`とする。`UNASSESSABLE`ではcoverageとcountだけを保存し、4つの集約値はnullにする。`FAILED`、`TIMED_OUT`、`CANCELED`では集約値を保存しない。サーバーはcountからcoverageとstatusを再検証し、NaN、Infinity、範囲外の値を拒否する。

比較条件の撮影速度は現在構造化されていないため、`sessions`へnullableな`video_speed`を追加する。

```text
video_speed enum: NORMAL | SLOW_MOTION
sessions.video_speed nullable
```

既存履歴を推測でbackfillしない。新規投稿では必須入力にし、既存のnullは速度条件不明として差分比較から外す。

### 生ランドマークを保存しない

33点の正規化座標・world座標はWorker内で集約し、サーバーへ送らない。

- MVPの表示と比較には少数の集約値だけで足りる
- フレームごとの身体軌跡は集約値より大幅に容量が大きい
- 詳細な身体運動データはプライバシー上の負担が増える
- 元動画は既にS3にあり、将来必要なら明示的な再処理設計を承認してから作れる

User-Agent全文も保存せず、比較に必要な`WEBKIT` / `CHROMIUM`のruntime familyだけを保存する。

### マイグレーションとセキュリティ

マイグレーションは必要である。leader承認後に`lib/db/schema/app.ts`へ定義し、`pnpm db:generate`で生成する。SQLは手書きしない。

新テーブル追加時は次も同じタスクで更新する。

- `expectedPublicTables`を9テーブルへ更新
- `db:secure`のRLS / app role policy対象へ追加
- `db:verify`のTransaction pooler CRUD + rollbackへ追加
- 所有者スコープを`pose_measurements -> videos -> sessions.user_id`で検証する保存・取得query
- セッション削除時はvideo FK cascadeで自動削除し、別の削除経路を増やさない

ブラウザから送る値は改ざん可能なので、アクセス制御やLLMの成否判断には使わない。保存APIは認証済みユーザーが所有する`video_id`だけを受け付け、server側のversion定数とzod schemaで値を制限する。

## 6. 処理タイミング、進捗、キャンセル

動画はローカル`File`から、S3アップロード前に処理を開始する。サーバーやS3から動画を再取得せず、新しい動画処理基盤も追加しない。

```text
ファイル選択・metadata確認
        │
        ├─ Workerで固定10fps計測を開始 ─────────┐
        │                                         │
送信 ─→ Presigned POST取得 ─→ S3 upload ─→ verify ─┤
                                                  ├─ terminalな骨格結果だけ保存
                                                  └─ LLM分析を必ず開始
```

計測はファイル選択時に始め、動画を選び直したら古いWorkerをterminateして結果を破棄する。送信時点で未完了なら、S3アップロードとLLM分析開始を先に進め、骨格処理はabsolute timeoutまでだけ待つ。LLMのqueue開始は骨格の成功、失敗、保存APIの成功に依存させない。

結果ページへの遷移前に骨格処理を待つ場合も、LLMは既に開始済みとする。「結果画面へ進む」操作は骨格処理だけをキャンセルし、アップロードやLLMを中止しない。

### 進捗

- Workerは処理済みフレーム数 / 予定フレーム数を通知する
- 「フォーム計測」と「動画アップロード」を別のprogressとして表示する
- 毎フレームでReact stateを更新せず、5フレームまたは100ms単位で間引く
- WASM / model初期化中、フレーム処理中、保存中を区別する

### timeoutと失敗

- timeout値はiPhone実機20秒動画の測定後に確定する
- timeout、decode失敗、model取得失敗、Worker例外はすべて骨格側だけをterminalにする
- Workerをterminateし、`ImageBitmap`、object URL、video sourceを解放する
- 骨格失敗をアップロードフォーム全体のerror stateへ昇格させない

## 7. 実装タスク分解案

| ID | 内容 | 完了条件 |
| --- | --- | --- |
| T11-3 | ブラウザ骨格コア | 製品用Workerが固定10fps、4指標、品質ゲート、進捗、cancel、timeoutを返す。生33点はWorker外へ出さない。Chromium / WebKitのMP4・MOV integration testが通る |
| T11-4 | DBと保存境界 | `sessions.video_speed`と`pose_measurements`をDrizzleから生成。owner scope、zod検証、idempotent保存、RLS / app role / CRUD rollback検証が通る |
| T11-5 | アップロード体験 | ファイル選択から計測を開始し、別進捗とcancelを表示。どの骨格terminal状態でもS3 uploadとLLM分析が進む。通常 / スローを構造化入力する |
| T11-6 | 履歴比較 | 履歴詳細に現在値、同条件の直近値、差分、判定不能、比較対象なしを表示。owner scopeと比較条件のquery / UI testが通る |
| T11-7 | 実機・E2Eリリースゲート | iPhone Safari実機で元MOV / MP4、Android Chrome、20秒動画、background復帰、cancel、timeout、低検出、LLM継続を確認する |

leaderは2026-09-21にこの設計を承認し、T11-3から順に着手する。骨格値のLLM投入はこの分割に含めず、独立した評価タスクへ延期する。

## 8. 承認時に固定する判断

1. 骨格とLLMを独立させ、プロンプトへ入れない
2. 判定不能でもAI分析を既定で継続する
3. runtime familyまで一致する履歴だけを厳密比較する
4. `pose_measurements`を`analyses`と分離し、生ランドマークを保存しない
5. `sessions.video_speed`を新規投稿の必須入力にする
6. 固定10fps、CPU、モデルSHA、80%品質ゲートを処理版として固定する
7. iPhone Safari実機確認をリリースゲートにする
