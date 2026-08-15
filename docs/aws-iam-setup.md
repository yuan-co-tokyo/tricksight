# AWSセットアップ手順（tricksight用）

Phase 0の分析品質検証と、以後のMVP開発で使うAWS側の権限を用意する手順。

管理者権限のアカウントでAWSコンソールにログインして作業する。

## 前提となるリージョン方針

| 用途 | リージョン |
| --- | --- |
| S3（動画） | ソウル `ap-northeast-2` |
| Bedrock（分析） | ソウル `ap-northeast-2` |
| Vercel関数 | 東京 `hnd1` |
| Supabase（DB） | 東京 `ap-northeast-1` |

S3とBedrockは必ず同一リージョンに置く。NovaもPegasusも、S3 URIで動画を渡す場合はバケットが呼び出しリージョンと同一である必要がある。ソウルを選ぶ理由は、TwelveLabs PegasusのAPAC提供がソウルのみであるため。

Nova 2 Liteをソウルから呼び出すには、基盤モデルIDではなく`global.amazon.nova-2-lite-v1:0`というシステム定義の推論プロファイルを`modelId`に指定する。このプロファイルはグローバルなクロスリージョン推論であり、処理先がソウル以外になる可能性がある。動画データの処理場所を国内に限定する要件がある場合、Novaの評価は東京から`jp.amazon.nova-2-lite-v1:0`を使って別途実施する。

認証情報の持ち方は環境で分ける。

- **本番（Vercel）**：Vercel OIDC federationでIAMロールをAssumeRoleする。静的キーを置かない。
- **ローカル開発**：IAMユーザーのアクセスキーを`.env.local`に置く。

## 1. ポリシーを作る

IAMコンソール → ポリシー → ポリシーの作成 → JSONタブへ以下を貼り付ける。

**`<ACCOUNT_ID>`は自分の12桁のアカウントIDに置き換える。**

ポリシー名は`tricksight-policy`とする。このポリシーは本番用ロールとローカル開発用ユーザーの両方にアタッチする。

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

- Bedrockの呼び出しはNova系とTwelveLabs系のモデルファミリーに限定する。個別のモデルIDを列挙しないのは、Phase 0で候補モデルの棚卸しをするまで採用モデルが確定しないため。確定後に実際に使うモデルIDへ絞り込む。
- 推論プロファイルはアカウント配下に限定する。クロスリージョン推論が他リージョンへルーティングするため、リージョン部分は`*`にする。
- S3は`tricksight-`で始まるバケットだけに限定する。
- バケット作成とCORS設定（Phase 4のブラウザ直接アップロードで必要）まで含めたので、以後ポリシーの変更はモデルID絞り込み以外ほぼ不要。

## 2. 本番用のIAMロールを作る（Vercel OIDC）

Vercelの本番環境から静的キーなしでAWSを呼ぶための設定。OIDC federationはHobbyプランでも利用できる。

### 2-1. OIDCアイデンティティプロバイダを登録する

IAMコンソール → IDプロバイダ → プロバイダを追加 → OpenID Connect。

- **プロバイダのURL**：`https://oidc.vercel.com/<TEAM_SLUG>`
- **対象者（Audience）**：`https://vercel.com/<TEAM_SLUG>`

`<TEAM_SLUG>`はVercelのチームURLのパス部分（個人アカウントの場合はそのアカウントのスラッグ）に置き換える。

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
          "oidc.vercel.com/<TEAM_SLUG>:aud": "https://vercel.com/<TEAM_SLUG>",
          "oidc.vercel.com/<TEAM_SLUG>:sub": "owner:<TEAM_SLUG>:project:tricksight:environment:production"
        }
      }
    }
  ]
}
```

このロールに`tricksight-policy`をアタッチする。

`sub`を`production`だけに限定しているため、Preview Deploymentと`development`（ローカル）はこのロールを引けない。Previewへ本番用ロールを許可すると、Previewコードから本番動画の取得・削除やBedrock呼び出しが可能になるため、MVPでは許可しない。ローカルは次章のアクセスキーを使う。

将来PreviewでもAWS連携を検証する場合は、この信頼ポリシーへPreviewを追加せず、Preview専用のIAMロール、S3バケット、環境変数を別途作成する。

### 2-3. Vercelの環境変数を設定する

Vercelプロジェクトの環境変数へ以下を**Production環境だけを対象として**登録する。Preview環境には登録しない。

```bash
AWS_ROLE_ARN=arn:aws:iam::<ACCOUNT_ID>:role/tricksight-vercel-role
AWS_REGION=ap-northeast-2
S3_BUCKET_NAME=tricksight-videos-<suffix>
```

**`AWS_REGION`の明示は必須である。** Vercelは`AWS_REGION`を関数の実行リージョンで自動設定するため、明示しないと東京（`ap-northeast-1`）が入り、ソウルにあるS3とBedrockを呼べなくなる。この構成では関数の実行リージョンとAWS資源のリージョンが意図的に異なるため、必ず上書きする。

### 2-4. アプリ側の実装

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/client-bedrock-runtime @aws-sdk/s3-presigned-post @vercel/oidc-aws-credentials-provider
```

```ts
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const credentials = awsCredentialsProvider({
  roleArn: process.env.AWS_ROLE_ARN!,
});
```

ローカル開発ではこのプロバイダが使えないため、環境で認証方法を切り替える。ローカルはアクセスキー（SDKが環境変数から自動的に拾う）、本番は上記のプロバイダとし、切り替えはAI分析モジュール内の1か所に閉じる。

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
AWS_REGION=ap-northeast-2
S3_BUCKET_NAME=tricksight-videos-<suffix>
```

一時認証情報（アクセスキーIDが`ASIA`で始まるもの）を使う場合は、有効期限までの`AWS_SESSION_TOKEN`も必要になる。ただしPhase 0では、期限切れによる中断を避けるため、前節で作成した`tricksight-dev`のアクセスキー（`AKIA`で始まるもの）を使うことを推奨する。

## 4. S3バケットを作る

ソウル（`ap-northeast-2`）に作成する。

- バケット名：`tricksight-videos-<suffix>`（`tricksight-`で始めること。ポリシーがこの前提になっている）
- パブリックアクセスはすべてブロックする
- 動画の閲覧はPresigned URLで行うため、公開設定は不要

Phase 4でブラウザからの直接アップロードを実装する際に、CORS設定を追加する。

## 5. モデルアクセスを有効化する（ソウルリージョン）

Bedrockコンソールを**ソウル（ap-northeast-2）**に切り替え、モデルアクセスのページで動画対応モデルを有効化する。

アカウントレベルの設定なので、管理者ログインのまま行う。

- **Amazon Nova系**：Amazon製のため即時有効になる見込み。
- **TwelveLabs Pegasus 1.2**：サードパーティモデルのため利用規約への同意が求められる。

利用可能なモデルの一覧はコンソールの表示と実際のAPIで食い違うことがあるため、次章のコマンドで実機確認する。

## 6. 動作確認

キーを`.env.local`へ置いたらLeadへ連絡する。以下をLead側で確認する。

```bash
# 認証情報が有効であること
aws sts get-caller-identity

# ソウルで利用可能な動画対応モデルの棚卸し
aws bedrock list-foundation-models \
  --region ap-northeast-2 \
  --by-output-modality TEXT \
  --query "modelSummaries[?contains(inputModalities, 'VIDEO')].[modelId,modelName]" \
  --output table

# 推論プロファイルの確認
aws bedrock list-inference-profiles --region ap-northeast-2 --output table
```

この結果がPhase 0の候補モデル確定の入力になる。特に以下を確認する。

- Nova 2およびNova Lite 1.5がソウルで使えるか
- Pegasus 1.2の呼び出しに必要なのが直接のモデルIDか、推論プロファイルか

確認できたモデルIDを、第1章のポリシーの`Resource`へ反映して権限を絞り込む。

## 補足

- コスト暴走の保険として、AWS Budgetsで月額アラート（例：$10）を1つ設定しておくことを推奨する。
- 2025年7月以降に作成したAWSアカウントの無料利用枠は、従来の「12か月無料」ではなく$200クレジット・6か月の使い切りモデルになっている。クレジットが切れた後に従量課金へ移ることを前提に見積もる。
- アクセスキーが漏えいした場合は、IAMコンソールから当該キーを無効化・削除して再発行する。本番がOIDCであるため、漏えい時の影響範囲はローカル開発に限定される。
