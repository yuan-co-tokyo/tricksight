# iPhone骨格計測診断

製品コードを変更せず、実機上で固定10fpsの各フレームを次の区間に分けて計測する開発用ページです。

- `HTMLVideoElement.currentTime` の変更から `seeked` まで
- `createImageBitmap(video)`
- Pose Landmarker fullモデルのWorker内推論
- Workerへの転送を含む推論往復

動画はiPhone内のBlob URLから読み、診断サーバへアップロードしません。

## iPhoneから開く

Macのリポジトリで診断サーバを起動します。

```sh
pnpm diagnose:ios-pose
```

別ターミナルでCloudflare Quick Tunnelを起動します。`cloudflared`がない場合は最初に `brew install cloudflared` を実行してください。

```sh
cloudflared tunnel --url http://127.0.0.1:4173
```

Quick Tunnelはアカウント不要の開発・テスト用機能です。詳細は[Cloudflare公式ドキュメント](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)を参照してください。

表示された `https://...trycloudflare.com` をiPhoneで開き、問題が起きた動画を選択します。計測が終わるまでSafariを前面に置き、完了後は次の2点を共有してください。

1. 暫定判定と時間内訳が見える画面のスクリーンショット
2. 「JSONをコピー」でコピーした全文

Quick TunnelのURLは一時的な公開URLです。第三者へ共有せず、診断後は両方のコマンドを `Ctrl+C` で終了してください。Macがスリープすると診断ページのアセットを読めなくなるため、計測中はMacも起動したままにします。

ポートを変える場合は、両コマンドで同じ値を指定します。

```sh
PORT=5173 pnpm diagnose:ios-pose
cloudflared tunnel --url http://127.0.0.1:5173
```
