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

### 未解決の課題

| 課題 | 内容 |
| --- | --- |
| 分析品質 | 成功・失敗の判定が2件中2件で誤り（上記）。H-1後に最優先で再評価 |
| 評価動画 | H-1 未着手。現在2本（ともにKICKFLIP・スロー版なし） |

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
