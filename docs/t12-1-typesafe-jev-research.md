# T12-1 TypeSafe / Jev 調査と小規模実験案

調査: 2026-10-04〜05。基準: T12-0検収済み `3f878a9`（origin/mainへpush済み）。本タスクは文書のみ。依存追加、製品変更、APIキー取得、評価API呼び出しは行っていない。公開資料の閲覧、既存ローカル診断JSONの読み取り、原動画から抽出した前後フレームの目視照合を実施した。

## 判断案

**数値JSONを入力した分類実験は可能。ただし、再現性改善・スケートの成否判定能力は未確認。既存動画providerの置換は勧めない。** ユーザーの動画確認を受けた推定頂点中心の案から個別要素を選び、leaderと実験条件を承認した後、独立した評価スクリプトで試す案とする。

Jevはテキスト／構造化データを指定された選択肢・尺度に評価するモデル。画像・動画は扱わない。板の接地や回転を観測していない骨格集約値から、成否を直接確認したことにはできない。数値算出は既存コードで行い、Jevには意味・単位を添えた少数の集約値を渡す。根拠は以下で「公開仕様」「提供元の実験」「ローカル観察」「提案」に分ける。

## 1. 公開仕様とtyped responses

TypeSafeはSystem One ModelとしてJevを提供している。生成文章をJSONに押し込める方式ではなく、質問ごとに型を選んで判断を返す。複数質問は独立して評価され、質問間の推論連鎖を前提にできない。[公式概要](https://docs.typesafe.ai/introduction)

| 項目 | 確認した仕様 |
| --- | --- |
| 呼び出し | Bearer認証の `POST https://api.typesafe.ai/v1/systemone` |
| 入力 | `model`、`state`、`questions`。stateは文字列・JSON object・array。数値をJSONのフィールドとして渡せる |
| choice | 選択肢名→説明のcriteria。選択肢、確率分布、confidenceを返す |
| score | 順序付きの説明（2〜10段階）。尺度上の期待値、各段階の確率、legend、confidenceを返す。任意の実測値を計算するAPIではない |
| noul | 真偽の確率0〜1。別のconfidenceはない |
| 応答 | 実際のmodel、質問IDごとのanswers、usage.input_tokens / output_tokens |

根拠: [API reference](https://docs.typesafe.ai/api)、[State](https://docs.typesafe.ai/concepts/state)。質問IDは応答を対応づける識別子であり、モデル向け説明の代わりにならない。説明はinstructions / criteriaに置く。

**zodとの関係:** Jevの公開APIに汎用の `response_format: JSON Schema` や任意のzod schemaを渡す契約は見当たらない。choice / score / noulという専用の型付き質問が契約。既存zodは、こちら側で入力の単位・有限値・nullを検証し、受信した質問キー・enum・確率範囲等を検証する用途には使える。型推論が成立しても、内容の正しさや同一入力の同一出力は保証しない。

TanStackの `@tanstack/ai-typesafe` はevaluate専用。`decide()` + `typesafeDecider()` を使い、choiceの選択肢キーが返却valueのunionになる。TanStackのbooleanはwire上のnoulで、P(true)≥0.5をtrueにする。scoreのvalueは最寄りの段階名、scoreは生の尺度値。一般のchatにあるzod `outputSchema` 対応と混同しない。[TanStack adapter](https://tanstack.com/ai/latest/docs/adapters/typesafe)、[Evaluate](https://tanstack.com/ai/latest/docs/evaluate/evaluate)

公開[アダプター実装](https://github.com/TanStack/ai/blob/main/packages/ai-typesafe/src/adapters/evaluate.ts)も読み取り確認した。raw fetchでmodel/state/questionsを送信し、応答外形を検査、usageを変換している。zod schema送信はなく、このファイル単体でanswers内部の完全検証はしていない。検証時は利用するreleaseを固定して再確認する（main参照は可変）。

資料の相違もある。TanStackページの「SDKはない」という記述に対し、現在は公式 **`@typesafe-ai/sdk`** が存在する。Node.js 20以上、`TypeSafeClient.systemOne()`、質問からの返却型推論が案内されている。[公式JS SDK](https://docs.typesafe.ai/sdk/javascript)。公式SDKのリンク先はv0.6.0で、既定modelはjev-latest、timeoutは試行ごと10秒、既定retryは2回。TanStackのfetchアダプターに同じretry設定があるとは扱わない。[SDK型定義](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/types.ts)

Sentryの `typesafeIntegration` も実在する。JavaScript SDK 11.1.0で公式TypeSafe SDKを計測し、質問・回答の記録はdataCollection.genAI設定に依存する。raw fetchのTanStack経路まで同じ自動計測を保証する記載ではない。今回の実験に導入は不要。[Sentry変更履歴](https://sentry.io/changelog/javascript-sdk-1110-typesafe-jev-tracing/)

## 2. 入力、価格、データ取扱い

| 項目 | 2026-10-04閲覧時点 |
| --- | --- |
| model | `jev-1.13.0`。jev-latest / jev-previewはその時点のalias。実験は固定IDを使う |
| 対応入力 | **text only**。数値JSONは可。画像・音声・動画は非対応。S3 URIやbase64を送って映像を見てもらう方式ではない |
| context | 全体64k、state＋最長のquestionは32k |
| 料金 | **入力100万tokenあたり$0.042、出力無料** |
| 上限 | 公開値100k token/秒、80 request/秒。動的で変更あり。実アカウントの適用値は未確認 |
| 言語 | 英語を優先して調整。実験の説明文は英語固定案 |

根拠: [Models](https://docs.typesafe.ai/models)。JSONを受け取れることは数値判断精度の保証ではない。

学習利用について、Privacy PolicyはInputを学習・fine-tuneしないと記載。サービスは**米国host、米国で保存・処理**と記載されている。保存期間は必要な期間という基準で、日数は明示されていない。[Privacy Policy（2025-11-19更新）](https://typesafe.ai/legal/privacy-policy)

DPA Schedule I §8も処理目的・法律に応じた必要期間であり、通常APIの固定保存日数は確定できない。[DPA（2026-04-24更新）](https://typesafe.ai/legal/data-processing)。MCA §4は事前同意なしのモデル重み学習を認めず、telemetry生成・不正利用監視等の処理を別に規定している。§10.3にバックアップ保持の記載もある。**非学習と非保存は別**。[MCA](https://typesafe.ai/legal/mca)

Enterprise向けZDRは案内されているが、通常アカウントの既定設定ではない。[Legal](https://docs.typesafe.ai/legal)。日本リージョン指定、実際の推論クラウド／地域、subprocessorごとの保存場所、通常ログの削除日数は未確認。DPAからリンクされたTrust Centerのsubprocessorsページは今回本文を取得できなかった。必要ならleader側で提供元に確認する項目とする。問い合わせ送信はしていない。

課金はcredit方式。最低購入額・今回アカウントの無料creditは未確認で、下記のtoken代がそのまま初期支払額になるとは限らない。税別であること、購入creditと任意auto-refillの扱いは[MCA §8](https://typesafe.ai/legal/mca)を参照。

## 3. 再現性とconfidenceの限界

公式confidenceは確率分布から作る統計量で、独立した正誤判定器ではない。choiceでは選択肢数nに対し `(最大確率−1/n)/(1−1/n)`。したがって最大確率0.6とconfidence0.6は同じでない。校正されているという提供元の主張と、この17本での正答率を区別する。[Confidence](https://docs.typesafe.ai/confidence)

提供元の[choice consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook)は、境界的な投稿1件・8質問・各15回の例で、生の最頻ラベル一致90.8%、8質問中2問で揺れを報告。最大確率≥0.60のgate適用後は一致99.2%だが、自動判断率74.2%へ減る。2026-09-11のjev-latestによる例であり、スケートや現行固定版への保証ではない。さらにコードは各requestに新しいuidを含むため、**完全に同一の入力byteでの試験ではない**。

調査したAPI仕様・SDKの公開request型ではseed / temperatureを確認できない。固定モデルにすることはalias更新を避ける措置であり、決定論の保証ではない。HomepageにdeterministicのFAQ見出しはあるが、取得本文には回答が出ておらず、保証の根拠にしていない。Novaの5/17件の反転がJevで解消すると結論づける証拠はまだない。

[Jev 1.13 jaggedness（2026-10-02レビュー）](https://docs.typesafe.ai/model-jaggedness/jev-1.13)は、数値精度・数え上げ・数値尺度の校正が弱く、算術をコードに置くべきこと、choiceの順序で結果が変わり得ることを明示している。よって33点の生時系列からJevに角度や中央値を計算させない。数値閾値だけで定義できる判断には、まず決定的なルールを比較対象にする。根拠のない「良好／不良」のbucketを追加してモデルを誘導しない。

## 4. 既存構成との適合

現状の[provider契約](../lib/analysis/provider.ts)はS3動画URI・技・stance・cameraAngleを受け、[SkateAnalysisResult](../lib/analysis/schema.ts)の文章要約、助言、5項目の0〜100点を返す。Jevの数値評価とは入出力が異なる。choiceやscoreを組み合わせても、自由な説明文を生成する現providerの代替にはならない。

提案は、採用が決まった後に独立した `PoseFeatureEvaluationInput → PoseFeatureEvaluationResult` を設計すること。入力は承認済み集約値＋測定条件＋欠損状態、出力は選択結果・確率分布・棄却状態・resolved model / usage。最初はeval配下のローカルNodeスクリプトで十分。既存 `lib/analysis/providers`、DB、UI、Workerの生33点境界はT12-1で変更しない。

HTTP直結なら依存追加なしでwireを固定できる。TanStackを選ぶ理由は統一evaluate契約、公式SDKを選ぶ理由は専用型とretryであり、現時点でどちらも必須ではない。最初の小実験はHTTP直結案とし、通信・受信検証を含む実装方法は次タスクで承認する。APIキーはサーバ／ローカルNodeだけで扱う。

## 5. 推定頂点を中心とする指標・JSON第一案（追記3反映）

2026-10-05、依頼者が6動画を見た後の意向を受け、第一案を**推定頂点時の情報**へ変更した。個別指標、1点／窓集約、他局面の追加は未決定。従来の着地窓中央値と全動画4集約値は補助候補に移す。

### 推定頂点の定義

根拠は[metrics.ts](../lib/pose/metrics.ts)のderiveFrame / detectMovementWindowと[ビューアseries](../scripts/pose-viewer/series.mjs)。肩11/12・腰23/24がvisibility / presenceとも0.5以上、胴長・腰幅が正のframeをderived候補にする。動画長の5〜95%内に候補が5個以上あればその範囲、なければ全derived候補から、腰中心 `hipY=(y23+y24)/2` が最小のサンプルを選ぶ。同値なら先に現れるサンプル。全derivedが5個未満なら頂点はnull。

これは**取得できた腰の画像上の最高位置**の代理時刻。身体重心、足、板の頂点、接地時刻の実測ではない。下半身が欠損しても腰から頂点は出る。追従カメラ、姿勢変化、誤推定、真の頂点付近の全pose欠損で違う局面を選び得る。

### 原動画6本の目視照合

2026-10-05に既存JSONの時刻を読み、原MP4をChromiumでデコードして前後フレームを目視した。全体20点の一覧と頂点周辺15点の一覧を `eval/output/pose-viewer/<sample-id>-apex-overview.png` / `-apex-detail.png` に保存（git管理外）。詳細の刻みはkickflip_10が0.1秒、kickflip_4/5が0.2秒、通常速度3本が0.05秒。ラベルはseek指定時刻で、原動画の厳密なPTS測定ではない。

「実際の頂点」は腰周辺の上昇から下降への切替を目視した概略区間とする。頭頂や板だけの高さと同一視せず、見切れて同定できない場合は不明とする。下記は1人の目視観察であり、校正されたground truthやフレーム精度の保証ではない。時刻はスローを含む動画の再生秒である。

| 動画 | 推定頂点 | 目視照合とずれ |
| --- | ---: | --- |
| kickflip_10 | 5.10秒 | 腰付近が高くなる区間はおよそ4.8〜5.1秒。概ね頂点付近で、目視区間に対する差0〜+0.3秒。足や板の最高時点とは別 |
| kickflip_4 | 8.20秒 | 6.8〜7.8秒付近で腰・脚が高く、8.2秒は下降側に見える。高い区間より約0.4〜1.4秒遅い疑い。上体の見切れとカメラ変動があり、腰の真の頂点の一点確定はできない |
| kickflip_5 | 4.90秒 | まだ踏み切り前で、頂点とは合わない。空中で脚が高いのは概ね6.6〜7.4秒で、そこより1.7〜2.5秒早い。ただしこれは脚の目視比較で、腰が上端に切れるため真の腰頂点との厳密な差は算出不能 |
| kickflip_8 | 2.30秒 | 腰が高い区間は概ね2.25〜2.35秒。差約±0.05秒の範囲で概ね一致 |
| ollie_1 | 3.30秒 | 腰が高い区間は概ね3.30〜3.40秒。区間の前半で、差−0.10〜0秒程度 |
| ollie_4 | 1.70秒 | 腰が高い区間は概ね1.70〜1.80秒。区間の前半で、差−0.10〜0秒程度。ただし膝・足首の計測は欠損 |

kickflip_4は全体gate通過でも頂点妥当性に疑いがある。8.1/8.2/8.3秒の膝平均が111.22/159.80/90.55度と大きく変動し、8.2秒の原画像は膝を曲げているように見える。visibilityが高いことだけで推定関節位置や角度の正確さを保証できない。kickflip_5は5.1〜8.6秒の36サンプルが全pose欠損し、残った4.9秒を頂点としてしまう。両者は10fpsの量子化誤差だけでは説明できない問題である。

### 頂点1サンプルの数値候補

Aを上記頂点frame、Bを全derivedのhipYのp80、Hを全derivedの2D肩中心〜腰中心距離の中央値とする。膝角はworldLandmarksがあれば3Dの股関節−膝−足首角、なければnormalized 3D。左右は身体の解剖学的左右で、画面左右や前足／後足ではない。

| JSONキー（apex.features内） | 式・単位 | 値の範囲 / 欠損 |
| --- | --- | --- |
| leftKneeAngleDeg | Aの左股関節23−膝25−足首27の角、deg | 0〜180またはnull |
| rightKneeAngleDeg | Aの右股関節24−膝26−足首28の角、deg | 0〜180またはnull |
| meanKneeAngleDeg | 上記左右の平均、deg | 0〜180、片側欠損ならnull |
| hipHeightTorsoUnits | (B−A.hipY)/H、胴長比 | 有限実数またはnull。全範囲最小を選ばない場合もあり、負値を仕様で禁止しない |
| trunkTiltDeg | atan2(abs(肩腰中心dx),abs(肩腰中心dy))、deg | 0〜90またはnull |
| kneeAsymmetryDeg | abs(左膝角−右膝角)、deg | 0〜180、片側欠損ならnull |
| ankleHeightAsymmetryTorsoUnits | abs(A.y27−A.y28)/H、胴長比 | 0以上、有限上限なし、またはnull |
| footSeparationHipWidths | Aの2D足首間距離/Aの2D腰幅、腰幅比 | 0以上、有限上限なし、またはnull |

膝と非対称は空中での脚の引き上げ方、足幅は開き方を記述する候補。良好なフォームの閾値は未検証で、回転中の正常な非対称もある。腰相対高さは実跳躍高やmではない。2D値は画角・縦横比・カメラ移動に影響され、SIDEの小さい腰幅で足幅比は膨らみ得る。体幹を「小さいほど成功」とはしない（T11-1の当初仮説と逆方向の結果）。[T11-1記録](phase0-pose-landmarker-feasibility.md)

現実装は**左右どちらの膝も下半身8点全て**（23,24,25,26,27,28,31,32）のvisibility / presence≥0.5を要求する。片側だけ見える場合に片側角を救済する変更は今回提案に含めない。core不足、分母不足、頂点なしは対応値をnullとし、0埋めや時間補間で生成しない。範囲は数学的受入範囲であり成功の推奨範囲ではない。

| 動画 | 全体gate | 頂点秒 | 膝L / R / 平均deg | 腰相対高 | 体幹deg | 膝差deg | 足首差/胴長 | 足幅/腰幅 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| kickflip_10 | 通過 | 5.1 | 97.58 / 95.28 / 96.43 | 0.8735 | 2.42 | 2.30 | 0.0477 | 3.2740 |
| kickflip_4 | 通過 | 8.2 | 150.13 / 169.47 / 159.80 | 1.6312 | 8.52 | 19.34 | 0.1333 | 2.9995 |
| kickflip_5 | 不通過 | 4.9 | 135.41 / 146.07 / 140.74 | 0.6603 | 6.76 | 10.65 | 0.0890 | 1.5053 |
| kickflip_8 | 不通過 | 2.3 | 100.60 / 86.34 / 93.47 | 0.7433 | 14.40 | 14.25 | 0.1809 | 0.7846 |
| ollie_1 | 通過 | 3.3 | 49.26 / 130.46 / 89.86 | 0.3985 | 1.45 | 81.20 | 0.6396 | 3.9035 |
| ollie_4 | 不通過 | 1.7 | null / null / null | 0.5542 | 15.74 | null | null | null |

既存JSONからの読み取りで新たなpose推論なし。値が全てあるkickflip_5でも頂点の意味は成立しない。kickflip_8は頂点では値が揃うが冒頭の長い右下肢欠損で全体gate不通過。ollie_4は頂点で左膝25／左足首27不足、腰と体幹のみ取得できる。**第一案は3本ともJevへ送らずローカルUNASSESSABLE**を維持する。将来頂点局所gateを試すなら別条件にし、kickflip_5のような頂点選択の誤りを局所可視率だけで救済しない。

### 1点と近傍窓の代替案

10fpsの隣接サンプルは0.1秒。直前サンプル保持は最大約0.1秒ずれる。真の頂点の最寄りサンプルなら理想的には±0.05秒だが、現検出器は最寄り時刻を保証せず、欠損・推定誤差によるずれは0.1秒を超える。

| 方法 | 得失・欠損条件案 |
| --- | --- |
| 頂点Aの1点（JSON第一案） | 同じ瞬間の各部位を比較できる。単発ノイズ・欠損・頂点選択誤りに弱い |
| A±0.1秒の3点中央値 | 単発外れ値を抑える。全3点が有効な指標だけ採用する案。欠損を遠いframeで補わず、有効数/予定数を添える。中央値同士は同じ実姿勢を表すとは限らない |
| A±0.2秒の5点中央値 | より平滑化するが通常速度では上昇・下降が混ざりやすい。スローと同じ物理時間幅ではない。初回の主案にはしない |

実例: kickflip_4の±0.1秒の膝平均中央値は111.22度（単一点159.80度）、kickflip_10は89.40度（96.43度）。kickflip_8は117.89→93.47→71.66度で、変化そのものを平滑化する面もある。ollie_4は3点とも膝がnullで中央値でも救済不能。kickflip_5は3点とも有効だが誤った局面のままで、中央値は頂点検出を修正しない。膝差の窓中央値と左右膝中央値の差、足幅比の中央値と分子分母の中央値比は別なので、各frameで特徴値を算出してからその値の中央値を取る。

推奨は1点と±0.1秒の3点を**ローカルで比較してから**主条件を一つ固定すること。両方Jevに試す場合は別の入力条件として費用・比較数を増やす。欠損点が多い側だけ都合よく窓幅を広げない。

### JSON第一案

以下は架空値の構造例。単一点案でありAPI呼び出しコードではない。頂点時刻は動画再生ms、品質率は0〜1、countは0以上の整数。選択時刻とmodel/run versionはローカルにも残す。

```json
{
  "featureSchemaVersion": "apex-proposal-1",
  "trick": "KICKFLIP",
  "stance": "REGULAR",
  "cameraAngle": "FRONT",
  "recordingSpeed": "SLOW_MOTION",
  "measurement": {"sampleFps": 10, "angleSource": "world3d", "distanceSource": "normalized2d"},
  "quality": {"poseCoverage": 1, "lowerBodyCoverage": 1, "status": "ASSESSABLE"},
  "apex": {
    "method": "minimum_observed_hip_y_middle_5_95",
    "timestampMs": 5100,
    "selectionScope": "MIDDLE_5_95_PERCENT",
    "aggregation": "SINGLE_SAMPLE",
    "candidateCount": 80,
    "window": {"beforeMs": 0, "afterMs": 0, "scheduledCount": 1},
    "features": {
      "leftKneeAngleDeg": {"value": 97.58, "unit": "deg", "validCount": 1, "missingReason": null},
      "rightKneeAngleDeg": {"value": 95.28, "unit": "deg", "validCount": 1, "missingReason": null},
      "meanKneeAngleDeg": {"value": 96.43, "unit": "deg", "validCount": 1, "missingReason": null},
      "hipHeightTorsoUnits": {"value": 0.8735, "unit": "torso_ratio", "validCount": 1, "missingReason": null},
      "trunkTiltDeg": {"value": 2.42, "unit": "deg", "validCount": 1, "missingReason": null},
      "kneeAsymmetryDeg": {"value": 2.30, "unit": "deg", "validCount": 1, "missingReason": null},
      "ankleHeightAsymmetryTorsoUnits": {"value": 0.0477, "unit": "torso_ratio", "validCount": 1, "missingReason": null},
      "footSeparationHipWidths": {"value": 3.2740, "unit": "hip_width_ratio", "validCount": 1, "missingReason": null}
    }
  }
}
```

selectionScopeはMIDDLE_5_95_PERCENT / ALL_VALID_FALLBACK / NONE。NONEならtimestampMs=null、全特徴value=null、missingReason=NO_APEX。部位不足はLOWER_BODY_NOT_VISIBLE、core不足はCORE_NOT_VISIBLE、分母不足はINVALID_SCALE、窓有効点不足はINSUFFICIENT_WINDOW_SAMPLESなどの機械的理由を使う案。単一点のvalidCountは0/1、3点案なら0〜3。angleSourceはWORLD_3D等へenumを統一して実装時に固定し、混在ならMIXED、未知ならUNKNOWNとする。小数はdeg2桁・比4桁案、元精度はローカルに保持する。

品質不通過や頂点なしは主計画では非送信。診断目的の欠損送信を別承認する場合のみ、上の構造でnullと理由を送り、欠損を低い技量として扱わない説明を添える。頂点が数値的に存在するだけの場合、目視で正しい頂点と確認したことにしない。人手による頂点修正を使うなら自動結果と別条件にする。

### 他局面・全体集約は補助候補

| 補助候補 | 値と価値 | 限界・採否 |
| --- | --- | --- |
| 踏み切り前の最大屈曲 | 頂点より前の準備区間にある膝平均の最小値と時刻、左右角。頂点との差で伸展の過程を記述できる | 準備区間の定義が必要。単に動画冒頭〜頂点を走査すると無関係な屈曲も拾う。現全体p05はこの値の代用にならない |
| 推定着地とその後の窓 | 左右膝、足首高さ差、足幅、体幹の中央値。頂点だけに欠ける着地側の情報を補う | 現着地は腰が半分戻る代理時刻。板接地ではなく、窓もスローに依存。採否は依頼者判断 |
| 既存全体4集約値 | 膝平均p05、膝p90−p10、腰上下p90−p10/胴長、推定着地体幹中央値 | 頂点とは別の要約。腰相対高さとも異なる。重複や無関係な前後動作が入るため、初回から全部入れない |

体幹角速度と腰上昇時間はスロー率・欠損・サンプル方法に敏感なので引き続き初回から除く案。追加局面や窓幅を広げれば頂点の誤検出が自動的に直るわけではない。製品の4値マッピングは[measurement.ts](../lib/pose/measurement.ts)のまま変更しない。

## 6. 17本での小規模実験計画（承認前・未実施）

### 固定条件と漏洩防止

1. 推定頂点中心で入力指標、1点／3点窓、頂点妥当性の扱い、意味説明、null規則、採用gate、質問・選択肢順を固定。既存4値や他局面を含めるかも明示的に選ぶ。17本を見て成功閾値を後付けしない。
2. 既存manifestの17本（LANDED 7 / BAILED 10）を評価台帳とする。自己申告は比較基準であり、映像の第三者正解ラベルではない。ファイル名、sample ID、自己申告、メモ、Nova結果、ユーザー名、動画URI、生33点をstateから除く。対応IDはローカル台帳だけに置く。
3. 10fpsの既存計算結果を凍結し、データhash、設定／コードversion、JSON serialization、質問文、model `jev-1.13.0` を保存。計測の揺れとJevの揺れを分ける。異なる実行時刻・random uidをstateに追加しない。
4. 初回は成否のchoice（LANDED / BAILED / UNCLEAR）1問を候補とする。生の骨格数値に板の接地・回転完遂の直接観測がない旨を説明し、証拠不足ならUNCLEARを許す。confidenceを0〜100点の技量scoreへ転用しない。

### 対象、反復、比較

- 全17本を台帳に残す。既存gate通過11本を主試験の候補上限とする（頂点中心の適格数は未確定）。全体gate不通過の6本はコードでUNASSESSABLEにしてAPIへ送らない。頂点の誤検出や局所欠損を同じ事前基準で全17本チェックし、さらに減る場合は分母・理由を明示する。kickflip_4の疑義は検査対象であり、自己申告との一致を見て除外しない。通過数を増やすためにgateは緩めない。
- 各対象について**同一request bodyを5回**送る（11×5=55 request上限）。初めの2件をsmoke確認とし、その実行を5回に含める。2つの時間帯に3回＋2回で分け、model実値と応答を保存。client cacheは使わず、提供元の内部cacheは未知として記録する。
- 別の頑健性試験としてchoice順序を逆にしたrequestを各2回（11×2=22）。これは同一入力反復と混ぜない。総計77 request上限。4値のみとのablation等を加えるなら、別条件・追加費用として再設計する。
- 全17本への呼び出しは主計画に含めない。品質不足を含む診断試験を別途承認する場合の予算上限例だけを119 request（17×7）として下表に示す。

**精度:** 各反復のconfusion matrix、LANDED / BAILED別recall、balanced accuracy、UNCLEAR率を出す。棄却込みの正答数/17と、自動判断できた対象の正答数/判断数を併記する。gate由来棄却とJev由来棄却を分離する。全体majority baselineはBAILED固定10/17で、共通対象のbaselineは確定した共通対象（最大11本）に合わせて再計算する。

**安定性:** 全5回同一ラベルだった動画数/対象数、初回からの変更数/(対象数×4)、動画ごとの最頻一致率、各class確率のmax−min、confidenceのmax−minを出す。JSON完全一致も記録するが、request IDやusage等のmetadataは判断の一致と分ける。option順序試験は対応する選択肢名に戻して比較する。常に同じ誤答なら「安定・不正確」と報告する。

**Nova比較:** 過去の12/17正答・5/17反転と単純な割合比較はしない。既存2回の結果を確定した共通対象（最大11本）に絞った対比較、およびJev先頭2回の反転率を併記する。入力情報量が異なる（動画 vs 集約値）こと、17本が探索に使われた少数標本であることを示す。今回はNovaを再呼び出さない。

**判定案:** schema違反／欠損値捏造がないことと、同一入力5回でラベル反転0件を暫定継続条件とする（採用保証ではない）。正答率がbaseline以下、棄却が多すぎる、順序依存が強い場合は、数値入力だけの成否判断を見直す。精度・coverageの許容値は実験前にleaderと固定する。confidence閾値を試す場合は事前指定し、17本で最適化した閾値を検証済みと呼ばない。製品採用には別動画のholdoutが必要。

### 費用と実行上限

料金式: `request数 × 1 requestの課金input tokens × $0.042 / 1,000,000`。stateだけでなくquestionsを含むusage実値で精算する。1問で出力は無料。token数は未測定のため幅で示す。

| request数 | 2,000 token/回 | 5,000 token/回 | 10,000 token/回 |
| --- | ---: | ---: | ---: |
| 55（主反復） | $0.00462 | $0.01155 | $0.02310 |
| 77（順序試験込み） | $0.006468 | $0.01617 | $0.03234 |
| 119（全17本診断を別承認した場合） | $0.009996 | $0.02499 | $0.04998 |

提案上限は主計画77成功応答、retry込み最大231 attempt、token代$1まで。既定retryに任せず各attemptを記録し、429/529等はbackoff、timeoutは別計数する。HTTP直結の場合のretryも実装前に固定する。smokeのusageから残り費用を見直し、本文肥大・予想外課金で上限を超える見込みなら停止する。表は税・初期credit購入額を含まない。キーやcreditの取得・購入はまだ行わない。

## 7. leader / ユーザーに判断を依頼する項目

1. 推定頂点中心の8特徴から個別要素、1サンプル／近傍中央値、頂点妥当性の扱いを選ぶ。他局面・既存4集約値は補助候補として採否を決める。
2. 数値だけでの成否分類を探索する目的、品質不足時の棄却、精度・coverageの継続条件を確定する。助言生成や技量採点は今回の試験対象にしない案。
3. 固定model、同一入力5回＋順序変更2回、主計画最大77成功応答と費用枠を承認する。
4. 公開資料で不明な通常保存日数・リージョン詳細を実験前に確認する必要があるか判断する。必要なら問い合わせ担当と確認範囲を決める。

承認後に別タスクで実装・実験へ進む。本書の段階では成功判定、Jev入力要素、製品採用を確定していない。
