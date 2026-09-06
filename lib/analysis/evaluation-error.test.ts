import { describe, expect, it } from "vitest";

import { formatEvaluationError } from "./evaluation-error";
import { VideoAnalysisError } from "./provider";

describe("formatEvaluationError", () => {
  it("VideoAnalysisErrorのcauseをマスク済みdetailsとして保持する", () => {
    const cause = Object.assign(new Error("Access denied"), {
      name: "AccessDeniedException",
      $metadata: { requestId: "request-123", httpStatusCode: 403 },
      authorization: "Bearer secret-token",
    });
    const error = new VideoAnalysisError(
      "BEDROCK_INVOKE_FAILED",
      "Bedrock呼び出しに失敗しました。",
      {
        cause,
        rawResponse: {
          output: "```json\n{}\n```",
          apiKey: "tlk_raw-secret",
        },
      },
    );

    const formatted = formatEvaluationError(error);

    expect(formatted.message).toBe(
      "VideoAnalysisError: Bedrock呼び出しに失敗しました。",
    );
    expect(formatted.details).toContain("AccessDeniedException");
    expect(formatted.details).toContain("request-123");
    expect(formatted.details).toContain("```json");
    expect(formatted.details).toContain("[REDACTED]");
    expect(formatted.details).not.toContain("secret-token");
    expect(formatted.details).not.toContain("tlk_raw-secret");
  });
});
