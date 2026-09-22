# T11-7a iPhone骨格計測の原因切り分け

調査日: 2026-09-22

## 診断ページ

開発用ページは `scripts/ios-pose-diagnostic/` に置き、製品コードから分離した。起動・実機アクセス手順は同ディレクトリの `README.md` を参照する。

製品と同じ条件であるPose Landmarker full、CPU、固定10fpsを使い、フレームごとに次を個別計測する。

1. `video.currentTime` を設定してから `seeked` が発火するまで
2. `createImageBitmap(video)`
3. Worker内の `detectForVideo()`
4. ImageBitmap転送を含むWorker往復

結果には各区間の合計・平均・p50・p95・最大、要求/処理フレーム数、動画メタデータ、pose検出数、User-Agent、画面情報、WebCodecs `VideoDecoder` の有無を含める。動画は端末内のBlob URLから読み、診断サーバへアップロードしない。

ローカルの `kickflip_10.mp4`（89フレーム）ではChromiumとPlaywright WebKitの両方で完走し、全区間のサンプル数が89であることを確認した。ただしPlaywright WebKitはiPhone実機のデコーダやシーク性能を再現しないため、これはページ自体の動作確認に限る。

## WebCodecs `VideoDecoder`

### 対応状況

- WebKit公式のSafari 16.4リリースノートは、Safari 16.4でWebCodecsの動画部分を追加したと明記している。
- WebKit公式のSafari 17.4リリースノートは、WebCodecsにHEVC対応を追加したと明記している。iPhone撮影のMP4/MOVはH.264だけでなくHEVCの場合もあるため、実ファイルごとのcodec確認と `VideoDecoder.isConfigSupported()` が必要になる。
- WebCodecs仕様では `VideoDecoder` はSecure ContextでWindowとDedicatedWorkerに公開される。診断ページをHTTPSのQuick Tunnelで開くのはこの条件にも合う。

一次情報:

- [WebKit: Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)
- [WebKit: Safari 17.4](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)
- [W3C WebCodecs Editor's Draft](https://w3c.github.io/webcodecs/)

### シークを使わない代替になり得るか

なり得る。圧縮フレームを時系列に `VideoDecoder` へ渡し、出力された `VideoFrame.timestamp` に基づいて10fps相当だけをPose Landmarkerへ渡せば、フレームごとの `HTMLVideoElement.currentTime` ランダムシークは不要になる。

ただしWebCodecsはMP4/MOVコンテナを直接読み取るAPIではない。仕様上 `VideoDecoder` の入力はコンテナ化されていない `EncodedVideoChunk` であり、W3CのMP4サンプルもmp4box.jsでdemuxしている。そのため実装候補には次が必要になる。

- MP4/MOV demuxer
- codec文字列とdecoder descriptionの抽出
- key/delta frame順序を守った逐次decode
- H.264/HEVC双方の端末別 `isConfigSupported()` 判定
- 不要な `VideoFrame` の即時 `close()`
- 非対応端末や非対応codec向けのフォールバック

一次情報:

- [W3C WebCodecs MP4 decode sample](https://w3c.github.io/webcodecs/samples/video-decode-display/)
- [W3C WebCodecs codec registry](https://w3c.github.io/webcodecs/codec_registry.html)

したがって、実機診断でシークが律速と確定した場合には検証する価値が高いが、現時点では製品へ実装しない。

## MediaPipe lite / full

GoogleのMediaPipe公式リポジトリに残るBlazePose GHUMベンチマークは次の値を示す。

| モデル | Pixel 3 TFLite GPU | MacBook Pro 2017 |
|---|---:|---:|
| Full | 25ms | 27ms |
| Lite | 20ms | 25ms |

同じ表では、Liteの速度短縮はFull比でPixel 3が5ms（20%）、MacBook Proが2ms（約7%）。一方、品質評価ではLiteのmAPがFullよりYogaで17.6点、Danceで13.8点、HIITで14.2点低く、PCK@0.2も2.2〜5.3点低い。

一次情報:

- [Google AI Edge MediaPipe: Pose（legacy solution source）](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)
- [Google AI Edge MediaPipe web sample（lite/full/heavyモデルURL）](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/pose-landmarker.ts)

この数値は現行Web Tasks VisionをiPhoneで動かした比較ではなく、スケート動画と独自集約指標の精度も保証しない。推論が律速と実測された場合でも、liteへの変更だけでMac比15倍超の差を埋められる根拠はない。採用判断にはiPhone実機のfull/lite時間比較と、既存評価動画での4指標・品質判定の再評価が必要になる。

## 現時点の結論

原因はまだ確定していない。実機の診断結果でseek合計、Worker内推論合計、画像化、Worker往復を比較してから、次の対策候補を選ぶ。

- seek律速: WebCodecsによる逐次decodeを優先検証
- 推論律速: liteモデルを速度・品質の両面で比較検証
- Worker往復または画像化律速: ImageBitmap生成・転送経路を個別に再調査

実機結果を受け取るまでは、製品の計測方式・モデル・タイムアウトを変更しない。
