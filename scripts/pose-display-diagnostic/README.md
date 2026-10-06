# T12-2a 動画取得・表示canvas診断

**案Xは検収・iPhone Chrome/Safari第1段階を通過。T12-2bは骨格表示Workerを実装済み、検収待ち。** 実機の設定・操作は [案X手順書](../../docs/t12-2a-production-diagnostic.md) を使う。Vercel Productionの既定OFFフラグと本人allowlistで限定し、履歴から診断を開く。Quick Tunnel、署名URLコピー、一時CORS追加/削除は使わない。CORSは依頼者が適用し、leaderのpreflight確認済み。

## 現時点の成果物

このディレクトリは製品非露出の独立診断で、中間検収済み。通常video＋製品A1の非表示video、表示canvasを別Workerへ移譲した枠/十字、終了/取消/背景破棄を検証する。この独立page.mjsはT12-2aの比較基準として残す。実アプリcontrollerは[T12-2bの骨格保持Worker](../../docs/t12-2b-pose-display-worker.md)を使用する。Jev連携は含めない。

ローカル再現:

```sh
node scripts/pose-display-diagnostic/test.mjs
node scripts/pose-display-diagnostic/test-app-controller.mjs
# 既存ローカルeval生データに対して、変更前51runの全集計と一致を確認
node --import tsx scripts/pose-display-diagnostic/check-metrics.ts
# pnpm build後、フラグ未設定の本番HTTP遮断を確認
node scripts/pose-display-diagnostic/test-production-off.mjs
pnpm exec eslint scripts/pose-display-diagnostic/*.mjs
```

既存kickflip_10.mp4とモデルキャッシュを使い、Chromium/WebKit、MP4と同一バイトのQuickTime MIME、取得失敗・canvas非対応fallback、通常再生、seek/320px、cancel/pagehide、URL/POST拒否を確認する。same-origin fixtureなので実S3のCORS成功や元MOV互換性を証明しない。[検証結果](../../docs/t12-2a-pose-display-diagnostic.md)を参照。

独立サーバーをローカルで確認する場合のみ:

```sh
pnpm diagnose:pose-display
```

`http://127.0.0.1:4175` で起動する。実データ試験の推奨手順ではない。現CORSではこのoriginのGETは未許可。公開トンネルへ接続したり、テスト用fixtureサーバーを公開したりしない。

## 実機で確認する事項

- 取得完了後の別クリックでA1同期play、通常videoも同時play。video最大2、canvas移譲/描画、pixel readable/nonuniformを確認する。
- iPhone Safari/Chromeそれぞれ、小さいMP4で主要項目確認後、元MOV、3回反復、取消、背景移動、seek/回転/fullscreenを試す。
- 大きい素材があれば20秒/100MiB近くでも確認。DOM数・解放呼出しだけで実RSSの解放を保証しない。発熱・強制再読込・クラッシュも記録する。
- 安全な診断JSONと機種/iOS/ブラウザ・体感結果だけ共有。署名URL・動画・座標・HAR・URL入りスクリーンショットは共有しない。
- 全画面/PiPは元動画のみ。取消/hidden/pagehideでWorker・Blob URL・video srcを破棄し、自動再開しない。
- 実機合格と製品公開判断は別。案Xのゲート・所有権テストは実施済み。T12-2aは限定デプロイ/CORS適用済み。T12-2bの実機確認は検収後のデプロイで行う。
