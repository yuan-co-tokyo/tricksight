# tricksight MVP実装方針

## 1. プロダクトの目的

tricksightは、スケートボードの練習動画をAIが分析し、改善点と上達履歴を残せるWebアプリとする。

MVPでは、以下を検証する。

- AIのアドバイスが実際の練習に役立つか
- 過去動画と分析結果を残す価値があるか
- 継続して動画を投稿したくなるか

## 2. MVPの中心体験

ユーザーの基本操作は、次の流れとする。

1. ログインする
2. 分析したいトリックを選ぶ
3. 練習動画をアップロードする
4. 撮影方向や成功・失敗などを入力する
5. AI分析の完了を待つ
6. 良かった点、改善点、次回の練習内容を確認する
7. 過去の動画と分析結果を履歴から振り返る

## 3. MVP対象機能

### 実装する機能

- ユーザー登録・ログイン
- ユーザープロフィール
- トリック選択
- 動画アップロード
- 動画プレビュー
- 練習日、撮影方向、メモの登録
- 成功・失敗の自己申告
- Amazon Bedrockによる動画分析
- 分析中、完了、失敗のステータス表示
- AI分析結果の表示
- トリック別の履歴一覧
- 過去動画と分析結果の詳細表示
- 分析失敗時の再実行

### MVPでは実装しない機能

- MediaPipeによる骨格解析
- 膝や関節角度の数値測定
- スケートボード自体の物体検出
- 動画同士の比較再生
- リアルタイム撮影アドバイス
- SNS、ランキング、フォロー
- AIチャット
- ネイティブスマートフォンアプリ
- 課金機能

## 4. 対象トリック

最初は以下の3種類に限定する。

- Ollie
- Pop Shove-it
- Kickflip

AIによる自動判定ではなく、ユーザーが事前にトリックを選択する。

これにより、プロンプトをトリックごとに最適化しやすくなり、分析精度も安定させやすい。

## 5. 技術スタック

### Webアプリ

- Next.js
- App Router
- TypeScript
- Tailwind CSS
- shadcn/ui

### 認証

- Better Auth
- ユーザーデータは自分のPostgresに保持する

### 動画保存

- Amazon S3（ソウル ap-northeast-2）
- Presigned POSTによるブラウザからの直接アップロード

### AI分析

- Amazon Bedrock（ソウル ap-northeast-2）
- 候補は動画対応のAmazon Nova系と、動画特化のTwelveLabs Pegasus 1.2
- どちらもS3 URI方式で動画を渡すため、S3バケットは呼び出しリージョンと同一である必要がある
- Phase 0で候補モデルの棚卸しと品質比較を行い確定する

Pegasusは同期`InvokeModel`で呼び出せ、`responseFormat.jsonSchema`による構造化出力をネイティブに備える。第9章の`SkateAnalysisResult`をスキーマとして直接渡せるため、Novaのプロンプト依存のJSON生成より扱いやすい。

### バックエンド処理

- Next.js Route Handler
- 分析はRoute Handlerからのバックグラウンド実行とし、MVPではLambdaを使わない
- 分析ロジックは独立モジュールに隔離し、将来Lambdaへ載せ替えられるようにする

### データベース

- PostgreSQL（Supabase、東京 ap-northeast-1）
- Drizzle ORM
- Vercelの実行時接続はSupavisor Transaction pooler（ポート6543）を使い、`uselibpqcompat=true&sslmode=require`を付ける
- マイグレーションと`pg_dump`にはDirect connectionを使う。実行環境がIPv6へ接続できない場合のみSession pooler（ポート5432）を使う
- 標準のPostgresドライバ（pg）を使い、ベンダー専用ドライバに依存しない
- アプリ専用のDBロールを作り、デフォルトの`postgres`ロールをアプリから使わない

接続文字列は用途ごとに分ける。

```bash
# VercelのRoute HandlerとBetter Authが使う
DATABASE_URL=postgresql://...@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?uselibpqcompat=true&sslmode=require

# Drizzleのマイグレーションとpg_dumpが使う
DATABASE_ADMIN_URL=postgresql://...@db.<project-ref>.supabase.co:5432/postgres?uselibpqcompat=true&sslmode=require
```

Transaction poolerではnamed prepared statementを使えないため、`pg`のクエリ設定に`name`を指定しない。Drizzleから発行するクエリも含め、実装時にTransaction modeで認証・CRUD・トランザクションの動作確認を行う。

Supabaseは「東京にあるマネージドPostgres」としてのみ使う。Supabase AuthとSupabase Storageは使わない。認証はBetter Authでアプリ内に持ち、動画はS3へ置く。これによりDBは`pg_dump`だけでRDSへ移せる状態を保つ。

Supabase Freeは1週間の無活動でプロジェクトが停止し、復帰にはStudioからの手動操作が必要になる。これを避けるため、GitHub Actionsのスケジュール実行で日次のkeep-aliveクエリを流す。Vercel Cronは使わない（移植性のため）。

### DBの選定理由と見直し条件

Supabaseを選んだ理由は東京リージョンがあることの一点である。製品としてはNeonの方が優れている点が多い。

- Neonは無活動時も次の接続で自動復帰する（Supabaseは手動再開が必要）
- Neonはブランチングを持ち、マイグレーション検証が容易
- Neonの無料枠は10プロジェクト・合計5GB（Supabaseは組織あたり2プロジェクト・500MB）

それでもSupabaseを採るのは、NeonのAPAC提供がシンガポールとシドニーに限られるため。シンガポールは日本からRTT約70msあり、セッション検証とデータ取得で1ページ2〜4往復すると毎リクエストに140〜280msが乗る。手動再開が年に数回発生するコストより、全リクエストに常時乗るコストの方が高いと判断した。

次の条件が満たされた場合、Neonへの移行を検討する。

- Neonが東京リージョンを提供した場合
- Supabaseの2プロジェクト枠が不足した場合
- keep-aliveの運用が破綻した場合

移行コストを低く保つため、本節冒頭の制約（標準pgドライバ、Supabase AuthとStorageの不使用）を必ず守る。これらを守っている限り、移行は`pg_dump`と接続文字列の差し替えで完了する。

### リージョン方針

リージョンは用途で分割する。

| 用途 | リージョン | 理由 |
| --- | --- | --- |
| Vercel関数 | 東京 `hnd1` | 体感速度。Hobbyプランは単一リージョンだが変更可能 |
| Supabase | 東京 `ap-northeast-1` | Vercel関数と同居させDBアクセスを最短にする |
| S3 | ソウル `ap-northeast-2` | Bedrockと同一リージョンにする必要がある |
| Bedrock | ソウル `ap-northeast-2` | Pegasusの提供がAPACではソウルのみ |

動画データはリージョンを跨がない。ブラウザはS3ソウルへ直接アップロードし、Bedrockは同一リージョン内でそれを読む。東京のVercel関数がソウルのBedrockを呼ぶ経路は動画本体を運ばないため、増える遅延は分析時間に対して無視できる。

### インフラ管理

- MVPではIaCを使わない
- AWS側の構築対象はS3バケットとIAMのみとし、手動構築と手順書で管理する
- 本番からのAWSアクセスはVercel OIDC federationによるAssumeRoleとし、静的アクセスキーを本番に置かない（OIDCはHobbyプランでも利用できる）
- Preview環境にはAWSのロールARNとS3バケット名を設定せず、本番のS3およびBedrockへアクセスさせない
- ローカル開発でのみIAMユーザーのアクセスキーを使う
- AWSへ移行してLambda等が増えた時点でCDK導入を再検討する

### 監視

- アプリケーションはVercelのログを使う
- BedrockとS3はCloudWatchを使う

### ホスティング

- Next.js：Vercel Hobby（東京 `hnd1`）
- AI・動画処理：AWS（S3 + Bedrock、ソウル）
- DB：Supabase Free（東京）
- 認証：Better Auth（アプリ内）

想定月額はS3の$0.3程度とBedrockの従量課金のみで、それ以外は$0となる。

Vercel Hobbyは商用利用が禁止されている。MVPの検証段階は問題ないが、収益化する時点でPro（$20/席/月）への移行、またはAWSへの移行が必要になる。この分岐を判断ポイントとして認識しておく。

### AWS移行性の維持

MVP完成後にAWSへ移行する場合に備え、次のルールを守る。

- Vercel専用サービス（Vercel KV、Blob、Cronなど）を使わない。ストレージはS3、DBはSupabaseのPostgresに限定する。
- Supabase AuthとSupabase Storageを使わない。これらを使うとDBだけを移す形での移行ができなくなる。
- DB接続は標準のPostgresドライバを使い、移行時の接続コード変更をなくす。
- 分析処理はRoute Handlerに直書きせず独立モジュールに隔離し、Lambdaへ載せ替え可能に保つ。

移行時に動かすのはNext.jsホスティングとPostgres（Supabase → RDS、pg_dump）だけとし、動画（S3）と分析（Bedrock）は初日からAWSに置く。

Next.jsホスティングの移行先はコンテナ（App Runner等）またはOpenNext（Lambda + CloudFront）を想定する。AWS Amplify Hostingは2026年半ば時点で公式にNext.js 15までしか対応しておらず、本プロジェクトのNext.js 16では選択肢にならない。Next.js 16.2で安定版Adapter APIが出てAWSも策定に参加しているため、移行を検討する時点で対応状況を再確認する。

## 6. システム構成

```text
ブラウザ（日本）
  │
  ├─ Next.js Webアプリ（Vercel / 東京 hnd1）
  │    ├─ ログイン（Better Auth）
  │    ├─ 動画登録
  │    ├─ 分析結果
  │    └─ 履歴表示
  │         │
  │         └─ PostgreSQL（Supabase / 東京）
  │              └─ ユーザー・練習・動画・分析履歴
  │
  ├─ Presigned POST情報取得 ────┐
  │                             │
  └─ 動画を直接アップロード ──────┴─→ Amazon S3（ソウル）
                                            │
                                            │ 同一リージョン内で読み取り
                                            ▼
       Route Handlerのバックグラウンド処理 ─→ Amazon Bedrock（ソウル）
       （Vercel / 東京）                        Nova または Pegasus
                    │                              │
                    └──────────────────────────────┘
                                    │
                                    ▼
                    分析結果をPostgreSQL（東京）へ保存
```

動画本体が越境しないことがこの構成の要点である。ブラウザからS3ソウルへ直接上げ、Bedrockはそれを同一リージョン内で読む。東京のVercel関数とソウルのBedrockの間を流れるのはAPI呼び出しとJSON結果だけになる。

## 7. 動画アップロード方式

動画はNext.jsのサーバーを経由させず、ブラウザからS3へ直接アップロードする。

処理の流れは以下とする。

1. Next.js APIへアップロード要求
2. APIがオブジェクトキーを確定し、S3 Presigned POSTのURLとフォームフィールドを発行
3. ブラウザからS3へ動画を直接アップロード
4. アップロード完了をAPIへ通知
5. APIが`HeadObject`でオブジェクトの存在、キー、サイズ、Content-Typeを再検証
6. 検証に失敗したオブジェクトは削除し、成功した場合のみ分析処理を開始

Presigned POSTのポリシーには次の条件を必ず含め、クライアント側の検証だけに依存しない。

- オブジェクトキーの完全一致
- `content-length-range`による上限100MB
- 許可するContent-Typeの完全一致（`video/mp4`または`video/quicktime`）
- 有効期限は5分以内

Presigned POSTは有効期限内で再利用できるため、キーは推測困難なUUIDで発行する。分析開始前の`HeadObject`検証ではDBに保存したユーザーIDとオブジェクトキーの対応も確認し、別ユーザーのキーを指定できないようにする。

### 動画制限

- 形式：MP4、MOV
- 長さ：3秒から20秒
- 最大ファイルサイズ：100MB
- 1回の投稿につき動画1本
- 縦動画・横動画の両方を許可
- 音声は分析対象外

### スローモーション撮影は必須要件とする

Amazon Novaの動画理解は、16分以下の動画に対して**1秒あたり1フレーム**でサンプリングする。20秒の動画ならモデルが見るのは20枚である。

キックフリップで板が回っている時間は約0.3秒しかない。通常撮影の動画では、この0.3秒に対してサンプリングされるフレームは0枚か1枚になる。つまり第9章で評価させようとしている「足の使い方」や「ポップ」は、通常撮影では原理的にモデルへ届かない。

したがってスローモーション撮影は推奨ではなく、分析が成立するための前提条件として扱う。

- 撮影画面とアップロード画面で、スローモーション撮影を明示的に要求する
- iPhoneの240fpsスローモーションであれば8倍に引き伸ばされ、0.3秒のフリップが約2.4秒（2〜3フレーム相当）になる
- 重要なのはファイルの再生時間であり、fpsではない。スロー再生された状態で書き出された動画を受け取る必要がある
- 通常撮影の動画がアップロードされた場合に備え、分析結果の`detected.visibility`が`POOR`のときは撮影方法の再案内を表示する

解像度とフレームレートを上げても分析精度は上がらない。Novaは全フレームを672×672へリサイズし、サンプリングは最大1FPSであるため、4K撮影も60fps撮影も精度には寄与せず、ファイルサイズ制限を圧迫するだけになる。

この制約の度合いはモデルによって異なる。動画ネイティブのPegasusはフレームサンプリング前提のNovaと時間解像度の扱いが違うため、Phase 0での比較対象として重要度が高い。

## 8. 非同期分析

動画分析は非同期で実行する。

ブラウザからBedrockの処理完了までHTTP接続を維持しない。

### ステータス

```ts
type AnalysisStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "QUEUED"
  | "ANALYZING"
  | "COMPLETED"
  | "FAILED";
```

### 処理フロー

```text
動画アップロード
      ↓
UPLOADED
      ↓
QUEUED
      ↓
バックグラウンド処理開始
      ↓
ANALYZING
      ↓
Bedrockへ動画を送信
      ↓
JSON形式の結果を検証
      ↓
COMPLETED
```

画面側は数秒ごとにAPIを呼び出し、分析ステータスを確認する。

MVPではWebSocketを利用しない。

### 実行時間とスタック検出

バックグラウンド処理は、未`await`のPromiseを残す実装にはしない。Next.jsの`after()`をRoute Handler内で呼び、レスポンス返却後もVercelが処理の完了を待つ形にする。

```ts
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  // 所有者確認、アップロード検証、分析レコードのQUEUED化
  const analysisId = await createQueuedAnalysis();

  after(async () => {
    await runQueuedAnalysis(analysisId);
  });

  return Response.json({ analysisId, status: "QUEUED" }, { status: 202 });
}
```

Vercel Hobbyで300秒を使うにはFluid Computeが有効であることをデプロイ前に確認する。`after()`の処理も関数の最大実行時間に含まれる。20秒動画に対するBedrockの同期呼び出しが300秒以内に収まることをPhase 0で実測し、超える場合はLambda等のジョブ実行基盤へ切り替える。

二重呼び出しによる重複課金を防ぐため、ワーカー開始時に`QUEUED`から`ANALYZING`への条件付きUPDATEを行う。更新件数が0件なら、別処理が取得済みとしてBedrockを呼ばず終了する。

```sql
UPDATE analyses
SET status = 'ANALYZING', started_at = now(), attempt_count = attempt_count + 1
WHERE id = $1 AND status = 'QUEUED';
```

再分析は既存行を`QUEUED`へ戻さず、新しい`analyses`行を作る。1つの動画につき`QUEUED`または`ANALYZING`の行を同時に1件だけ許可する部分ユニークインデックスを設ける。

ただしVercelの関数にはリトライの仕組みがない。関数が異常終了すると`ANALYZING`のまま残る動画が発生する。これを回収するため、ステータス確認APIにスタック検出を持たせる。

- `ANALYZING`のまま一定時間（例：10分）を超えたレコードは`FAILED`へ落とす
- `FAILED`になったものは、回数上限の範囲でユーザーが再分析を実行できる
- 併せて`started_at`を必ず記録し、経過時間を判定できるようにする

## 9. AI分析内容

AIには以下を評価させる。

- トリックが選択内容と一致しているか
- 成功、失敗、判定不能
- セットアップ
- ポップ
- 足の使い方
- 上半身と重心
- 着地
- 良かった点
- 改善点
- 次回の練習方法

AIの出力は自由文だけでなく、JSON形式に固定する。出力はzodでスキーマ検証し、検証ロジックにはユニットテストを用意する。

構造化出力の実現方法はモデルによって異なる。Pegasusは`responseFormat.jsonSchema`でスキーマを直接受け取れるため、以下の型から生成したJSON Schemaを渡す。Novaはプロンプトでの指示に依存するため、パース失敗時のリトライを実装する。いずれの場合もzodによる検証は共通で通す。

```ts
type SkateAnalysisResult = {
  summary: string;

  detected: {
    trickMatchesSelection: boolean;
    visibility: "GOOD" | "PARTIAL" | "POOR";
  };

  result: {
    outcome: "LANDED" | "BAILED" | "UNCLEAR";
    confidence: number;
  };

  scores: {
    setup: number;
    pop: number;
    bodyBalance: number;
    footControl: number;
    landing: number;
  };

  strengths: Array<{
    title: string;
    description: string;
  }>;

  improvements: Array<{
    title: string;
    description: string;
    priority: 1 | 2 | 3;
    timestampSeconds?: number;
  }>;

  nextPractice: {
    focus: string;
    drill: string;
  };

  safetyNote?: string;
};
```

スコアは絶対評価ではなく、同じユーザーが過去の結果と比較するための参考値として扱う。

## 10. AIプロバイダーの抽象化

最初はBedrockのみ実装するが、将来Geminiなどと比較できる構造にする。

```ts
interface VideoAnalysisProvider {
  analyze(input: {
    videoS3Uri: string;
    trick: TrickSlug;
    stance: "REGULAR" | "GOOFY";
    cameraAngle: CameraAngle;
    promptVersion: string;
  }): Promise<SkateAnalysisResult>;
}
```

初期実装：

```text
VideoAnalysisProvider
├─ BedrockNovaVideoAnalyzer
└─ BedrockPegasusVideoAnalyzer
```

Phase 0で両方を実装し、比較結果の良かった方をMVPの既定とする。落選した側も削除せず、評価ハーネスから呼べる状態で残す。

将来：

```text
VideoAnalysisProvider
├─ BedrockNovaVideoAnalyzer
├─ BedrockPegasusVideoAnalyzer
├─ GeminiVideoAnalyzer
└─ MediaPipeEnhancedAnalyzer
```

モデルの選択機能は、MVPではユーザーに公開しない。

## 11. プロンプト管理

プロンプトはトリック別に管理し、コードへ直接ベタ書きしない。

```text
prompts/
├─ common-system-v1.ts
├─ ollie-v1.ts
├─ pop-shove-it-v1.ts
└─ kickflip-v1.ts
```

分析結果には以下を保存する。

- AIプロバイダー
- モデルID
- プロンプトバージョン
- 分析日時
- 構造化された分析結果
- エラー情報

モデルやプロンプトを変更した場合でも、過去の分析条件を追跡できるようにする。

## 12. データモデル

### users

認証テーブルはBetter Authの標準スキーマ（user、session、account、verification）を使う。

userテーブルへアプリ固有の列を追加する。

```text
id
display_name
stance
created_at
updated_at
```

### tricks

```text
id
slug
name
description
is_active
```

### sessions

練習動画1本と、その投稿情報を表す。

```text
id
user_id
trick_id
practiced_at
camera_angle
user_outcome
memo
created_at
updated_at
```

### videos

```text
id
session_id
s3_key
original_filename
content_type
file_size
duration_ms
width
height
status
created_at
updated_at
```

### analyses

```text
id
video_id
provider
model_id
prompt_version
status
result_json
raw_response
error_code
error_message
attempt_count
started_at
completed_at
created_at
```

## 13. 画面構成

### ランディングページ

- tricksightロゴ
- プロダクト説明
- ログイン
- 新規登録

キャッチコピー案：

```text
SEE YOUR TRICK.
SHAPE YOUR PROGRESS.
```

### ダッシュボード

- 最新の分析
- 最近投稿した動画
- トリック別の投稿数
- 最新の改善ポイント
- 新しい動画を分析するボタン

### 動画登録画面

- トリック選択
- 動画選択
- 動画プレビュー
- 撮影方向
- 成功・失敗
- 練習日
- メモ
- アップロード進捗

### 分析中画面

- 動画アップロード完了
- AI分析中
- ステータス表示
- 分析完了後に自動更新

### 分析結果画面

- 動画プレーヤー
- AI総評
- 5項目のスコア
- 良かった点
- 改善ポイント
- 次回の練習内容
- ユーザーメモ
- 再分析ボタン

### 履歴一覧

- サムネイル
- トリック名
- 練習日
- 成功・失敗
- スコア
- 分析ステータス
- トリック別フィルター

### 履歴詳細

- 過去動画
- 登録時の情報
- AI分析結果
- 分析モデルと日時

## 14. UIデザイン

テーマは以下とする。

- モダン
- シャープ
- ダークモード中心
- ストリート
- AI・映像解析
- ネオンカラーは限定的に使用

### カラーパレット

```css
--background: #0b0f14;
--surface: #151a21;
--surface-elevated: #1c232d;

--primary: #00e5ff;
--primary-hover: #33ebff;
--primary-muted: rgba(0, 229, 255, 0.12);

--border: #2a3441;
--border-subtle: #202833;

--text-primary: #f8fafc;
--text-secondary: #94a3b8;
--text-muted: #64748b;

--success: #22c55e;
--warning: #f59e0b;
--error: #ef4444;
```

Electric Cyanは以下に限定して使う。

- メインCTA
- 選択中のナビゲーション
- フォーカスリング
- 分析中インジケーター
- スコアやグラフの主要部分
- ロゴのアクセント

画面全体をネオンにせず、GunmetalをベースにElectric Cyanを差し込む。

## 15. セキュリティ

- S3バケットは非公開
- 動画の閲覧には期限付きURLを使用
- S3キーに元ファイル名を直接使用しない
- ファイルサイズを検証
- MIMEタイプと拡張子を検証
- アップロードには上限100MBを強制したPresigned POSTを使い、有効期限を5分以内にする
- アップロード完了後、分析前に`HeadObject`でキー、サイズ、Content-Typeを再検証し、DBでキーと所有者の対応を確認する
- ユーザーごとにS3パスを分離する
- APIですべて所有者チェックを行う
- AWSアクセスにはこのプロジェクト専用のIAMを作り、権限をBedrock呼び出しと対象S3バケットに最小化する
- 本番環境はVercel OIDC federationでAssumeRoleし、静的なアクセスキーを置かない
- 静的アクセスキーはローカル開発に限定する
- DB接続文字列はアプリ専用ロールのものを使い、`postgres`ロールの認証情報をアプリへ渡さない
- 分析実行に1ユーザーあたり1日の回数上限を設ける
- AIの生レスポンスをブラウザへ直接返さない
- 他ユーザーの動画や分析結果にアクセスできないようにする

S3キーの例：

```text
private/{userId}/{sessionId}/{videoId}/original.mp4
```

## 16. 実装順序

### Phase 0：分析品質検証

- プロジェクト専用IAMとBedrockモデルアクセスの準備
- ソウルリージョンで利用可能な動画対応モデルの棚卸し（`aws bedrock list-foundation-models`および`list-inference-profiles`で実機確認する）
- リージョン整合（S3とBedrockがともにソウル）の確認
- 検証用スケート動画の収集。同一トリックについて通常撮影版とスローモーション版の両方を用意する
- トリック別プロンプトv1の作成
- 候補モデルの比較（Nova系 / TwelveLabs Pegasus 1.2）
- 評価ハーネス（`pnpm eval`）の実装
- 第18章の確認項目による品質判定

候補モデルは実機確認の結果で確定する。Nova 2およびNova Lite 1.5の存在と、それらのソウルでの提供状況を最初に確認する。Nova Lite 1.5は20分の動画まで1FPSのサンプリングを維持するとされており、旧Lite（16分で頭打ち）と挙動が異なる。

Phase 0はPhase 1〜3と並行できるが、Phase 5の実装はPhase 0の品質判定を通過してから始める。

### Phase 1：基盤

- Next.jsプロジェクト作成
- TypeScript
- Tailwind CSS
- shadcn/ui
- Electric Cyan × Gunmetalテーマ
- PostgreSQL（Supabase、東京）
- Vercel実行用のTransaction pooler接続と、管理用のDirect connectionを分離
- Vercel関数リージョンを`hnd1`へ固定（`vercel.json`）
- Supabase keep-alive用のGitHub Actionsワークフロー
- Drizzle ORM

### Phase 2：認証

- Better Auth導入
- 新規登録
- ログイン
- ログアウト
- 認証ガード
- プロフィール登録
- Regular / Goofy設定

### Phase 3：履歴管理

- tricksテーブル
- sessionsテーブル
- 履歴一覧
- 履歴詳細
- トリック別フィルター

### Phase 4：動画アップロード

- S3バケット（ソウル）とCORS設定
- サイズ上限とContent-Typeを強制するPresigned POST
- アップロード完了後の`HeadObject`再検証
- 動画プレビュー
- アップロード進捗
- スローモーション撮影の案内表示
- 期限付き再生URL
- アクセス制御

### Phase 5：AI分析

- Route Handlerの`after()`からのバックグラウンド分析実行（Fluid Compute、`maxDuration = 300`）
- `QUEUED`から`ANALYZING`への原子的な状態遷移と二重実行防止
- Phase 0で選定したモデルの呼び出し
- 本番はVercel OIDC、ローカルはアクセスキーで認証を切り替え
- スタック検出（`ANALYZING`のまま滞留したレコードの`FAILED`化）
- トリック別プロンプト
- JSON Schema検証
- 分析ステータス
- エラーハンドリング
- 再分析
- 1ユーザーあたりの分析回数上限

### Phase 6：分析結果UI

- 総評
- スコア
- 良かった点
- 改善点
- 次回練習
- 分析中画面
- 分析失敗画面

### Phase 7：仕上げ

- サムネイル表示
- ページネーション
- モバイル表示調整
- ログとエラー監視の整備（Vercel / CloudWatch）
- 動画削除

## 17. MVP完成条件

以下がすべて動作した時点をMVP完成とする。

- ユーザー登録とログインができる
- トリックを選択できる
- 20秒以内の動画をアップロードできる
- 動画が非公開でS3に保存される
- AI分析が非同期で実行される
- 分析中、完了、失敗を確認できる
- AI結果が構造化JSONで保存される
- 総評、良かった点、改善点、次回練習を表示できる
- トリック別に履歴を確認できる
- 過去動画を再生できる
- 分析失敗時に再実行できる
- 他ユーザーのデータへアクセスできない

## 18. 実装前に行う分析品質検証（Phase 0）

画面開発より先に、実際のスケート動画を10本程度用意し、Bedrockの分析品質を確認する。

検証スクリプトは使い捨てにせず、`pnpm eval`として再実行できる評価ハーネスにする。プロンプトやモデルを変更するたびに、同じ動画セットで回帰確認を行う。

確認項目：

1. 選択したトリックを正しく理解できるか
2. 成功と失敗をおおむね判定できるか
3. 映像に存在しない動きを推測していないか
4. 改善点が具体的か
5. 同じ動画に対して評価が大きくぶれないか
6. 次回の練習内容が実行可能か
7. 撮影角度による精度差がどの程度あるか
8. 通常撮影とスローモーション撮影で精度がどれだけ変わるか
9. NovaとPegasusで、足元の細かい動きの捉え方にどれだけ差が出るか

8と9はこのプロダクトの成立性そのものを左右するため、最優先で確認する。第7章のとおりNovaのサンプリングは1FPSであり、通常撮影ではトリックの核心部分がモデルに届かない可能性が高い。ここで「スローでなければ使い物にならない」ことが確認できれば、アップロード画面でスロー撮影をどの程度強く要求するかが決まる。

品質が不足する場合は、以下の順番で改善する。

1. スローモーション撮影の要求を強める
2. NovaとPegasusのうち、時間解像度に強い方へ寄せる
3. プロンプトを改善する
4. 撮影角度と距離の指示を具体化する
5. トリック別プロンプトを細分化する
6. 動画から代表フレームを抽出する
7. Geminiと比較検証する
8. MediaPipeによる骨格情報を追加する

## 19. MVPで最も重視すること

tricksightのMVPで最優先すべきなのは、高度な動画解析技術ではない。

最優先するのは、

「自分の動画をもう一度投稿して、前回との違いを確認したい」

と思える分析結果と履歴体験を作ることである。

まずBedrock単体で価値を検証し、骨格解析、動画比較、板の検出などは、MVP後に段階的に追加する。
