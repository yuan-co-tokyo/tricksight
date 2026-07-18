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

- Amazon Cognito

### 動画保存

- Amazon S3
- Presigned URLによるブラウザからの直接アップロード

### AI分析

- Amazon Bedrock
- 動画対応のAmazon Novaモデル

### バックエンド処理

- Next.js Route Handler
- AWS Lambda

### データベース

- PostgreSQL
- Drizzle ORM

MVPの開発速度を優先する場合は、NeonまたはSupabaseのPostgreSQLを利用する。

AWSへの統一を優先する場合は、Aurora Serverless v2を利用する。

### インフラ管理

- AWS CDK

### 監視

- Amazon CloudWatch

### ホスティング

第一候補：

- Next.js：Vercel
- AI・動画処理：AWS
- DB：Neon
- 認証：Cognito

AWSに統一する場合：

- Next.js：AWS Amplify Hosting
- AI・動画処理：AWS
- DB：Aurora
- 認証：Cognito

## 6. システム構成

```text
ブラウザ
  │
  ├─ Next.js Webアプリ
  │    ├─ ログイン
  │    ├─ 動画登録
  │    ├─ 分析結果
  │    └─ 履歴表示
  │
  ├─ Cognito
  │    └─ ユーザー認証
  │
  ├─ PostgreSQL
  │    └─ 練習・動画・分析履歴
  │
  └─ Presigned URL取得
           │
           ▼
       Amazon S3
           │
           ▼
         Lambda
           │
           ▼
    Amazon Bedrock / Nova
           │
           ▼
   分析結果をPostgreSQLへ保存
```

## 7. 動画アップロード方式

動画はNext.jsのサーバーを経由させず、ブラウザからS3へ直接アップロードする。

処理の流れは以下とする。

1. Next.js APIへアップロード要求
2. APIがS3 Presigned URLを発行
3. ブラウザからS3へ動画を直接アップロード
4. アップロード完了をAPIへ通知
5. 分析処理を開始

### 動画制限

- 形式：MP4、MOV
- 長さ：3秒から20秒
- 最大ファイルサイズ：100MB
- 1回の投稿につき動画1本
- 縦動画・横動画の両方を許可
- 音声は分析対象外

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
Lambda起動
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

AIの出力は自由文だけでなく、JSON形式に固定する。

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
└─ BedrockNovaVideoAnalyzer
```

将来：

```text
VideoAnalysisProvider
├─ BedrockNovaVideoAnalyzer
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

```text
id
cognito_sub
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
- Presigned URLの期限を短くする
- ユーザーごとにS3パスを分離する
- APIですべて所有者チェックを行う
- LambdaのIAM権限を最小化する
- AIの生レスポンスをブラウザへ直接返さない
- 他ユーザーの動画や分析結果にアクセスできないようにする

S3キーの例：

```text
private/{userId}/{sessionId}/{videoId}/original.mp4
```

## 16. 実装順序

### Phase 1：基盤

- Next.jsプロジェクト作成
- TypeScript
- Tailwind CSS
- shadcn/ui
- Electric Cyan × Gunmetalテーマ
- PostgreSQL
- Drizzle ORM
- AWS CDK

### Phase 2：認証

- Cognito User Pool
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

- S3バケット
- Presigned URL
- 動画プレビュー
- アップロード進捗
- 期限付き再生URL
- アクセス制御

### Phase 5：AI分析

- Lambda
- Bedrock Nova呼び出し
- トリック別プロンプト
- JSON Schema検証
- 分析ステータス
- エラーハンドリング
- 再分析

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
- CloudWatchログ
- エラー監視
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

## 18. 実装前に行う分析品質検証

画面開発より先に、実際のスケート動画を10本程度用意し、Bedrockの分析品質を確認する。

確認項目：

1. 選択したトリックを正しく理解できるか
2. 成功と失敗をおおむね判定できるか
3. 映像に存在しない動きを推測していないか
4. 改善点が具体的か
5. 同じ動画に対して評価が大きくぶれないか
6. 次回の練習内容が実行可能か
7. 撮影角度による精度差がどの程度あるか

品質が不足する場合は、以下の順番で改善する。

1. プロンプトを改善する
2. 撮影方法をユーザーに案内する
3. トリック別プロンプトを細分化する
4. 動画から代表フレームを抽出する
5. Geminiと比較検証する
6. MediaPipeによる骨格情報を追加する

## 19. MVPで最も重視すること

tricksightのMVPで最優先すべきなのは、高度な動画解析技術ではない。

最優先するのは、

「自分の動画をもう一度投稿して、前回との違いを確認したい」

と思える分析結果と履歴体験を作ることである。

まずBedrock単体で価値を検証し、骨格解析、動画比較、板の検出などは、MVP後に段階的に追加する。