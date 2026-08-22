# tricksight MVP タスク分割

`docs/mvp-implementation-plan.md` を実装単位へ分解したもの。leader が coder へ依頼する際の単位はこの表の1行とする。

## 進捗（2026-08-14 時点）

| グループ | 状態 |
| --- | --- |
| T0（ブロッカー解消） | **完了** |
| T1（分析コアの共通化） | T1-1 / T1-2 / T1-3 完了、T1-4 以降が残り |
| T2〜T8 | 未着手 |
| T9（Bedrock解禁後） | 保留 |

完了済みの内訳：

- T0-1 `.env.local` の `DATABASE_ADMIN_URL` 重複解消
- T0-1a リージョンを東京（ap-northeast-1）へ作り直し
- T0-1b / T0-1c TLS指定を `uselibpqcompat=true&sslmode=require` へ、管理用接続をDirect connectionへ
- T0-2 `BETTER_AUTH_SECRET` 設定
- T0-3 マイグレーション適用（8テーブル）
- T0-4 tricks 3件シード（冪等）
- T0-5 Transaction pooler経由のDrizzle CRUD・トランザクション・ロールバック検証
- T1-1 `lib/analysis/schema.ts`（`scores` 追加、JSON Schemaはzodから生成）
- T1-2 vitest導入とスキーマのユニットテスト
- T1-3 `prompts/` 分離とscores採点基準の明文化
- T0-6 アプリ専用DBロール `tricksight_app` の作成とランタイム接続の切り替え

### T0-6 の実測メモ

Supabase の `postgres` ロールは **superuser ではない**（`rolsuper=false` / `rolcreaterole=true`）。このため `ALTER ROLE ... NOSUPERUSER` は `permission denied to alter role` で拒否される。`ALTER ROLE` の各句を個別に試した結果、拒否されるのは `nosuperuser` のみで、`login` / `nocreatedb` / `nocreaterole` / `noreplication` / `nobypassrls` は通る。

`setup-app-role.ts` は ALTER 分岐から `nosuperuser` を外し、代わりに適用後の `pg_roles` 検証で `rolsuper` が false であることをアサートしている。

付与された権限（実測）:

- `tricksight_app`: `rolcanlogin=true`、他の昇格属性はすべて false
- public の全8テーブルへ `SELECT / INSERT / UPDATE / DELETE` のみ（DDLなし）
- `ALTER DEFAULT PRIVILEGES` により、今後のマイグレーションで `postgres` が作るテーブル・シーケンスにも同じ権限が自動付与される（`pg_default_acl` に `tricksight_app=arwd/postgres` を確認）

`pnpm db:verify` は6項目すべて成功する。

- T0-7 意味のある単位で9コミットに分割し `main` へ push
- keep-alive の有効化（ワークフローをpush、Secret設定、手動実行で疎通確認）

### keep-alive の構成

- Secret `SUPABASE_DATABASE_URL` は **`tricksight_app` の東京Transaction pooler接続文字列**。`uselibpqcompat` は付けない（psql=libpqは解釈しないため。libpqでは `sslmode=require` が元々「暗号化するが検証しない」意味なのでそのままで正しい）
- Direct connectionはIPv6専用でGitHub Actionsランナーから到達できないため、poolerを使う
- 2026-08-15 に `workflow_dispatch` で手動実行し、`select 1;` が `(1 row)` を返して成功することを確認済み

### Vercel maxDuration の実測（2026-08-16）

Vercel Hobby + Fluid Compute の本番環境で、Route Handler に指定した `maxDuration = 300` が実効であることを確認した。計測時の稼働リージョンは、レスポンスの `x-vercel-id` により `hnd1` であることを確認済み。

| 要求秒数 | 結果 |
| --- | --- |
| 1秒 | 200 / elapsed 1.0秒 |
| 30秒 | 200 / elapsed 30.0秒 |
| 120秒 | 200 / elapsed 120.0秒 |
| 280秒 | 200 / elapsed 280.0秒 |

この実測により、計画書§8の Route Handler `after()` 方式で T6 のバックグラウンド分析を進める判断が確定した。Lambda など別のジョブ実行基盤への切り替えは不要とする。また、Vercel 関数から Supabase の東京 Transaction pooler への疎通も本番環境で実証済み。

### TwelveLabs の JSON Schema 制約（実測）

TwelveLabs の `responseFormat.jsonSchema` は **numeric constraints を受け付けない**。`minimum` を含めると、動画処理の前に400で拒否される。

```
Status code: 400
{ "code": "response_format_invalid",
  "message": "...invalid response format: numeric constraints ('minimum') are not supported" }
```

対応：zodスキーマ側の `minimum` / `maximum` は**維持したまま**、APIへ渡すJSON Schemaからのみ除去する。`lib/analysis/schema.ts` の `toProviderJsonSchema(schema, { strip })` が再帰的に除去し、除去対象はプロバイダ側（`twelvelabs-direct.ts`）が指定する。除去したのは `$schema` / `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` で、`additionalProperties: false` は受け付けられたため残している。

400はビデオ処理前に返るため課金は発生しない。切り分けは無料で回せる。

### 分析品質の所見（要注意）

T1-6 の実測（kickflip-001、スロー撮影なし・正面）:

| 項目 | 値 |
| --- | --- |
| scores | setup 85 / pop 80 / bodyBalance 85 / footControl 80 / landing 90 |
| detected | trickMatchesSelection=true, visibility=**GOOD** |
| result | outcome=**LANDED**, confidence=**0.9** |
| 人間の期待値 | outcome=**BAILED** |

**失敗した試技を、確信度0.9で成功と判定している。** 2026-08-12 の旧評価でも kickflip-002（期待BAILED）を LANDED と判定しており、2件2件とも成功・失敗の判定を誤っている。

これは計画書§18の確認項目2「成功と失敗をおおむね判定できるか」が現時点で通っていないことを意味する。outcome が誤っていれば scores も意味を持たない。

依頼者の判断により品質ゲートは後回しとしT6まで作るが、**この所見はプロダクトの成立性に直結する**ため、H-1（スロー撮影を含む評価動画10本）の収集後に最優先で再評価すること。改善は計画書§18の順序（1.スロー撮影の要求を強める → 2.モデル選択 → 3.プロンプト改善）で行う。

### T6 のローカル通し確認（2026-08-17）

ローカルの dev サーバーに対して、ユーザー作成 → stance 設定 → Presigned POST 発行 → S3 直接アップロード → 完了通知 → 分析実行 → ステータスポーリング → DB 検証、までを実APIで通した。

**動作した箇所:**

- S3アップロード 204（18,048,818 bytes）、完了通知 200 で `videos.status=UPLOADED`
- `s3_key` が §15 の形式 `private/{userId}/{sessionId}/{videoId}/original.mp4` になっている
- 分析APIが 202 `{analysisId, status:"QUEUED"}` を返し、`QUEUED → ANALYZING → 決着` を約26秒で遷移
- `provider=twelvelabs` / `model_id=pegasus1.5` / `prompt_version=common-system-v1+kickflip-v1` / `attempt_count=1` / `started_at`・`completed_at` が記録される
- ステータスAPIの返却キーは `analysisId` / `status` / `error` のみ。`raw_response` と `errorMessage` の露出なし（§15を満たす）

**検出したバグ2件（未修正・coderの枠回復後に対応）:**

#### B-1: `result.confidence` が範囲外で毎回スキーマ検証に落ちる（優先度: 高）

```
error_code: SCHEMA_VALIDATION_FAILED
result.confidence — "Too big: expected number to be <=1"
```

TwelveLabs は JSON Schema の numeric constraints を受け付けないため、APIへ渡すスキーマから `minimum`/`maximum` を除去している（上記「TwelveLabs の JSON Schema 制約」参照）。その結果モデルは範囲を知らずに回答する。

`prompts/common-system-v1.ts` は **`scores` の 0〜100 スケールを6段階で詳細に定義している一方、`confidence` の 0〜1 スケールには一切触れていない**。モデルが scores と同じスケールで `confidence` を返したと考えられる。

成功ケースでも再現する可能性が高く、これが直らないと分析結果が1件も保存されない。T7 の前に修正すること。

対応方針：まず `common-system-v1.ts` に `confidence` が 0〜1 の小数であることを明記する。プロンプト修正だけで安定するかを実測で確認し、不安定ならプロバイダ側での正規化を検討する。

#### B-2: 検証失敗時に `raw_response` が保存されない（優先度: 中）

スキーマ検証で落ちた分析の `raw_response` が null のため、**モデルが実際に返した値が分からない**。B-1 でも「confidence が 90 だったのか 1.5 だったのか」を確認できなかった。

T1-6-fix1 で `error_message` にAPIエラー本文を保存する対応を入れたが、`raw_response` は成功時のみ保存される作りになっている。検証失敗時こそ診断に必要なので、失敗時も保存すること（§15のとおりクライアントへは返さない）。

#### B-3: 署名発行に失敗しても sessions / videos の行が残る（優先度: 中）

本番環境（AWS環境変数が未設定）で `/api/uploads/presigned-post` を叩いたところ、`500 UPLOAD_INITIALIZATION_FAILED` を返しつつ、**`sessions` と `videos` の行が `PENDING_UPLOAD` で作成されたまま残った**。

`presigned-post` は §7 のとおり「先に sessions / videos を作って s3Key を確定 → その後に署名を発行」という順序になっているが、**署名発行の失敗時に作成済みの行をロールバックしていない**。失敗するたびにゴミ行が増え、履歴一覧にも `PENDING_UPLOAD` として現れる。

対応方針：署名発行までを含めて原子的に扱い、署名に失敗したら行を残さないこと。あるいは失敗時に明示的に削除すること。T4-2 の `createPendingUpload` は sessions と videos の作成をトランザクションにしているが、その外側にある署名発行の失敗が考慮されていない。

### 本番環境の未設定項目

Vercel Production に設定されているのは `DATABASE_URL` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` のみ。`S3_BUCKET_NAME` / `AWS_REGION` / AWS認証情報が無いため、**本番では動画アップロードが動作しない**（2026-08-18 に実機で確認）。

ただし §5・§15 により本番へ静的アクセスキーを置くことはできないため、有効化には Vercel OIDC federation の実装が前提となる。順序は「OIDC実装 → B-1/B-2/B-3 修正 → 本番通し確認」とする。

### 評価結果（2026-08-18、14サンプル）

成功7・失敗7の均衡したセットで評価を実施。結果は `eval/output/twelvelabs-2026-08-18T14-30-25.486Z.json`。

**B-1 は修正済み。** `prompts/common-system-v2.ts` で「confidenceは0以上1以下の小数。scoresの0〜100とは尺度が異なる」旨を追記したところ、14本すべてがスキーマ検証を通過し、confidence は 0.8〜0.95 に収まった。評価実行時は暫定的に `common-system-v1` のversion文字列のまま内容だけを変更していたが、保存済みのCOMPLETED分析がまだ無い段階でv1を元へ戻し、本番用の変更をv2として固定した。以後、プロンプト内容を変更するときはversionを上げ、過去の分析条件を追跡可能に保つ。

**分析品質の判定結果:**

| 指標 | 値 |
| --- | --- |
| 正答 | **6/14（43%）** |
| 成功を成功と判定（TP） | 6 |
| **失敗を失敗と判定（TN）** | **0** |
| 失敗を成功と誤判定（FP） | 6 |
| 成功を失敗と誤判定（FN） | 1 |

「常に LANDED と答える」ダミーが 50% を取るため、**それを下回っている**。失敗7本のうち6本を確信度0.9〜0.95で `LANDED` と判定し、1本が `UNCLEAR`。**正解はゼロ。**

**スコアが映像を反映していない:**

```
ollie-001 (成功)  85/80/85/80/85
ollie-004 (失敗)  85/80/85/80/90   ← 失敗の方が高い
ollie-007 (失敗)  85/80/85/80/85   ← 成功と完全に同一
```

同一値の繰り返しで成功・失敗と相関がない。`visibility` も14本すべて `GOOD`。テンプレート的な出力になっている疑いが強い。

計画書§19 の「もう一度投稿して前回との違いを確認したい」という中心価値が、この品質では成立しない。

**交絡：スロー撮影かどうかで説明できない**

動画の長さを実測したところ、スロー撮影と明記された kickflip-004/005（11.8秒・10.1秒）は**2本とも成功動画で正解**。一方、**失敗動画7本はすべて4〜6秒＝通常撮影相当**。

つまり「失敗を検出できないのがモデルの限界か、失敗動画が通常撮影だからか」を切り分けられていない。両者が完全に交絡している。

**次の一手：失敗した試技をスロー撮影で2〜3本用意する。**

- 検出できるようになれば §7 の仮説（スローが前提条件）が裏付けられ、スロー撮影を必須とする設計判断の根拠になる
- 検出できなければモデル側の限界であり、§18 の改善順序2番目「Nova と Pegasus のうち時間解像度に強い方へ寄せる」へ進む根拠になる（Bedrockクォータ解禁後）

### 未解決の課題

| 課題 | 内容 |
| --- | --- |
| **分析品質** | **失敗検出が0/7。プロダクトの成立性に直結。スロー撮影の失敗動画で交絡を解くのが次の一手** |
| B-1 confidence範囲外 | **修正済み。** confidenceの0〜1尺度を`common-system-v2`に明記し、14本すべてschema通過 |
| B-2 失敗時のraw_response | 診断ができない |
| B-3 署名失敗時のゴミ行 | 失敗のたびに PENDING_UPLOAD の行が増える |
| Vercel OIDC未実装 | `AWS_ROLE_ARN` / `AssumeRole` / `@vercel/functions` いずれも未実装。§5・§15により本番へ静的アクセスキーを置けないため、本番での分析実行の前提 |
| 分析品質 | 成功・失敗の判定が2件中2件で誤り（上記）。H-1後に最優先で再評価 |
| 評価動画 | H-1 未着手。失敗した試技を含むセットが必要 |

## 前提

- **Bedrockは待ち**：AWS Bedrockのクォータ申請中のため、`BedrockNovaVideoAnalyzer` / `BedrockPegasusVideoAnalyzer` は実装しない。
- **当面の分析はTwelveLabs公式API**：Pegasus 1.5をIndex無しのAsset同期分析で使う（`scripts/eval-twelvelabs.ts` で疎通済み）。
- 計画書§10の `VideoAnalysisProvider` インターフェースは変更しない。TwelveLabsアダプタが `videoS3Uri` を受け取り、内部でS3のpresigned GET URLを発行して `assets.create({ method: "url" })` に渡す。これによりBedrock解禁時はアダプタ差し替えのみで済む。

## 現状の棚卸し

### できているもの

- Next.js 16 / TypeScript / Tailwind v4 / shadcn/ui（12コンポーネント導入済み）
- Drizzle スキーマ一式（`lib/db/schema/app.ts`、`auth.ts`）と初期マイグレーションSQL
- `lib/db/index.ts`（pg + Transaction pooler前提のPool設定）
- `lib/auth.ts`（Better Auth設定。`display_name` マッピングと `stance` 追加フィールド）
- Supabase keep-alive の GitHub Actions ワークフロー
- 評価ハーネス2本（`pnpm eval` = Bedrock、`pnpm eval:twelvelabs` = 公式API）
- TwelveLabs公式APIが構造化JSONを返すことを実測で確認済み

### 未着手・欠落

| # | 内容 | 影響 |
| --- | --- | --- |
| 1 | `.env.local` の `DATABASE_ADMIN_URL` が2行あり、後勝ちでプレースホルダになっている | `pnpm db:verify` / マイグレーションが失敗する |
| 2 | `BETTER_AUTH_SECRET` が未設定 | Better Authが動かない |
| 3 | `SkateAnalysisResult` の **`scores` 5項目が丸ごと欠落**（zodスキーマ・プロンプト・JSON Schemaすべて） | 計画書§9の必須項目。結果画面のスコア表示が作れない |
| 4 | 分析スキーマとプロンプトが2本の評価スクリプトに重複定義され、`lib/` `prompts/` に無い | 計画書§10・§11違反。Route Handlerから再利用できない |
| 5 | テストランナー未導入 | 計画書§9「検証ロジックにはユニットテストを用意する」が未達 |
| 6 | 画面が `app/page.tsx` のみ | 認証・アップロード・結果・履歴すべて未着手 |
| 7 | Route Handlerが1本も無い | — |
| 8 | `vercel.json` が無い | 関数リージョン `hnd1` 固定が未適用 |
| 9 | 評価動画が2本のみ（ともにKICKFLIP・スロー版なし） | 計画書§18の確認項目8・9（最優先）が判定できない |

---

## T0：ブロッカー解消

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T0-1 | ~~`.env.local` の `DATABASE_ADMIN_URL` 重複行を削除し、実値の1行だけ残す~~ **完了（2026-08-13）** | — |
| T0-1a | **Supabaseプロジェクトのリージョンを決める（要判断・下記参照）** | 計画書§5と整合が取れている |
| T0-1b | 接続文字列のTLS指定を `?uselibpqcompat=true&sslmode=require` に変更する。`.env.example` と `docs/` も併せて更新 | `pnpm db:verify` が証明書エラーで落ちない |
| T0-2 | `BETTER_AUTH_SECRET` を `openssl rand -base64 32` で生成して設定 | 値が入っている |
| T0-3 | マイグレーション適用（`pnpm db:migrate`） | 全テーブル・enum・インデックスがSupabaseに存在する |
| T0-4 | `pnpm db:seed` で tricks 3件（Ollie / Pop Shove-it / Kickflip）投入 | `slug` 重複なく3行 |
| T0-5 | Transaction pooler経路でCRUDとトランザクションが動くことを確認（計画書§5の「named prepared statementを使えない」制約の実機確認） | `pnpm db:verify` が通る |

### T0-1a：リージョン不一致（実測値）

現在の `DATABASE_URL` / `DATABASE_ADMIN_URL` はどちらも **`aws-0-ap-south-1`（ムンバイ）** を指している。計画書§5はSupabaseを選んだ理由を「東京リージョンがあることの一点」としており、この構成では選定理由が成立しない。

日本のクライアントからのTCP接続RTT実測（2026-08-13、各4回）:

| ホスト | 平均 |
| --- | --- |
| `aws-0-ap-south-1.pooler.supabase.com`（ムンバイ） | 約131ms |
| `aws-0-ap-northeast-1.pooler.supabase.com`（東京） | 約10ms |

差は1往復あたり約120ms。計画書§5は「シンガポールは1ページ2〜4往復で毎リクエストに140〜280msが乗る」ことを理由にNeonを見送っているが、ムンバイはそれより悪い（240〜480ms相当）。

**現時点ではマイグレーションが未適用でデータが無いため、作り直しのコストはほぼゼロ。** 後に移すと `pg_dump` とリストアが必要になる。

### T0-1b：TLS指定（実測で原因特定済み）

`pg` v8.23 は `sslmode=require` を `verify-full` として扱うため、Supabase poolerの証明書チェーンで `self-signed certificate in certificate chain` になる。実測結果:

| 接続文字列 | 結果 |
| --- | --- |
| `?sslmode=require`（現状） | NG（self-signed certificate in certificate chain） |
| `?uselibpqcompat=true&sslmode=require` | **OK**（PostgreSQL 17.6に接続成功） |
| `?sslmode=no-verify` | OK（ただし検証を切るため採用しない） |

`uselibpqcompat=true&sslmode=require` を採用する。リージョンの決定とは独立に必要な修正。

## T1：分析コアの共通化（Phase 0の資産を `lib/` へ昇格）

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T1-1 | `lib/analysis/schema.ts` を作り `SkateAnalysisResult` のzodスキーマを単一の正とする。**`scores`（setup / pop / bodyBalance / footControl / landing）を追加**。JSON Schemaはzodから生成する | 計画書§9の型と完全一致 |
| T1-2 | テストランナー（vitest）を導入し `lib/analysis/schema.test.ts` を書く。正常系・必須欠落・範囲外スコア・余剰プロパティ | `pnpm test` が通る |
| T1-3 | `prompts/` を作る（`common-system-v1.ts` / `ollie-v1.ts` / `pop-shove-it-v1.ts` / `kickflip-v1.ts`）。**scoresの採点基準を明文化**し、トリックごとの着眼点を分ける | ベタ書きプロンプトが評価スクリプトから消える |
| T1-4 | `lib/analysis/provider.ts` に `VideoAnalysisProvider` インターフェースを定義（計画書§10のまま） | — |
| T1-5 | `lib/analysis/providers/twelvelabs-direct.ts` を実装。`videoS3Uri` → S3 presigned GET URL → `assets.create({ method: "url" })` → `analyze` → zod検証 | Route Handlerから呼べる純粋モジュール。Next.js非依存 |
| T1-6 | `scripts/eval-twelvelabs.ts` と `scripts/eval-video.ts` を T1-1〜T1-5 を使う形にリファクタし重複を排除。既存の評価結果と回帰比較する | `pnpm eval:twelvelabs` が従来どおり動く |

## T2：認証（Phase 2）

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T2-1 | Better Auth の Route Handler（`app/api/auth/[...all]/route.ts`）とクライアント（`lib/auth-client.ts`） | セッションが張れる |
| T2-2 | 新規登録・ログイン画面 | メール＋パスワードで登録・ログインできる |
| T2-3 | ログアウトと認証ガード。未ログインは `/login` へ | 保護ルートに直アクセスできない |
| T2-4 | プロフィール画面（`display_name` / `stance` の Regular・Goofy 設定） | DBに反映される |

## T3：UI土台（Phase 1の残り）

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T3-1 | `vercel.json` で関数リージョンを `hnd1` に固定 | — |
| T3-2 | 計画書§14のカラーパレットを `app/globals.css` に確定。Electric Cyanは§14の限定用途のみ | ダークモード基調で統一 |
| T3-3 | アプリシェル（ヘッダー、ナビ、認証状態表示） | 全画面で共通 |
| T3-4 | ランディングページ（ロゴ、説明、ログイン・新規登録導線、キャッチコピー） | — |

## T4：履歴の骨格（Phase 3）

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T4-1 | tricks 取得層とトリック選択UI | 3トリックが出る |
| T4-2 | sessions 作成処理（練習日・撮影方向・成功失敗・メモ）。所有者を必ずセッションから取る | 他ユーザーIDを指定できない |
| T4-3 | 履歴一覧（サムネイル・トリック名・練習日・成功失敗・スコア・分析ステータス、トリック別フィルター） | 自分の分だけ出る |
| T4-4 | 履歴詳細（登録情報・AI結果・分析モデルと日時） | 他ユーザーのIDで404 |
| T4-5 | ダッシュボード（最新分析・最近の動画・トリック別投稿数・最新の改善ポイント・分析開始ボタン） | — |

## T5：動画アップロード（Phase 4）

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T5-0 | S3バケット（ソウル）作成とCORS設定。`docs/aws-iam-setup.md` へ手順追記 | **人間の作業**。バケット非公開 |
| T5-1 | Presigned POST 発行 Route Handler。キー完全一致・`content-length-range` 100MB・Content-Type完全一致（mp4/quicktime）・有効期限5分をポリシーに含める | ポリシー条件をテストで確認 |
| T5-2 | ブラウザ直アップロード＋進捗表示＋動画プレビュー＋長さ3〜20秒のクライアント検証 | — |
| T5-3 | アップロード完了通知API。`HeadObject` でキー・サイズ・Content-Typeを再検証し、DB上のユーザーIDとキーの対応も照合。失敗したオブジェクトは削除 | 別ユーザーのキーを指定すると拒否される |
| T5-4 | 期限付き再生URL（presigned GET）とアクセス制御 | 直リンクが期限切れになる |
| T5-5 | スローモーション撮影の要求UI（撮影画面・アップロード画面の両方、計画書§7） | 必須要件として明示される |

## T6：非同期分析（Phase 5・TwelveLabs公式APIで実施）

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T6-1 | `analyses` 行を QUEUED で作る処理と、動画ごとに QUEUED / ANALYZING を同時1件に制限する部分ユニークインデックス（マイグレーション追加） | 二重投入がDBで弾かれる |
| T6-2 | Route Handler の `after()` からバックグラウンド分析を実行。`runtime = "nodejs"` / `maxDuration = 300`。未awaitのPromiseを残さない | 202を返した後に処理が完了する |
| T6-3 | QUEUED → ANALYZING の条件付きUPDATE。更新0件ならプロバイダを呼ばず終了 | 二重課金が起きない |
| T6-4 | ステータス確認APIとスタック検出（ANALYZING のまま10分超はFAILED化） | 異常終了した行が回収される |
| T6-5 | 再分析（既存行を戻さず新規 `analyses` 行を作る） | 過去の分析条件が残る |
| T6-6 | 1ユーザーあたり1日の分析回数上限 | 上限超過で拒否される |
| T6-7 | エラーハンドリング。AIの生レスポンスをブラウザへ返さない | `raw_response` はDB止まり |

## T7：分析結果UI（Phase 6）

| ID | タスク | 完了条件 |
| --- | --- | --- |
| T7-1 | 分析中画面（数秒ごとにステータスAPIをポーリング、完了で自動遷移） | WebSocketを使わない |
| T7-2 | 結果画面（動画プレーヤー・総評・スコア5項目・良かった点・改善点・次回練習・ユーザーメモ） | — |
| T7-3 | 分析失敗画面と再分析ボタン | — |
| T7-4 | `detected.visibility` が `POOR` のとき撮影方法の再案内を出す | 計画書§7 |

## T8：仕上げ（Phase 7）

| ID | タスク |
| --- | --- |
| T8-1 | サムネイル表示 |
| T8-2 | ページネーション |
| T8-3 | モバイル表示調整 |
| T8-4 | ログとエラー監視の整備 |
| T8-5 | 動画削除（S3オブジェクトも消す） |

## T9：Bedrock解禁後（保留）

| ID | タスク |
| --- | --- |
| T9-1 | `BedrockPegasusVideoAnalyzer` を `VideoAnalysisProvider` 実装として追加 |
| T9-2 | `BedrockNovaVideoAnalyzer` を追加（プロンプト依存のJSON生成のためパース失敗時リトライを実装） |
| T9-3 | 同一動画セットで TwelveLabs公式API / Pegasus on Bedrock / Nova を比較（計画書§18の確認項目9） |
| T9-4 | 比較結果に基づき既定プロバイダを決定。落選側も評価ハーネスから呼べる状態で残す |
| T9-5 | 本番のAWSアクセスをVercel OIDC federationへ切り替え |

## H：人間（依頼者）側の作業

| ID | タスク | 理由 |
| --- | --- | --- |
| H-1 | 評価動画を10本程度そろえる。**同一トリックの通常撮影版とスローモーション版をペアで**、成功・失敗と撮影角度を混ぜる | 計画書§18の確認項目8・9は最優先だが、現在の2本（KICKFLIP・スロー版なし）では判定できない |
| H-2 | S3バケット（ソウル）の作成とCORS設定 | T5-0の前提 |
| H-3 | Bedrockクォータ申請の進捗共有 | T9の開始判断 |

## 実装順序

```text
T0 ─→ T1 ─→ T2 ─→ T3 ─→ T4 ─→ T5 ─→ T6 ─→ T7 ─→ T8
                                                    ↑
                        H-1（評価動画収集）─→ Phase 0品質判定
                                                    │
                                     T9（Bedrock解禁後）←┘
```

### 品質ゲートの扱い（決定事項）

計画書§16は「Phase 5の実装はPhase 0の品質判定を通過してから始める」としているが、**本プロジェクトではこれを適用せず、先にT6までエンドツーエンドを通す**。

理由：分析精度が不足していた場合でも、非同期実行・ステータス管理・再分析の配管はそのまま使い回せる。プロンプト改善とモデル比較はエンドツーエンドが動いてから回す方が、評価の反映サイクルが速い。

したがって：

- coder は品質判定を待たず T0 → T7 まで直列に進める
- H-1（評価動画10本の収集）は並行して進め、そろった時点で `pnpm eval:twelvelabs` を回して精度を測る
- プロンプト改善（計画書§18の改善順序1〜5）は T7 完了後、または精度不足が明らかになった時点で着手する
- **この判断のリスク**：T1で確定させる `SkateAnalysisResult`（特に `scores`）が、精度検証の結果で作り直しになる可能性がある。スキーマは `lib/analysis/schema.ts` の1箇所に集約し、UIはその型から導出することで、変更時の波及を最小化しておくこと

### 依頼粒度（決定事項）

leader は本書の**1行（T0-1 のようなID単位）で coder へ依頼し、その都度検収する**。Tグループをまとめて渡さない。
