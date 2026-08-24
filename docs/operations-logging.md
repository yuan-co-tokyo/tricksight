# MVPのログと障害調査

## 方針

アプリケーションの障害ログはVercel Runtime Logsへ集約する。Vercel Functionsが標準エラー出力へ書いた`console.error`はRuntime Logsに収集され、ルート、HTTPステータス、Vercel Request IDと同じリクエスト単位で確認できる。監視SaaSやLog DrainはMVPでは追加しない。

アプリケーションログは1イベント1行のJSONに統一する。通常成功は記録せず、運用者の対応が必要な失敗と自動復旧だけを対象にする。

| `event` | 意味 | 主な`context` |
| --- | --- | --- |
| `upload.presigned_post.failed` | 認証確認、DB初期化、S3署名、補償削除の失敗 | `stage`, `sessionId`, `videoId` |
| `upload.completion.failed` | S3検証または不正オブジェクト削除の失敗 | `stage`, `sessionId`, `videoId` |
| `video.playback_url.failed` | 再生用署名URLの発行失敗 | `sessionId`, `videoId` |
| `session.deletion.failed` | S3またはDBの削除失敗 | `stage`, `sessionId` |
| `analysis.request.failed` | 分析キュー作成または`after()`内の例外 | `stage`, `analysisId` |
| `analysis.execution.failed` | provider処理をFAILEDとして保存した | `analysisId`, `errorCode` |
| `analysis.status.failed` | 所有者スコープ付き状態取得の失敗 | `stage`, `analysisId` |
| `analysis.stuck_detected` | タイムアウトしたANALYZINGをFAILEDへ遷移した | `analysisId`, `errorCode` |

`level`, `event`, `analysisId`などの固定値で検索し、同じログ行に付くVercel Request IDからリクエスト全体を確認する。S3操作でAWSが返したHTTPステータスとRequest IDは、値の形式を検証したうえでログの`error`へ含める。

## 分析失敗の調査

`analysis.execution.failed`または`analysis.stuck_detected`を検索し、`analysisId`と`errorCode`を特定する。初期切り分けはVercelだけで可能にし、provider本文が必要な場合だけ、アクセスを制限したDB接続で次を確認する。

```sql
select id, status, error_code, error_message, raw_response,
       attempt_count, started_at, completed_at, created_at
from analyses
where id = '<analysisId>';
```

MVPでは運用者が限定され、`raw_response`は内部診断専用かつマスク済みであるため、詳細調査をDB直接参照とする。`raw_response`をVercelへ複製するとログ保持範囲と閲覧範囲が広がるため行わない。

## AWS側の確認

OIDCのAssumeRole失敗は、S3署名・検証・削除を行ったイベントに`CredentialsProviderError`等のエラー種別として現れる。アプリは認証情報そのものをログへ出さない。

ブラウザからS3へのPresigned POSTはVercel Functionを通らないため、そのPOST自体の4xx/5xxをVercelへ記録することはできない。クライアントには既存のエラー案内を出し、運用確認にはS3のCloudWatch request metrics（`PostRequests`, `4xxErrors`, `5xxErrors`）を使う。request metricsはS3で明示的に有効化する有料・best-effortのメトリクスである。

開発用IAMユーザーには`GetMetricsConfiguration`権限がなく、アプリの最小権限を広げて確認・変更してはならない。AWS管理者がS3コンソールのMetricsタブで対象バケットのrequest metrics設定を確認する。

## 秘密情報をログへ出さない境界

- 任意の`Error.message`, `stack`, `cause`、付随オブジェクトはログへ渡さない
- エラーは種別、定型コード、検証済みHTTPステータス、AWS Request IDだけを記録する
- contextのAPIキー、cookie、token、credential、署名、URL/URIに相当するキーは値を`[REDACTED]`へ置換する
- TwelveLabsの`error_message` / `raw_response`は既存の再帰マスク後にDBだけへ保存する
- APIレスポンスには公開エラーコードだけを返し、内部ログやDB診断値を含めない

この契約は`lib/observability/application-log.test.ts`と既存のanalysis/upload routeテストで固定する。

## 参照

- [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime)
- [Vercel: structured application logs](https://vercel.com/kb/guide/add-structured-application-logs-to-vercel-functions)
- [Amazon S3 CloudWatch metrics configurations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/metrics-configurations.html)
