import { describe, expect, it } from "vitest";

import {
  formatVideoAnalysisErrorDetails,
  sanitizeVideoAnalysisErrorText,
  sanitizeVideoAnalysisRawResponse,
} from "./provider";

describe("provider error detail sanitization", () => {
  it("redacts nested keys, API tokens, AWS keys, bearer tokens, and signed URLs", () => {
    const details = formatVideoAnalysisErrorDetails({
      apiKey: "tlk_super-secret-value",
      nested: {
        authorization: "Bearer bearer-super-secret",
        message:
          "key=AKIAABCDEFGHIJKLMNOP url=https://example.test/video?X-Amz-Signature=signature-secret",
      },
    });

    expect(details).toContain("[REDACTED]");
    expect(details).not.toContain("tlk_super-secret-value");
    expect(details).not.toContain("bearer-super-secret");
    expect(details).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(details).not.toContain("signature-secret");
  });

  it("keeps diagnostic text JSON-safe while redacting raw response secrets", () => {
    const rawResponse = sanitizeVideoAnalysisRawResponse({
      id: "analysis-123",
      data: 'not-json api_key="tlk_raw-secret"',
      authorization: "Bearer raw-bearer-secret",
      usage: { outputTokens: 420 },
      sessionToken: "aws-session-secret",
      circular: undefined,
    });

    expect(rawResponse).toEqual({
      id: "analysis-123",
      data: 'not-json api_key="[REDACTED]"',
      authorization: "[REDACTED]",
      usage: { outputTokens: 420 },
      sessionToken: "[REDACTED]",
    });
    expect(JSON.stringify(rawResponse)).not.toContain("tlk_raw-secret");
    expect(JSON.stringify(rawResponse)).not.toContain("raw-bearer-secret");
    expect(JSON.stringify(rawResponse)).not.toContain("aws-session-secret");
  });

  it("keeps parser diagnostics that use token as an ordinary word", () => {
    const message = "Unexpected token '`', JSON is invalid";

    expect(sanitizeVideoAnalysisErrorText(message)).toBe(message);
    expect(
      sanitizeVideoAnalysisErrorText("token=private-value"),
    ).toBe("token=[REDACTED]");
  });
});
