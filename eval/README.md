# Phase 0 評価データ

`input/`には評価用の動画を置く。動画と生成結果はGit管理しない。

## 準備

```bash
cp eval/manifest.example.json eval/manifest.json
mkdir -p eval/input
```

`eval/manifest.json`の各サンプルへ、動画ファイル名と人間が確認した期待結果を記入する。最初はOllieを5〜10本用意し、成功・失敗、通常速度・スローモーション、撮影角度を混ぜる。

## AWS設定の確認

動画分析の前に、課金を発生させず認証情報、S3バケット、Bedrockの動画対応モデルを確認する。

```bash
pnpm verify:aws
```

Nova 2 Liteはオンデマンドの基盤モデルIDでは呼び出せないため、`.env.local`で推論プロファイルIDを指定する。既定構成は東京のS3からJP推論プロファイルを呼ぶ。

```bash
AWS_REGION=ap-northeast-1
S3_BUCKET_NAME=tricksight-dev-561143850472-ap-northeast-1-an
NOVA_MODEL_ID=jp.amazon.nova-2-lite-v1:0
```

BedrockへS3 URIを渡すため、`.env.local`の`AWS_ACCOUNT_ID`には対象S3バケットを所有する12桁のAWSアカウントIDを設定する。プロバイダーはこの値を`bucketOwner`へ渡し、別アカウントのバケットを誤参照しないようにする。

`jp.amazon.nova-2-lite-v1:0`は東京（`ap-northeast-1`）だけがソースリージョンで、処理先は東京・大阪に限定される。コードもJP推論プロファイルと東京以外の`AWS_REGION`の組み合わせを拒否する。旧構成のソウルから使っていた`global.amazon.nova-2-lite-v1:0`はAPAC外を含むAWSの商用リージョンへ転送され得るため、通常の開発・本番設定には使わない。

- [AWS: Nova 2 Lite（推論IDとリージョン別の利用可能性）](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)
- [AWS: Cross-Region inferenceのデータ所在地](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)

`ThrottlingException: Too many tokens per day`が最初のリクエストから発生する場合は、コードや再試行ではなくAWSアカウントに割り当てられた日次トークンクォータが原因である。AWSコンソールの **Service Quotas → Amazon Bedrock → ap-northeast-1** で、Nova 2 Liteの「Cross-Region InvokeModel tokens per minute」と日次上限を確認し、必要なら増枠申請する。Novaが利用できない間も、`pnpm eval -- --provider pegasus`でPegasus単体の評価は継続できる。

## 実行

```bash
pnpm eval
```

特定モデルだけを実行する場合は、次のように指定する。

```bash
pnpm eval -- --provider nova
pnpm eval -- --provider nova --sample ollie-001
pnpm eval -- --provider pegasus
pnpm eval -- --provider pegasus --sample ollie-001
```

`--sample <id>`を付けるとmanifest内の1件だけを実行する。NovaとPegasusの両経路とも本番と同じ`VideoAnalysisProvider`実装を使い、プロンプトとレスポンス検証を共通化している。NovaはJSON Schemaによる構造化出力を利用できないため、スキーマをプロンプト内の指示として渡す。モデルがJSONをMarkdownコードフェンスで囲む既知の形式差はNovaプロバイダー内で除去し、その後もJSON構文またはzod検証に失敗した場合だけ1秒後に1回再試行する。各呼び出しの上限を134.5秒とし、再試行を含む最悪時間を270秒以内に抑える。

スクリプトは動画を`S3_BUCKET_NAME/eval/`へアップロードし、結果を`eval/output/`にJSONで保存する。評価用のS3オブジェクトは自動削除しない。比較が終わったらS3コンソールまたはAWS CLIから`eval/`プレフィックスを削除する。

片方のモデルが失敗しても、`--provider both`ではもう片方を実行し、失敗内容を同じ結果JSONの`error`へ保存する。SDKやプロバイダーの`cause`は、既存の秘密値マスクを通した`errorDetails`へ保存する。`attemptCount`には実際のモデル呼び出し回数を保存し、SDK到達前など判定不能な失敗では`null`にする。両方が失敗した場合だけ終了コードを1にする。

## TwelveLabs公式APIでPegasus 1.5を試す

`.env.local`に以下を設定する。

```bash
TWELVELABS_API_KEY=...
TWELVELABS_MODEL_NAME=pegasus1.5
```

最初に、動画分析を行わずAPIキーだけを確認する。

```bash
pnpm verify:twelvelabs
```

コストを抑えるため、引数なしではmanifestの先頭の1本だけを分析する。特定のサンプル、または全件を実行する場合は次のように指定する。

```bash
pnpm eval:twelvelabs
pnpm eval:twelvelabs -- --sample ollie-001
pnpm eval:twelvelabs -- --all
```

Pegasus 1.5では、本番と同じ`TwelveLabsDirectVideoAnalyzer`を使って同期分析する。ローカル動画は最初に`S3_BUCKET_NAME/eval/`へアップロードされ、presigned GET URL経由でTwelveLabsのAssetになる。S3オブジェクトのキーには動画内容のSHA-256を使い、同じ内容が既にS3にあれば再アップロードしない。TwelveLabsのAsset IDはキャッシュせず、評価ごとに新しいAssetを作成する。

評価結果には`sample`、`durationMs`、`analysis`に加えて、`provider`、`modelId`、共通プロンプトとトリック別プロンプトを組み合わせた`promptVersion`を保存する。失敗時は`error_code`と`error`を確認する。入力動画と分析結果はGit管理しない。

## 評価時の確認項目

- トリックと成功・失敗を正しく認識できているか
- 映像にない動きを断定していないか
- 改善点が映像の観測内容に基づき、次回の練習で使えるか
- スローモーション動画で足元・ポップへの言及が改善するか
- 同じ入力で構造化JSONが安定して返るか
- `scores`の5項目（setup、pop、bodyBalance、footControl、landing）が0〜100の整数で返るか
