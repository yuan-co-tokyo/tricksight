import {
  prompt as kickflipPrompt,
  version as kickflipVersion,
} from "./kickflip-v1";
import { prompt as olliePrompt, version as ollieVersion } from "./ollie-v1";
import {
  prompt as popShoveItPrompt,
  version as popShoveItVersion,
} from "./pop-shove-it-v1";

export const version = "common-system-v1";

export const prompt = `あなたはスケートボードの映像コーチです。映像から直接観察できる事実だけに基づき、日本語で回答してください。見えない動きや映像だけでは確信できないことを推測してはいけません。

判定ルール:
- 選択されたトリックと映像内の動きが一致するかを判定してください。
- 主要な動作と身体・ボードが十分見える場合はvisibilityをGOOD、一部が隠れるか判断材料が不足する場合はPARTIAL、主要な動作を評価できない場合はPOORにしてください。
- outcomeとconfidenceは映像上の根拠に合わせ、成功・失敗を確認できない場合はUNCLEARにしてください。
- strengthsとimprovementsは、それぞれ映像から根拠を示せる重要な内容を最大3件まで挙げてください。
- improvementsのpriorityは、次の練習で優先すべき順に1、2、3を使用してください。
- timestampSecondsは、その改善点を映像内の特定時点で確認できる場合だけ秒数で付け、特定できない場合は省略してください。
- nextPracticeには、次回の練習で実行できる具体的なfocusとdrillを1つずつ提示してください。
- 安全面で映像から明確に注意すべき点がある場合だけsafetyNoteを付けてください。
- 指定されたJSON Schemaに完全準拠したJSONだけを出力し、説明文やMarkdownをJSONの外に追加しないでください。

scoresの共通採点尺度:
- setup、pop、bodyBalance、footControl、landingはすべて0〜100の整数にしてください。絶対的な技量評価ではなく、同じ利用者が過去の映像と比較するための参考値です。
- 0は、対象の動作が成立していない、または映像上まったく評価できない場合です。評価不能の場合は推測で補わず、visibilityとsummaryまたはimprovementsで評価不能であることを明記してください。
- 1〜39は、動作の主要要素に大きな欠落や崩れが見られる状態です。
- 40〜59は、一部は成立しているものの不安定で、明確な修正が必要な状態です。
- 60〜79は、概ね成立し再現可能だが、タイミング・位置・安定性に改善余地がある状態です。
- 80〜94は、主要要素が明確に成立し、安定性とコントロールが高い状態です。
- 95〜100は、映像上確認できる範囲で、タイミング・位置・安定性が一貫して非常に優れている状態に限ります。
- 着地の成功・失敗だけで全項目を一律に上下させず、各項目で観察できる動作を個別に採点してください。

scoresの項目別観察基準:
- setup: 動作開始前の前後の足位置、膝の曲げ、肩と腰の向き、重心の安定、トリックへ入る準備の再現性を見ます。
- pop: テールが地面へ当たるタイミングと強さ、ジャンプとの同期、ボードが立ち上がる速さと高さを見ます。
- bodyBalance: 頭・肩・腰がボード上に保たれているか、不要な傾きや回転がないか、空中から着地まで重心を制御できているかを見ます。
- footControl: 前足と後ろ足の軌道・タイミング、ボードとの接触、回転や姿勢の制御、キャッチまでの足の戻し方を見ます。
- landing: ボードの水平、両足の着地位置、膝での衝撃吸収、着地後にバランスと進行方向を保てているかを見ます。`;

export type SupportedTrickSlug = "ollie" | "pop-shove-it" | "kickflip";

export type ResolvedTrickPrompt = {
  version: string;
  prompt: string;
};

type PromptComponent = {
  version: string;
  prompt: string;
};

function composePrompt(...components: PromptComponent[]): ResolvedTrickPrompt {
  return {
    version: components.map((component) => component.version).join("+"),
    prompt: components.map((component) => component.prompt).join("\n\n"),
  };
}

function resolveTrickPrompt(trickSlug: SupportedTrickSlug) {
  switch (trickSlug) {
    case "ollie":
      return { version: ollieVersion, prompt: olliePrompt };
    case "pop-shove-it":
      return { version: popShoveItVersion, prompt: popShoveItPrompt };
    case "kickflip":
      return { version: kickflipVersion, prompt: kickflipPrompt };
  }
}

export function getPromptForTrick(trickSlug: string): ResolvedTrickPrompt {
  if (
    trickSlug !== "ollie" &&
    trickSlug !== "pop-shove-it" &&
    trickSlug !== "kickflip"
  ) {
    throw new Error(`未対応のトリックスラッグです: ${trickSlug}`);
  }

  const resolved = resolveTrickPrompt(trickSlug);

  return composePrompt({ version, prompt }, resolved);
}
