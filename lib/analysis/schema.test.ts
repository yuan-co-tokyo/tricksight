import { describe, expect, it } from "vitest";

import {
  skateAnalysisResultJsonSchema,
  skateAnalysisResultSchema,
  toProviderJsonSchema,
} from "./schema";

const resultWithoutOptionalFields = {
  summary: "Kickflip landed with a stable setup.",
  detected: {
    trickMatchesSelection: true,
    visibility: "GOOD",
  },
  result: {
    outcome: "LANDED",
    confidence: 0.9,
  },
  scores: {
    setup: 82,
    pop: 76,
    bodyBalance: 71,
    footControl: 79,
    landing: 85,
  },
  strengths: [
    {
      title: "Stable setup",
      description: "The shoulders remain aligned before the pop.",
    },
  ],
  improvements: [
    {
      title: "Quicker front foot",
      description: "Slide the front foot sooner after the pop.",
      priority: 1,
    },
  ],
  nextPractice: {
    focus: "Front-foot timing",
    drill: "Practice ten slow, controlled flicks.",
  },
} as const;

const completeResult = {
  ...resultWithoutOptionalFields,
  improvements: [
    {
      ...resultWithoutOptionalFields.improvements[0],
      timestampSeconds: 2.4,
    },
  ],
  safetyNote: "Wear a helmet and use a clear practice area.",
} as const;

describe("skateAnalysisResultSchema", () => {
  it("accepts an object with every field", () => {
    expect(skateAnalysisResultSchema.safeParse(completeResult).success).toBe(true);
  });

  it("accepts omitted optional fields", () => {
    expect(
      skateAnalysisResultSchema.safeParse(resultWithoutOptionalFields).success,
    ).toBe(true);
  });

  it("rejects a missing scores object", () => {
    const value: Record<string, unknown> = { ...completeResult };
    delete value.scores;

    expect(skateAnalysisResultSchema.safeParse(value).success).toBe(false);
  });

  it("rejects scores below, above, or between integer boundaries", () => {
    for (const pop of [-1, 101, 50.5]) {
      const value = {
        ...completeResult,
        scores: { ...completeResult.scores, pop },
      };

      expect(skateAnalysisResultSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects confidence outside the inclusive 0 to 1 range", () => {
    for (const confidence of [-0.1, 1.1]) {
      const value = {
        ...completeResult,
        result: { ...completeResult.result, confidence },
      };

      expect(skateAnalysisResultSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects unknown visibility and outcome values", () => {
    const unknownVisibility = {
      ...completeResult,
      detected: { ...completeResult.detected, visibility: "HIDDEN" },
    };
    const unknownOutcome = {
      ...completeResult,
      result: { ...completeResult.result, outcome: "PARTIAL" },
    };

    expect(skateAnalysisResultSchema.safeParse(unknownVisibility).success).toBe(
      false,
    );
    expect(skateAnalysisResultSchema.safeParse(unknownOutcome).success).toBe(
      false,
    );
  });

  it("rejects improvement priorities other than 1, 2, or 3", () => {
    for (const priority of [0, 4]) {
      const value = {
        ...completeResult,
        improvements: [{ ...completeResult.improvements[0], priority }],
      };

      expect(skateAnalysisResultSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects additional properties on strict objects", () => {
    const extraRootProperty = { ...completeResult, rawResponse: "unexpected" };
    const extraNestedProperty = {
      ...completeResult,
      scores: { ...completeResult.scores, overall: 80 },
    };

    expect(skateAnalysisResultSchema.safeParse(extraRootProperty).success).toBe(
      false,
    );
    expect(
      skateAnalysisResultSchema.safeParse(extraNestedProperty).success,
    ).toBe(false);
  });

  it("generates JSON Schema with scores and all five score fields required", () => {
    expect(skateAnalysisResultJsonSchema).toHaveProperty(
      "required",
      expect.arrayContaining(["scores"]),
    );
    expect(skateAnalysisResultJsonSchema).toHaveProperty(
      "properties.scores.required",
      ["setup", "pop", "bodyBalance", "footControl", "landing"],
    );
  });
});

describe("toProviderJsonSchema", () => {
  it("指定keywordをネストしたobjectとarray itemsから再帰的に除去する", () => {
    const source = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["score", "improvements"],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        improvements: {
          type: "array",
          items: {
            type: "object",
            required: ["priority"],
            properties: {
              priority: {
                type: "integer",
                enum: [1, 2, 3],
                exclusiveMinimum: 0,
                exclusiveMaximum: 4,
              },
            },
          },
        },
      },
    };

    const transformed = toProviderJsonSchema(source, {
      strip: [
        "$schema",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
      ],
    });

    expect(transformed).not.toHaveProperty("$schema");
    expect(transformed).not.toHaveProperty("properties.score.minimum");
    expect(transformed).not.toHaveProperty("properties.score.maximum");
    expect(transformed).not.toHaveProperty(
      "properties.improvements.items.properties.priority.exclusiveMinimum",
    );
    expect(transformed).not.toHaveProperty(
      "properties.improvements.items.properties.priority.exclusiveMaximum",
    );
    expect(source).toHaveProperty("properties.score.minimum", 0);
  });

  it("除去後もrequiredとenumを保持する", () => {
    const transformed = toProviderJsonSchema(
      skateAnalysisResultJsonSchema,
      {
        strip: ["minimum", "maximum"],
      },
    );

    expect(transformed).toHaveProperty(
      "required",
      expect.arrayContaining(["scores", "result"]),
    );
    expect(transformed).toHaveProperty("properties.detected.properties.visibility.enum", [
      "GOOD",
      "PARTIAL",
      "POOR",
    ]);
    expect(transformed).toHaveProperty("properties.result.properties.outcome.enum", [
      "LANDED",
      "BAILED",
      "UNCLEAR",
    ]);
  });
});
