# T12-1 TypeSafe / Jev 調査と小規模実験案

調査: 2026-10-04〜05。基準: T12-0検収済み `3f878a9`（origin/mainへpush済み）。本タスクは文書のみ。依存追加、製品変更、APIキー取得、評価API呼び出しは行っていない。公開資料の閲覧と既存ローカル診断JSONの読み取りだけを実施した。

## 判断案

**数値JSONを入力した分類実験は可能。ただし、再現性改善・スケートの成否判定能力は未確認。既存動画providerの置換は勧めない。** ユーザーがT12-0動画を見て入力要素を選び、leaderと実験条件を承認した後、独立した評価スクリプトで試す案とする。

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

## 5. 指標候補（未選定）

計算根拠は既存[metrics.ts](../lib/pose/metrics.ts)、製品への4値マッピングは[measurement.ts](../lib/pose/measurement.ts)。T12-0は可視化しただけで採点基準を検証していない。

表の範囲は数学的な受入範囲で、成功の推奨範囲ではない。`null`は欠損。Qpは有限値の線形補間分位数、Hは全derived frameの肩中心〜腰中心2D距離の中央値。Lは既存の「推定着地」から `min(1500,max(500,動画長ms×0.15))` msの区間。これは板の接地検出ではなく、腰yが頂点とp80基準の中間へ戻った最初の時刻である。

| JSONキー案 | 式・単位・範囲 | 用途仮説と根拠の強さ |
| --- | --- | --- |
| minimumMeanKneeAngleDeg（既存） | 左右膝角度平均のQ05、deg、0〜180 | 深く曲げた局面の比較。名前はminimumだがstrict minではない。T11-1の探索的差に留まる |
| kneeExtensionRangeDeg（既存） | 膝平均Q90−Q10、deg、0〜180 | 屈曲・伸展幅の記述。同条件での本人比較候補。成否の因果は未検証 |
| hipVerticalRangeTorsoUnits（既存） | 腰yの(Q90−Q10)/H、胴長比、0以上 | 腰移動の相対幅。実跳躍高・mではない。カメラ移動にも反応 |
| landingTrunkTiltDeg（既存） | Lのatan2(肩腰中心のabs dx, abs dy)中央値、deg、0〜90 | 体幹投影の記述。T11-1は当初仮説と逆方向。良否判定軸には推奨しない |
| **landingKneeAsymmetryDeg** | Lのmedian(abs(左膝角−右膝角))、deg、0〜180 | 左右の曲げ方の違いを記述。片足着地を示す可能性という仮説のみ。非対称が技の正常動作でも起こる |
| **landingAnkleHeightAsymmetryTorsoUnits** | Lのmedian(abs(y27−y28))/H、胴長比、0以上 | 左右足首の投影高さ差。片足が離れる状態を捉える可能性。ただし板との接触を測っていない |
| **landingFootSeparationHipWidths** | Lのmedian(2D足首間距離/同frame腰幅)、腰幅比、0以上 | 足の開き方の記述。SIDEで腰幅が小さいと比が大きくなり、成功基準の足幅とは扱えない |
| landingMeanKneeAngleDeg | Lの膝平均中央値、deg、0〜180 | 終盤の屈曲姿勢の記述。深さだけで衝撃吸収・成功を証明しない |
| postLandingTrunkTiltRangeDeg | Lの体幹角Q90−Q10、deg、0〜90 | 終盤の姿勢変動。T11-1の逆方向結果と投影の影響から探索限定 |
| postLandingHipRangeTorsoUnits | Lの腰y(Q90−Q10)/H、胴長比、0以上 | 終盤の上下動。ただし走り去り／カメラ追従と混ざるため探索限定 |

膝はworldLandmarksがあれば3Dの股関節−膝−足首角、なければnormalized 3D。胴長・腰幅・足首差はnormalized 2Dなので、画面縦横比と投影の影響がある。比の有限な上限は現式から決まらない。未知の外れ値を都合よくclipせず、分母・範囲外・欠損を記録して採否を判断する。

全体quality gateはposeCoverageとlowerBodyCoverageの両方≥0.8。下半身は23,24,25,26,27,28,31,32のvisibility / presence≥0.5。coreの11,12,23,24や正の胴長／腰幅が不足すればderived値も落ちる。L内に有効値がないと追加指標はnullになり、全体gate通過だけでは窓内の十分な観測数を保証しない。実験用には指標ごとのvalid count、窓内予定サンプル数、欠損理由も付ける案（まだ未実装）。

`hipRiseDurationMs` と `p95TrunkAngularSpeedDegPerSecond` は初回候補から外す案。撮影スロー率で時間尺度が変わり、T11-1で角速度はサンプル方法の変更に大きく反応した。現角速度式はderived frameの隣同士を使うので欠損をまたぐこともある。時間正規化と区間検証なしに速度を技量と結び付けない。

### T12-0の6本と候補3値の照合

既存 `eval/output/pose-viewer/*-*.json` のcalculatedを読み取った値。今回新たにpose推論はしていない。値は推定着地窓の中央値で、ビューアの現在frame値とは異なる。

| 動画 | 自己申告 / gate | 膝左右差deg | 足首高さ差/胴長 | 足幅/腰幅 |
| --- | --- | ---: | ---: | ---: |
| kickflip_10 | 失敗 / 通過 | 18.26 | 0.041 | 2.053 |
| kickflip_4 | 成功 / 通過 | 20.38 | 0.096 | 2.278 |
| kickflip_5 | 成功 / 不通過 | 12.65 | 0.121 | 1.779 |
| kickflip_8 | 失敗 / 不通過 | 9.20 | 0.108 | 2.148 |
| ollie_1 | 成功 / 通過 | 8.11 | 0.077 | 2.650 |
| ollie_4 | 失敗 / 不通過 | null | null | null |

不通過3本の値は診断限定で製品結果として利用しない。kickflip_5は5.1〜8.6秒にposeが全欠損し、見えている脚から数値を補えるわけではない。kickflip_8は冒頭の右膝／足首、ollie_4は左膝／足首の信頼度が落ちる。ollie_4の推定着地は1.9秒で、窓内の下半身値が得られず3指標ともnullになる。これらの目視根拠は[T12-0記録](t12-0-pose-viewer.md)を参照。

成功kickflip_4の膝差は失敗kickflip_10より大きい。足幅も成功ollie_1で最大であり、この選定6本から「非対称／広いほど失敗」という閾値は作れない。撮影方向・速度が異なり、独立した妥当性検証でもない。T11-1も17本中10fps gate通過11本、サンプル方式を変えても通るのは9本、kickflipの通過成功例は1本だけだった。[T11-1記録](phase0-pose-landmarker-feasibility.md)

### JSON構造案

以下は**架空値の構造例**。採用フィールドや良否の閾値を決めたものではない。追加3値を選ぶ場合の形を示す。requestのstateに入れる部分であり、API呼び出しコードではない。

```json
{
  "featureSchemaVersion": "proposal-1",
  "trick": "KICKFLIP",
  "stance": "REGULAR",
  "cameraAngle": "SIDE",
  "recordingSpeed": "SLOW_MOTION",
  "measurement": {"sampleFps": 10, "angleSource": "world3d", "distanceSource": "normalized2d"},
  "quality": {"poseCoverage": 0.95, "lowerBodyCoverage": 0.90, "status": "ASSESSABLE"},
  "landingWindow": {"kind": "hip_half_return_proxy", "validLowerBodyCount": 8, "scheduledSampleCount": 10},
  "features": {
    "landingKneeAsymmetryDeg": {"value": 18.2, "unit": "deg", "missingReason": null},
    "landingAnkleHeightAsymmetryTorsoUnits": {"value": 0.08, "unit": "torso_ratio", "missingReason": null},
    "landingFootSeparationHipWidths": {"value": 2.1, "unit": "hip_width_ratio", "missingReason": null}
  }
}
```

coverageは0〜1、countは0以上の整数、valid≤scheduled、enumは既知値またはUNKNOWN、特徴値は表の範囲内またはnull。nullにはNO_VALID_SAMPLES等の理由を付け、0で埋めない。送信小数桁は実験開始前に固定（例: deg小数2桁・比小数4桁）、元精度もローカルに保存する。角度sourceが混在する場合は単一world3dと偽らずMIXEDとして記録する。

## 6. 17本での小規模実験計画（承認前・未実施）

### 固定条件と漏洩防止

1. ユーザーの動画確認後、入力指標、意味説明、null規則、採用gate、質問・選択肢順を固定。既存4値を含めるかも明示的に選ぶ。17本を見て成功閾値を後付けしない。
2. 既存manifestの17本（LANDED 7 / BAILED 10）を評価台帳とする。自己申告は比較基準であり、映像の第三者正解ラベルではない。ファイル名、sample ID、自己申告、メモ、Nova結果、ユーザー名、動画URI、生33点をstateから除く。対応IDはローカル台帳だけに置く。
3. 10fpsの既存計算結果を凍結し、データhash、設定／コードversion、JSON serialization、質問文、model `jev-1.13.0` を保存。計測の揺れとJevの揺れを分ける。異なる実行時刻・random uidをstateに追加しない。
4. 初回は成否のchoice（LANDED / BAILED / UNCLEAR）1問を候補とする。生の骨格数値に板の接地・回転完遂の直接観測がない旨を説明し、証拠不足ならUNCLEARを許す。confidenceを0〜100点の技量scoreへ転用しない。

### 対象、反復、比較

- 全17本を台帳に残す。既存gate通過11本が主試験、6本はコードでUNASSESSABLEにしてAPIへ送らない。追加フィールドの窓内要件でさらに減る場合は、その分母・理由を明示する。通過数を増やすためにgateは緩めない。
- 各対象について**同一request bodyを5回**送る（11×5=55 request上限）。初めの2件をsmoke確認とし、その実行を5回に含める。2つの時間帯に3回＋2回で分け、model実値と応答を保存。client cacheは使わず、提供元の内部cacheは未知として記録する。
- 別の頑健性試験としてchoice順序を逆にしたrequestを各2回（11×2=22）。これは同一入力反復と混ぜない。総計77 request上限。4値のみとのablation等を加えるなら、別条件・追加費用として再設計する。
- 全17本への呼び出しは主計画に含めない。品質不足を含む診断試験を別途承認する場合の予算上限例だけを119 request（17×7）として下表に示す。

**精度:** 各反復のconfusion matrix、LANDED / BAILED別recall、balanced accuracy、UNCLEAR率を出す。棄却込みの正答数/17と、自動判断できた対象の正答数/判断数を併記する。gate由来棄却とJev由来棄却を分離する。全体majority baselineはBAILED固定10/17で、共通対象のbaselineはその11本に合わせて再計算する。

**安定性:** 全5回同一ラベルだった動画数/対象数、初回からの変更数/(対象数×4)、動画ごとの最頻一致率、各class確率のmax−min、confidenceのmax−minを出す。JSON完全一致も記録するが、request IDやusage等のmetadataは判断の一致と分ける。option順序試験は対応する選択肢名に戻して比較する。常に同じ誤答なら「安定・不正確」と報告する。

**Nova比較:** 過去の12/17正答・5/17反転と単純な割合比較はしない。既存2回の結果を共通対象11本に絞った対比較、およびJev先頭2回の反転率を併記する。入力情報量が異なる（動画 vs 集約値）こと、17本が探索に使われた少数標本であることを示す。今回はNovaを再呼び出さない。

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

1. T12-0の6動画を確認したうえで、既存4値と追加候補から入力要素を選ぶ。3つの非対称／足幅指標は候補であって決定事項ではない。
2. 数値だけでの成否分類を探索する目的、品質不足時の棄却、精度・coverageの継続条件を確定する。助言生成や技量採点は今回の試験対象にしない案。
3. 固定model、同一入力5回＋順序変更2回、主計画最大77成功応答と費用枠を承認する。
4. 公開資料で不明な通常保存日数・リージョン詳細を実験前に確認する必要があるか判断する。必要なら問い合わせ担当と確認範囲を決める。

承認後に別タスクで実装・実験へ進む。本書の段階では成功判定、Jev入力要素、製品採用を確定していない。
