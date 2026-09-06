# tricksight

スケートボードの練習動画をAIが分析し、改善点と上達履歴を残すWebアプリです。

## 開発環境

Node.js 20以上とpnpmを使用します。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

ブラウザで[http://localhost:3000](http://localhost:3000)を開きます。

`.env.local`には秘密情報を設定します。Gitへコミットしないでください。

## 検証

```bash
pnpm dev
pnpm lint
pnpm build
```

## データベース

SupabaseはPostgreSQLとしてのみ利用し、Supabase AuthとStorageは使用しません。`.env.local`にはSupabase Dashboardの **Connect** から取得した実際の接続文字列を設定します。

- `DATABASE_URL`: Vercel実行用のTransaction pooler（ポート6543）。DMLだけを許可したアプリ専用ロールで接続する
- `DATABASE_ADMIN_URL`: マイグレーション用のDirect connection（ポート5432）。DDLが必要なため管理用`postgres`ロールで接続する

Node.jsの`pg` v8.23は`sslmode=require`を`verify-full`として扱い、Supabase poolerで証明書エラーになるため、接続文字列には`uselibpqcompat=true&sslmode=require`を指定します。一方、GitHub Actionsの`psql`が使うRepository secret `SUPABASE_DATABASE_URL`には、`uselibpqcompat`がlibpqのオプションではないため付けず、`sslmode=require`だけを指定します。

Direct connectionへIPv6で到達できない環境では、`DATABASE_ADMIN_URL`だけSession pooler（ポート5432）へ切り替えます。

アプリの侵害や実装ミスによるスキーマ変更を防ぐため、ランタイム接続とマイグレーション接続のロールを分離します。初回セットアップまたはアプリ用パスワードの更新時は、`APP_DB_ROLE`へ`tricksight_app`、`APP_DB_PASSWORD`へ次のコマンドで生成した値を設定し、管理接続でロールと権限を反映します。

```bash
openssl rand -hex 32
pnpm db:setup-role
```

セットアップ後、`DATABASE_URL`のユーザー名をTransaction pooler用の`tricksight_app.<project-ref>`、パスワードを`APP_DB_PASSWORD`と同じ値にします。`DATABASE_ADMIN_URL`は管理用`postgres`ロールのまま変更しません。アプリ用ロールには既存・将来のpublicテーブルへのSELECT/INSERT/UPDATE/DELETEとシーケンス利用だけを付与し、DDL権限は付与しません。

public スキーマは `anon` / `authenticated` の現在・既定権限を剥奪し、全テーブルでRLSを有効にします。アプリ専用ロールには `ownerScope` を所有者境界として全行DMLポリシーを設定します。既存環境へパスワード変更なしでセキュリティ設定だけを適用する手順と、Supabase Data API を無効化する運用は [Database security](docs/database-security.md) を参照してください。

> **ロール再設定時の注意:** `pnpm db:setup-role`は同じパスワードを再適用した場合もSCRAM verifierを作り直すため、Supavisor（Transaction pooler）の認証キャッシュが一時的に不整合になることがあります。
> 直後に`password authentication failed`が出た場合は、少し待って再接続してください。実測では数十秒以内、1回の再試行で回復しました。
> 本番稼働後は、一時的な接続失敗を許容できるタイミングで実行してください。
> `DATABASE_ADMIN_URL`はDirect connectionのため、このキャッシュ不整合の影響を受けません。

```bash
pnpm db:check
pnpm db:migrate
pnpm db:seed
pnpm db:secure -- --apply
pnpm db:verify
```

RLS適用後にランタイム権限エラーが発生した場合の緊急切り戻しは
`pnpm db:secure -- --rollback-rls`、復旧確認は `pnpm db:verify-runtime` を使います。
通常の検証ではセキュリティ設定も確認する `pnpm db:verify` を使ってください。

スキーマを変更した場合は、適用前にSQLと整合性を確認します。

```bash
pnpm db:generate --name=change_name
pnpm db:check
```

Supabaseの停止を避けるGitHub Actionsを使う場合は、Repository secret `SUPABASE_DATABASE_URL`へTransaction poolerの接続文字列を設定します。

## 設計書

- [MVP実装方針](docs/mvp-implementation-plan.md)
- [Database security](docs/database-security.md)
- [AWSセットアップ手順](docs/aws-iam-setup.md)

## 環境変数

DB・認証・AWSを導入する前に、`.env.example`を複製して必要な値を設定します。値の用途は各変数のコメントを参照してください。

動画分析は`VIDEO_ANALYSIS_PROVIDER`で切り替える。未設定時の既定は`bedrock-nova`で、Amazon Nova 2 Liteを使う。比較・切り戻し用の`twelvelabs-direct`と、調査保留中の`bedrock-pegasus`も明示設定で選べる。Bedrock経路ではS3動画をpresigned URLへ変換せず、S3 URIをそのままモデルへ渡す。

Bedrock経路では`AWS_ACCOUNT_ID`も必須である。12桁の対象AWSアカウントIDを設定し、S3参照の`bucketOwner`として使用する。本番Vercelにも設定するが、STS権限の追加は不要である。

Novaの既定値は`jp.amazon.nova-2-lite-v1:0`である。このJP推論プロファイルは東京（`ap-northeast-1`）からだけ呼び出せ、処理先は東京・大阪に限定される。`AWS_REGION`と`S3_BUCKET_NAME`も東京へそろえる必要があり、コードはJPプロファイルと東京以外のリージョンの組み合わせを拒否する。
