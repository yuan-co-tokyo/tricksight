# iPhone骨格計測診断

製品コードを変更せず、iOSで動画のフレームデータを取得する3方式を1回のファイル選択で比較する開発用ページです。

- A1: 非表示の`video`に対して、ファイル選択イベント内で同期的に`play()`を呼ぶ
- A2: 1pxで描画した`video`に対して、同じく同期的に`play()`を呼ぶ
- B: MP4Box.jsでdemuxし、WebCodecsの`VideoDecoder`で全サンプルをdecodeする

A1またはA2が成功した場合は、より単純なA1を優先して、固定10fpsの各フレームを次の区間に分けてフォーム計測まで実行します。

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

診断中は、診断サーバと`cloudflared`の**両方のコマンドを起動したまま**にしてください。どちらかを終了すると、iPhone側は`Bad Gateway`になったり、診断用アセットを読み込めなくなったりします。

Quick Tunnelはアカウント不要の開発・テスト用機能です。詳細は[Cloudflare公式ドキュメント](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)を参照してください。

表示された `https://...trycloudflare.com` をiPhoneで開き、問題が起きた動画を選択します。A1・A2・Bはそれぞれ独立して成否・所要時間・失敗理由を表示します。計測が終わるまでブラウザを前面に置き、完了後は次の2点を共有してください。

1. 暫定判定と時間内訳が見える画面のスクリーンショット
2. 「JSONをコピー」でコピーした全文

Quick TunnelのURLは一時的な公開URLです。第三者へ共有せず、診断後は両方のコマンドを `Ctrl+C` で終了してください。Macがスリープすると診断ページのアセットを読めなくなるため、計測中はMacも起動したままにします。

ポートを変える場合は、両コマンドで同じ値を指定します。

```sh
PORT=5173 pnpm diagnose:ios-pose
cloudflared tunnel --url http://127.0.0.1:5173
```
