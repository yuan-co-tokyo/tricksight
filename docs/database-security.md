# Database security

tricksight は Supabase を PostgreSQL と接続プーラーとしてだけ利用し、Data API
（REST / GraphQL）を利用しない。public スキーマには Better Auth のパスワードハッシュと
セッショントークンを含むため、PostgreSQL の権限と RLS を二重に適用する。

## 防御モデル

`pnpm db:secure -- --apply` は、管理用 `postgres` 接続で次の変更を1トランザクションに
まとめて適用する。途中の検証を含め、1つでも失敗すれば全変更をロールバックする。
DDLロックは5秒、各SQLは30秒でタイムアウトさせ、混雑時に本番リクエストを長時間
待たせる代わりに適用全体を安全に失敗させる。

1. public の全テーブル・シーケンスから `anon` / `authenticated` の全権限を
   `REVOKE` する。`service_role` は Supabase Dashboard の運用機能が利用するため変更しない。
2. `postgres` が public に今後作成するテーブル・シーケンスについても、
   `anon` / `authenticated` への既定権限を `ALTER DEFAULT PRIVILEGES ... REVOKE` する。
3. public の全テーブルで RLS を有効にする。
4. 各テーブルに `tricksight_app_full_access` ポリシーを作り、専用接続ロール
   `tricksight_app` だけへ `USING (true) WITH CHECK (true)` で全行DMLを許可する。
5. commit 前に `SET LOCAL ROLE tricksight_app` へ切り替え、RLSが実際に適用される
   ロールとして全8テーブルのINSERT / SELECT / UPDATE / DELETEを検証する。検証行は
   savepointへロールバックし、1行も残さない。

Supabase の `postgres` は `tricksight_app` に `ADMIN OPTION=true` を持つ一方、
PostgreSQL 16の `SET OPTION=false` である。検証用savepoint内だけmembershipを
`SET TRUE`へ変更し、`ROLLBACK TO SAVEPOINT`で検証行・ロール切替・membership変更をまとめて
元へ戻す。復元後は3つのmembershipオプションが適用前と完全一致することも検証する。
この分離は [PostgreSQL 16のGRANT](https://www.postgresql.org/docs/16/sql-grant.html) と
[SET ROLE](https://www.postgresql.org/docs/16/sql-set-role.html) の仕様に基づく。

権限の `REVOKE` と RLS の両方を使う。前者は Data API ロールがテーブルへ到達する経路を
閉じ、後者は将来の既定権限変更、手動 `GRANT`、その他の運用ミスが起きた場合にも行アクセスを
拒否する。片方の設定ミスだけで公開状態へ戻らないための多層防御である。

RLS ポリシーが `tricksight_app` の全行を許可するのは、アプリ内のユーザー所有者境界を
Route Handler と `ownerScope` が担っているためである。`tricksight_app` はサーバーだけが持つ
専用接続ロールであり、`rolbypassrls=false` のまま使う。RLS はアプリの所有者認可を置き換える
ものではなく、Supabase Data API ロールを遮断する追加境界である。

## 適用手順

`db:setup-role` はパスワードを再設定して Supavisor の認証キャッシュへ影響するため、既存環境の
セキュリティ設定だけを直す場合は専用の `db:secure` を使う。`--apply` が無い実行は拒否される。

```bash
# 1. 適用前に、Transaction pooler経由で全8テーブルのCRUDとrollbackが通ることを確認する
#    未適用環境では末尾のセキュリティ検証が失敗するが、CRUD成功ログを先に確認できる
pnpm db:verify

# 2. 変更内容と対象環境を確認し、承認を得てからだけ実行する
pnpm db:secure -- --apply

# 3. 権限、既定権限、RLS、ポリシー、全8テーブルCRUDをまとめて再検証する
pnpm db:verify
```

### 緊急切り戻し

適用後にTransaction pooler経由のCRUDが権限エラーで失敗した場合は、次を直ちに実行する。

```bash
pnpm db:secure -- --rollback-rls
pnpm db:verify-runtime
```

切り戻しは1トランザクションで全8テーブルのRLSを無効化し、
`tricksight_app_full_access` ポリシーを削除する。`tricksight_app` の既存DML権限は適用処理で
変更していないため、追加の権限復旧は不要である。`anon` / `authenticated` の現在権限と
既定権限の `REVOKE` は意図的に維持する。そのためアプリの従来動作を復旧してもData APIの
直接アクセスは再開しない。

`db:verify-runtime` は管理接続やRLS設定を検証せず、`DATABASE_URL` の
`tricksight_app` だけで全8テーブルCRUDとロールバックを確認する緊急復旧用コマンドである。
通常時は必ず完全版の `pnpm db:verify` を使う。

新しいテーブルを追加したマイグレーション後にも `db:secure` を実行する。既定権限の
`REVOKE` により、新規テーブルはその間も `anon` / `authenticated` へ自動公開されない。
`db:verify` は RLS またはアプリ用ポリシーの追加漏れを検知する。

## Supabase Dashboard で依頼者が行う設定

最優先の推奨は、Dashboard の **Data API integration overview** で
**Enable Data API** をオフにすることである。tricksight は Supabase client、REST、GraphQLを
使わず、Direct connection / Transaction pooler だけを使うため、無効化してもアプリのDB接続には
影響しない。Data APIを無効化すると、権限やRLSとは独立して自動生成RESTエンドポイント自体が
応答しなくなる。

組織の運用上 Data API を無効化できない場合は、**Project Settings > Data API** の
**Exposed Schemas** から `public` を外し、空の専用スキーマだけを公開する。いずれもDashboard側の
設定であり、このリポジトリのスクリプトからは変更しない。

2026-08-27に依頼者が Data API をオフにし、Exposed Schemas から `public` を外した。
APIキー無しの外形確認はKongが先に401を返すため設定状態を区別できないが、DB側では同日に
`anon` / `authenticated` のテーブル権限0件、RLS 8件、アプリ用ポリシー8件を実測した。

参考（Supabase公式）:

- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Securing your data](https://supabase.com/docs/guides/database/secure-data)
