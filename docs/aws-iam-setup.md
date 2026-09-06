# AWSセットアップ手順（tricksight用）

Phase 0の分析品質検証と、以後のMVP開発で使うAWS側の権限を用意する手順。

管理者権限のアカウントでAWSコンソールにログインして作業する。

## 前提となるリージョン方針

| 用途 | リージョン |
| --- | --- |
| S3（動画） | 東京 `ap-northeast-1` |
| Bedrock（分析） | 東京 `ap-northeast-1` |
| Vercel関数 | 東京 `hnd1` |
| Supabase（DB） | 東京 `ap-northeast-1` |

S3とBedrockの呼び出し元は同じ東京に置く。S3 URIで動画を渡すため、バケットはBedrockの呼び出し元リージョンと同一にする。

当初はTwelveLabs PegasusのAPAC提供がソウルだけだったためソウルを選んだが、17本の品質比較でNova 2 Liteを既定に決定した。`jp.amazon.nova-2-lite-v1:0`は東京からだけ呼び出せ、処理先は東京・大阪に限定される。旧ソウル構成のGlobal推論と異なり、動画処理を日本国内に保てるため東京へ移行する。

> **移行前の重要事項:** 現在の`tricksight-vercel-role`にはNovaを呼ぶ`bedrock:InvokeModel`が付与されていない。東京バケットへのS3権限と、下記のJP推論プロファイル権限を追加するまで、本番で`bedrock-nova`は動作しない。

認証情報の持ち方は環境で分ける。

- **本番（Vercel）**：Vercel OIDC federationでIAMロールをAssumeRoleする。静的キーを置かない。
- **ローカル開発**：IAMユーザーのアクセスキーを`.env.local`に置く。

## 1. ポリシーを作る

IAMコンソール → ポリシー → ポリシーの作成 → JSONタブへ以下を貼り付ける。

**`<ACCOUNT_ID>`は自分の12桁のアカウントIDに置き換える。**

ポリシー名は`tricksight-policy`とする。このポリシーはローカル開発用ユーザーと初期セットアップで使用する。本番用ロールには権限が広すぎるためアタッチせず、後述の`tricksight-vercel-runtime-policy`を使う。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvoke",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/amazon.nova-*",
        "arn:aws:bedrock:*::foundation-model/twelvelabs.*",
        "arn:aws:bedrock:*:<ACCOUNT_ID>:inference-profile/*"
      ]
    },
    {
      "Sid": "BedrockReadOnly",
      "Effect": "Allow",
      "Action": [
        "bedrock:ListFoundationModels",
        "bedrock:GetFoundationModel",
        "bedrock:ListInferenceProfiles",
        "bedrock:GetInferenceProfile"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3TricksightBuckets",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:GetBucketLocation",
        "s3:PutBucketCors",
        "s3:ListBucket",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::tricksight-*",
        "arn:aws:s3:::tricksight-*/*"
      ]
    }
  ]
}
```

### 設計意図

- ローカル開発用ポリシーは比較評価と調査再開に使えるよう、Nova系とTwelveLabs系のモデルファミリーを許可する。本番用ロールは後述のJP推論プロファイルだけへ絞る。
- 推論プロファイルはアカウント配下に限定する。複数リージョンでの評価履歴を再現できるよう、ローカル用だけリージョン部分を`*`にする。
- S3は`tricksight-`で始まるバケットだけに限定する。
- バケット作成とCORS設定（Phase 4のブラウザ直接アップロードで必要）まで含めたので、以後ポリシーの変更はモデルID絞り込み以外ほぼ不要。

## 2. 本番用のIAMロールを作る（Vercel OIDC）

Vercelの本番環境から静的キーなしでAWSを呼ぶための設定。OIDC federationはHobbyプランでも利用できる。

参照した一次情報：

- [Vercel: Connect to Amazon Web Services](https://vercel.com/docs/oidc/aws)
- [Vercel: OIDC Federation Reference](https://vercel.com/docs/oidc/reference)
- [Vercel: Custom OIDC Token Audiences](https://vercel.com/changelog/custom-oidc-token-audiences)
- [AWS IAM: Create an OpenID Connect identity provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [AWS IAM: Create a role for OpenID Connect federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)
- [Amazon S3: Required permissions for API operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html)
- [Amazon S3: How Amazon S3 works with IAM](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html)

### 2-1. OIDCアイデンティティプロバイダを登録する

Vercelプロジェクトの Settings → Security → Secure backend access with OIDC federation で、Issuer Modeを**Team（推奨）**にする。

IAMコンソール → IDプロバイダ → プロバイダを追加 → OpenID Connect。

- **プロバイダのURL**：`https://oidc.vercel.com/<TEAM_SLUG>`
- **対象者（Audience）**：`sts.amazonaws.com`

`<TEAM_SLUG>`はVercelのチームURLのパス部分（個人アカウントの場合はそのアカウントのスラッグ）に置き換える。

アプリはVercelのOIDC token exchangeでAWS専用のカスタムAudienceを要求する。Vercelの既定Audience（`https://vercel.com/<TEAM_SLUG>`）をそのまま使わず`sts.amazonaws.com`へ限定することで、AWS以外を対象に発行されたトークンの再利用を防ぐ。

### 2-2. ロールを作る

ロール名は`tricksight-vercel-role`とし、信頼ポリシーへ以下を設定する。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.vercel.com/<TEAM_SLUG>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/<TEAM_SLUG>:aud": "sts.amazonaws.com",
          "oidc.vercel.com/<TEAM_SLUG>:sub": "owner:<TEAM_SLUG>:project:<VERCEL_PROJECT_NAME>:environment:production"
        }
      }
    }
  ]
}
```

`<VERCEL_PROJECT_NAME>`はVercel Dashboardに表示されるプロジェクト名（通常は`tricksight`）と完全一致させる。

次の権限ポリシーを`tricksight-vercel-runtime-policy`として更新し、このロールだけにアタッチする。S3のARNは移行先の東京バケットを明示する。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PrivateVideoObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::tricksight-dev-561143850472-ap-northeast-1-an/private/*"
    },
    {
      "Sid": "InvokeNovaJpInferenceProfile",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:ap-northeast-1:561143850472:inference-profile/jp.amazon.nova-2-lite-v1:0"
    },
    {
      "Sid": "InvokeNovaJpFoundationModelsViaProfile",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.nova-2-lite-v1:0",
        "arn:aws:bedrock:ap-northeast-3::foundation-model/amazon.nova-2-lite-v1:0"
      ],
      "Condition": {
        "StringEquals": {
          "bedrock:InferenceProfileArn": "arn:aws:bedrock:ap-northeast-1:561143850472:inference-profile/jp.amazon.nova-2-lite-v1:0"
        }
      }
    }
  ]
}
```

ブラウザ直接アップロードの署名には`PutObject`、再生・TwelveLabsへの入力URL・`HeadObject`検証には`GetObject`、不正アップロードの後始末には`DeleteObject`が必要である。NovaはConverse APIを非ストリーミングで使うため、必要なアクションは`bedrock:InvokeModel`だけである。AWSの地理的クロスリージョン推論では、推論プロファイル本体に加え、全処理先の基盤モデルも許可する必要がある。基盤モデル側には`bedrock:InferenceProfileArn`条件を付け、JPプロファイルを介さない直接呼び出しを防ぐ。

ランタイムはバケット一覧やCORS変更をしないため、`ListBucket`、`CreateBucket`、`PutBucketCors`は付与しない。`sts:AssumeRoleWithWebIdentity`は上の信頼ポリシーで許可するものであり、権限ポリシーへ追加する必要はない。Bedrock Pegasusは調査保留中で本番既定ではないため、このランタイムポリシーには権限を付与しない。実装自体は残っており、将来再開する場合は対象リージョンとモデルARNを確認して別途追加する。

参考：AWS公式の[地理的クロスリージョン推論のIAM要件](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html)と[Nova 2 Liteモデルカード](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)。

`sub`を`production`だけに限定しているため、Preview Deploymentと`development`（ローカル）はこのロールを引けない。Previewへ本番用ロールを許可すると、Previewコードから本番動画の取得・削除やBedrock呼び出しが可能になるため、MVPでは許可しない。ローカルは次章のアクセスキーを使う。

将来PreviewでもAWS連携を検証する場合は、この信頼ポリシーへPreviewを追加せず、Preview専用のIAMロール、S3バケット、環境変数を別途作成する。

### 2-3. Vercelの環境変数を設定する

Vercelプロジェクトの環境変数へ以下を**Production環境だけを対象として**登録する。Preview環境には登録しない。

```bash
AWS_ROLE_ARN=arn:aws:iam::<ACCOUNT_ID>:role/tricksight-vercel-role
AWS_REGION=ap-northeast-1
AWS_ACCOUNT_ID=<ACCOUNT_ID>
S3_BUCKET_NAME=tricksight-dev-561143850472-ap-northeast-1-an
NOVA_MODEL_ID=jp.amazon.nova-2-lite-v1:0
TWELVELABS_API_KEY=<production-api-key>
TWELVELABS_MODEL_NAME=pegasus1.5
VIDEO_ANALYSIS_PROVIDER=bedrock-nova
```

**`AWS_REGION`の明示は必須である。** JP推論プロファイルは東京（`ap-northeast-1`）からだけ呼び出せる。S3バケットも東京にそろえる。コードはJPプロファイルと東京以外のリージョンの組み合わせを起動時に拒否する。

**`AWS_ACCOUNT_ID`も必須である。** BedrockへS3 URIを渡すときの`bucketOwner`として使用し、別アカウントのバケットを誤って読ませるconfused deputyを防ぐ。実行時にSTS `GetCallerIdentity`で導出せず設定値にすることで、本番OIDCロールの権限をS3とBedrockだけに維持する。

Productionに`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`、`VERCEL_OIDC_TOKEN`を手動設定しない。OIDCトークンはVercelがFunctionのリクエストコンテキストへ自動供給する。

`VIDEO_ANALYSIS_PROVIDER`は未設定でも`bedrock-nova`になる。本番では意図を明示するため値も設定する。障害時や比較時は`twelvelabs-direct`へ変更でき、`TWELVELABS_API_KEY`と`TWELVELABS_MODEL_NAME`はその切り戻しのため維持する。`bedrock-pegasus`もコード上は選べるが、モデル入力エラーの調査保留中で、本番OIDCロールには権限を付与していない。

Nova 2 Liteの最新の推論ID・ソース/送信先リージョンは[AWS公式モデルカード](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)で確認する。

### 2-4. アプリ側の実装

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/client-bedrock-runtime @aws-sdk/s3-presigned-post @vercel/oidc-aws-credentials-provider
```

```ts
import { createAwsClientConfig } from "@/lib/aws/client-config";
import { S3Client } from "@aws-sdk/client-s3";

const client = new S3Client(
  createAwsClientConfig({ region: "ap-northeast-1" }),
);
```

`createAwsClientConfig`は`AWS_ROLE_ARN`の有無だけで切り替える。設定されていれば`@vercel/oidc-aws-credentials-provider`の`awsCredentialsProvider`を使い、Audienceを`sts.amazonaws.com`として`AssumeRoleWithWebIdentity`を行う。未設定なら`credentials`をS3Clientへ渡さず、AWS SDKの既定認証情報チェーンがローカルのアクセスキーや将来のLambda実行ロールを解決する。共通処理はNext.jsへ依存しない。

## 3. ローカル開発用のIAMユーザーを作る

IAMコンソール → ユーザー → ユーザーの作成。

- ユーザー名：`tricksight-dev`
- 「AWSマネジメントコンソールへのアクセスを提供する」は**チェックしない**（APIアクセスのみ）
- 許可の設定：「ポリシーを直接アタッチ」で`tricksight-policy`を選択

作成したユーザー → セキュリティ認証情報 → アクセスキーを作成。

- ユースケースは「AWSの外部で実行されるアプリケーション」を選ぶ。
- シークレットアクセスキーは作成直後の画面でしか表示されないため、その場で保存する。

`tricksight/.env.local`に以下を書く（`.env*`はgitignore済み）。

```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-northeast-1
AWS_ACCOUNT_ID=561143850472
S3_BUCKET_NAME=tricksight-dev-561143850472-ap-northeast-1-an
NOVA_MODEL_ID=jp.amazon.nova-2-lite-v1:0
VIDEO_ANALYSIS_PROVIDER=bedrock-nova
```

一時認証情報（アクセスキーIDが`ASIA`で始まるもの）を使う場合は、有効期限までの`AWS_SESSION_TOKEN`も必要になる。ただしPhase 0では、期限切れによる中断を避けるため、前節で作成した`tricksight-dev`のアクセスキー（`AKIA`で始まるもの）を使うことを推奨する。

## 4. S3バケットを作る

東京（`ap-northeast-1`）に作成する。

- バケット名：`tricksight-dev-561143850472-ap-northeast-1-an`
- パブリックアクセスはすべてブロックする
- 動画の閲覧はPresigned URLで行うため、公開設定は不要

S3コンソールの **アクセス許可 → Cross-Origin Resource Sharing (CORS)** に次を設定する。`<PRODUCTION_ORIGIN>`は実際のVercel本番URL（例：`https://tricksight.example.com`）へ置き換え、末尾の`/`は付けない。ローカルから直接アップロードを確認しない場合は`http://localhost:3000`を省いてよい。

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD", "POST"],
    "AllowedOrigins": ["<PRODUCTION_ORIGIN>", "http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 5. モデルアクセスを有効化する（東京リージョン）

Bedrockコンソールを**東京（ap-northeast-1）**に切り替え、Nova 2 Liteが利用可能であることを確認する。

アカウントレベルの設定なので、管理者ログインのまま行う。

- **Amazon Nova 2 Lite**：`jp.amazon.nova-2-lite-v1:0`を使用する。ソースは東京、処理先は東京・大阪である。
- **TwelveLabs Pegasus 1.2**：実装は残すが、Bedrock版は標準H.264動画の入力エラーで調査保留中。本番既定にはしない。

利用可能なモデルの一覧はコンソールの表示と実際のAPIで食い違うことがあるため、次章のコマンドで実機確認する。

## 6. 動作確認

キーを`.env.local`へ置いたらLeadへ連絡する。以下をLead側で確認する。

```bash
# 認証情報が有効であること
aws sts get-caller-identity

# 東京で利用可能な動画対応モデルの確認
aws bedrock list-foundation-models \
  --region ap-northeast-1 \
  --by-output-modality TEXT \
  --query "modelSummaries[?contains(inputModalities, 'VIDEO')].[modelId,modelName]" \
  --output table

# 推論プロファイルの確認
aws bedrock list-inference-profiles --region ap-northeast-1 --output table
```

東京バケット作成とIAM更新が完了した後にこの確認を行う。特に以下を確認する。

- `jp.amazon.nova-2-lite-v1:0`が一覧にあり、東京をソースとして使えること
- 実行ロールのポリシーに推論プロファイルと東京・大阪の基盤モデルARNがすべて含まれること

T10の設定変更段階では東京バケットが未作成のため、実API呼び出しや評価の再実行は行わない。

## 補足

- コスト暴走の保険として、AWS Budgetsで月額アラート（例：$10）を1つ設定しておくことを推奨する。
- 2025年7月以降に作成したAWSアカウントの無料利用枠は、従来の「12か月無料」ではなく$200クレジット・6か月の使い切りモデルになっている。クレジットが切れた後に従量課金へ移ることを前提に見積もる。
- アクセスキーが漏えいした場合は、IAMコンソールから当該キーを無効化・削除して再発行する。本番がOIDCであるため、漏えい時の影響範囲はローカル開発に限定される。
