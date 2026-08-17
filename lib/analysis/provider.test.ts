import { describe, expect, it } from "vitest";

import { formatVideoAnalysisErrorDetails } from "./provider";

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
});
