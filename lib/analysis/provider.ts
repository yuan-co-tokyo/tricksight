import type { cameraAngleEnum } from "@/lib/db/schema/app";
import type { SupportedTrickSlug } from "@/prompts/common-system-v1";

import type { SkateAnalysisResult } from "./schema";

export type CameraAngle = (typeof cameraAngleEnum.enumValues)[number];

export type Stance = "REGULAR" | "GOOFY";

export type PromptVersionFamily = "v1";

export type VideoAnalysisInput = {
  videoS3Uri: string;
  trick: SupportedTrickSlug;
  stance: Stance;
  cameraAngle: CameraAngle;
  /**
   * 利用するプロンプトのバージョン系統を指定する値。
   * 現在は "v1" だけを有効とし、実装はそれ以外を明確に拒否する。
   */
  promptVersion: string;
};

export type VideoAnalysisOutput = {
  result: SkateAnalysisResult;
  /** モデルの生レスポンス。永続化専用で、ブラウザへ返してはいけない。 */
  rawResponse: unknown;
  /**
   * 実際の分析に使われた、共通指示とトリック別指示の解決済み複合version。
   * 入力の系統指定とは異なり、getPromptForTrick()が返した値をそのまま保持する。
   */
  promptVersion: string;
};

export interface VideoAnalysisProvider {
  readonly providerName: string;
  readonly modelId: string;
  /** promptVersionが"v1"以外の場合はUnsupportedPromptVersionErrorを投げる。 */
  analyze(input: VideoAnalysisInput): Promise<VideoAnalysisOutput>;
}

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|credential|password|secret|signature|token|api[-_]?key/i;

export function sanitizeVideoAnalysisErrorText(value: string): string {
  return value
    .replace(/\btlk_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)[^\s,;"']+/gi, "$1[REDACTED]")
    .replace(
      /([?&](?:X-Amz-(?:Credential|Security-Token|Signature))=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:authorization|x-api-key|api[-_]?key|password|secret|token|credential|signature)["'\s:=]+)[^\s,;}"']+/gi,
      "$1[REDACTED]",
    );
}

function sanitizeDetailValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return sanitizeVideoAnalysisErrorText(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetailValue(item, seen));
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  if (value instanceof Error) {
    sanitized.name = value.name;
    sanitized.message = sanitizeVideoAnalysisErrorText(value.message);
  }

  for (const [key, item] of Object.entries(source)) {
    if (key === "stack") continue;
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : sanitizeDetailValue(item, seen);
  }

  if (value instanceof Error && value.cause !== undefined) {
    sanitized.cause = sanitizeDetailValue(value.cause, seen);
  }
  return sanitized;
}

export function formatVideoAnalysisErrorDetails(cause: unknown): string {
  try {
    return JSON.stringify(sanitizeDetailValue(cause, new WeakSet()), null, 2);
  } catch {
    return sanitizeVideoAnalysisErrorText(String(cause));
  }
}

export class VideoAnalysisError extends Error {
  readonly code: string;
  readonly details?: string;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions & { details?: string },
  ) {
    super(message, options);
    this.name = "VideoAnalysisError";
    this.code = code;
    this.details =
      options?.details !== undefined
        ? sanitizeVideoAnalysisErrorText(options.details)
        : options?.cause === undefined
          ? undefined
          : formatVideoAnalysisErrorDetails(options.cause);
  }
}

export class UnsupportedPromptVersionError extends VideoAnalysisError {
  constructor(promptVersion: string) {
    super(
      "UNSUPPORTED_PROMPT_VERSION",
      `未対応のプロンプトバージョンです: ${promptVersion}`,
    );
    this.name = "UnsupportedPromptVersionError";
  }
}
