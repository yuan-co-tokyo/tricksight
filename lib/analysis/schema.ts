import { z } from "zod";

export type ProviderJsonSchemaOptions = {
  strip: readonly string[];
};

export function toProviderJsonSchema<T>(
  schema: T,
  options: ProviderJsonSchemaOptions,
): T {
  const strippedKeywords = new Set(options.strip);

  function transform(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(transform);
    }
    if (typeof value !== "object" || value === null) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !strippedKeywords.has(key))
        .map(([key, child]) => [key, transform(child)]),
    );
  }

  return transform(schema) as T;
}

const scoreSchema = z.number().int().min(0).max(100);

export const skateAnalysisResultSchema = z.strictObject({
  summary: z.string(),
  detected: z.strictObject({
    trickMatchesSelection: z.boolean(),
    visibility: z.enum(["GOOD", "PARTIAL", "POOR"]),
  }),
  result: z.strictObject({
    outcome: z.enum(["LANDED", "BAILED", "UNCLEAR"]),
    confidence: z.number().min(0).max(1),
  }),
  scores: z.strictObject({
    setup: scoreSchema,
    pop: scoreSchema,
    bodyBalance: scoreSchema,
    footControl: scoreSchema,
    landing: scoreSchema,
  }),
  strengths: z.array(
    z.strictObject({
      title: z.string(),
      description: z.string(),
    }),
  ),
  improvements: z.array(
    z.strictObject({
      title: z.string(),
      description: z.string(),
      priority: z.literal([1, 2, 3]),
      timestampSeconds: z.number().optional(),
    }),
  ),
  nextPractice: z.strictObject({
    focus: z.string(),
    drill: z.string(),
  }),
  safetyNote: z.string().optional(),
});

export type SkateAnalysisResult = z.infer<typeof skateAnalysisResultSchema>;

export const skateAnalysisResultJsonSchema = z.toJSONSchema(
  skateAnalysisResultSchema,
);
