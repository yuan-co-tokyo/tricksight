# 分析エラー契約

この文書は、分析処理の内部診断情報とブラウザへ公開するエラーを分離する契約を定義する。

## 情報境界

- `analyses.raw_response` はプロバイダー応答の監査・デバッグ用であり、成功時と出力検証失敗時にDBへ保存する。API、履歴クエリ、Server Componentの表示データへ選択しない。
- `analyses.error_message` はマスク済みの内部診断用であり、APIや履歴クエリへ選択しない。
- `analyses.error_code` は内部原因の分類用に保存する。分析ステータスAPIではそのまま返さず、下記の公開コードへ変換する。
- APIの予期しないAWS・TwelveLabs・DBエラーはサーバ側で記録し、クライアントには固定した公開エラーだけを返す。

## リクエスト時に公開するコード

| 公開コード | HTTP | 次の行動 | 用途 |
| --- | ---: | --- | --- |
| `INVALID_REQUEST` | 400 | `CHECK_INPUT` | 入力を確認して再送する |
| `UNAUTHENTICATED` | 401 | `SIGN_IN` | ログインして再実行する |
| `VIDEO_NOT_FOUND` | 404 | `SELECT_VIDEO` | 自分の動画を選び直す |
| `ANALYSIS_NOT_FOUND` | 404 | `SELECT_VIDEO` | 履歴から分析を選び直す |
| `VIDEO_NOT_READY` | 409 | `WAIT_FOR_UPLOAD` | アップロード完了を待つ |
| `ANALYSIS_STATE_CHANGED` | 409 | `RETRY_ANALYSIS` | 最新状態を確認して再実行する |
| `STANCE_REQUIRED` | 422 | `SET_STANCE` | プロフィールでスタンスを設定する |
| `ANALYSIS_DAILY_LIMIT_REACHED` | 429 | `WAIT_FOR_RESET` | `resetAt`以降に再実行する |
| `ANALYSIS_UNAVAILABLE` | 500 / 503 | `TRY_LATER` | 時間をおいて再実行する |

`ALREADY_IN_PROGRESS` はエラーコードではない。既存の分析IDと状態をHTTP 202で返し、新しい分析や日次枠を作らない。

## FAILED状態で公開するコード

ステータスAPIは内部コードの代わりに、日本語の`message`と`action`を持つ次の4コードだけを返す。

| 公開コード | 次の行動 | 対応する内部コード |
| --- | --- | --- |
| `STANCE_REQUIRED` | `SET_STANCE` | `STANCE_REQUIRED` |
| `VIDEO_REUPLOAD_REQUIRED` | `RECORD_AGAIN` | `ANALYSIS_CONTEXT_NOT_FOUND`, `VIDEO_NOT_READY`, `ASSET_FAILED` |
| `ANALYSIS_RETRYABLE` | `RETRY_ANALYSIS` | `ANALYSIS_STUCK_TIMEOUT`, `ASSET_TIMEOUT`, `ASSET_CREATE_FAILED`, `ANALYZE_FAILED`, `OUTPUT_TRUNCATED`, `INVALID_JSON`, `SCHEMA_VALIDATION_FAILED` |
| `ANALYSIS_UNAVAILABLE` | `TRY_LATER` | 下記の設定・想定外エラーおよび未知のコード |

## 内部専用コード

次のコードはDBとサーバログだけで原因を識別するために使い、ブラウザへ直接返さない。

- 実行基盤・設定: `ANALYSIS_FAILED`, `PROMPT_UNAVAILABLE`, `PROMPT_VERSION_MISMATCH`, `PROVIDER_CONFIG_MISMATCH`, `UNSUPPORTED_PROMPT_VERSION`
- S3: `INVALID_S3_URI`, `BUCKET_MISMATCH`, `PRESIGN_FAILED`
- TwelveLabs: `ASSET_CREATE_FAILED`, `ASSET_FAILED`, `ASSET_TIMEOUT`, `ANALYZE_FAILED`, `OUTPUT_TRUNCATED`, `INVALID_JSON`, `SCHEMA_VALIDATION_FAILED`
- 実行状態: `ANALYSIS_CONTEXT_NOT_FOUND`, `VIDEO_NOT_READY`, `STANCE_REQUIRED`, `ANALYSIS_STUCK_TIMEOUT`
- キュー作成: `PROMPT_UNAVAILABLE`, `CONCURRENT_STATE_CHANGED`, `DAILY_LIMIT_REACHED`

未知の内部コードはfail-closedで`ANALYSIS_UNAVAILABLE`へ変換する。

## マスク規則

`error_message`と`raw_response`への保存前に、次を`[REDACTED]`へ置換する。

- `apiKey`, `authorization`, `cookie`, `credential`, `password`, `secret`, `signature`, `token`等の機密キー配下
- TwelveLabsの`tlk_`トークン
- AWS access key ID（`AKIA` / `ASIA`）
- Bearer token
- `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-Signature`のクエリ値
- エラーのstack（保存対象外）

マスクは外部エラーの`cause`だけでなく、`VideoAnalysisError.details`と`rawResponse`が明示指定された場合にも適用する。workerのDB保存直前にも同じマスクを通す。

## 失敗時のraw response形式

`SCHEMA_VALIDATION_FAILED`、`INVALID_JSON`、`OUTPUT_TRUNCATED`では次のJSON envelopeを`analyses.raw_response`へ保存する。

```json
{
  "kind": "provider_failure",
  "errorCode": "INVALID_JSON",
  "response": {
    "data": "パースできなかった生テキスト",
    "finishReason": "stop"
  }
}
```

成功時のSDKレスポンスと形を分けることで、診断時に成功payloadと失敗payloadを誤認しない。JSONとして壊れたモデル出力も`response.data`の文字列として保持するため、jsonb列へ安全に保存しながら原文を確認できる。
