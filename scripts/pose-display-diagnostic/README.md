# T12-2a 動画取得・表示canvas診断

**2026-10-06: 実機手順は見直し中。Quick Tunnel経由で一時CORSを追加し、署名URLを手渡しする従来手順は実施しない。**

SSO復旧後のCORS現値はPOSTのみ。本番origin向けGETの最小追加と、認証・所有者確認付きアプリ内診断ルート（案X、既定OFF＋本人限定）を [承認依頼](../../docs/t12-2a-device-test-proposal.md) にまとめた。AWSは未変更、案Xは未実装。承認後は本人がスマホでログイン→自分の履歴から診断→取得→開始するだけにし、署名URLコピー・Universal Clipboard・トンネル・毎回のCORS変更をなくす方針。

## 現時点の成果物

このディレクトリは製品非露出の独立診断で、中間検収済み。通常video＋製品A1の非表示video、表示canvasを別Workerへ移譲した枠/十字、終了/取消/背景破棄を検証する。骨格保持WorkerやJev連携は実装していない。

ローカル再現:

```sh
node scripts/pose-display-diagnostic/test.mjs
pnpm exec eslint scripts/pose-display-diagnostic/*.mjs
```

既存kickflip_10.mp4とモデルキャッシュを使い、Chromium/WebKit、MP4と同一バイトのQuickTime MIME、取得失敗・canvas非対応fallback、通常再生、seek/320px、cancel/pagehide、URL/POST拒否を確認する。same-origin fixtureなので実S3のCORS成功や元MOV互換性を証明しない。[検証結果](../../docs/t12-2a-pose-display-diagnostic.md)を参照。

独立サーバーをローカルで確認する場合のみ:

```sh
pnpm diagnose:pose-display
```

`http://127.0.0.1:4175` で起動する。実データ試験の推奨手順ではない。現CORSではこのoriginのGETは未許可。公開トンネルへ接続したり、テスト用fixtureサーバーを公開したりしない。

## 案Xでも引き継ぐ確認事項

- 取得完了後の別クリックでA1同期play、通常videoも同時play。video最大2、canvas移譲/描画、pixel readable/nonuniformを確認する。
- iPhone Safari/Chromeそれぞれ、小さいMP4で主要項目確認後、元MOV、3回反復、取消、背景移動、seek/回転/fullscreenを試す。
- 大きい素材があれば20秒/100MiB近くでも確認。DOM数・解放呼出しだけで実RSSの解放を保証しない。発熱・強制再読込・クラッシュも記録する。
- 安全な診断JSONと機種/iOS/ブラウザ・体感結果だけ共有。署名URL・動画・座標・HAR・URL入りスクリーンショットは共有しない。
- 全画面/PiPは元動画のみ。取消/hidden/pagehideでWorker・Blob URL・video srcを破棄し、自動再開しない。
- 実機合格と製品公開判断は別。案Xのゲート・所有権テストとAWS変更承認を先に完了する。
