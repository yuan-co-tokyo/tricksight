import { sanitizeVideoAnalysisErrorText } from "../analysis/provider";

export type ApplicationLogEvent =
  | "analysis.execution.failed"
  | "analysis.request.failed"
  | "analysis.status.failed"
  | "analysis.stuck_detected"
  | "session.deletion.failed"
  | "upload.completion.failed"
  | "upload.presigned_post.failed"
  | "video.playback_url.failed";

export type ApplicationLogContext = Record<
  string,
  string | number | boolean | null | undefined
>;

type UnexpectedErrorReporter = (error: unknown) => void;

const SENSITIVE_CONTEXT_KEY_PATTERN =
  /authorization|cookie|credential|password|secret|signature|api[-_]?key|access[-_]?key|token|url|uri/i;

function sanitizedContext(context: ApplicationLogContext) {
  return Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) => {
      if (value === undefined) return [];
      if (SENSITIVE_CONTEXT_KEY_PATTERN.test(key)) {
        return [[key, "[REDACTED]"]];
      }

      return [
        [
          key,
          typeof value === "string"
            ? sanitizeVideoAnalysisErrorText(value)
            : value,
        ],
      ];
    }),
  );
}

function safeErrorName(error: unknown) {
  if (!(error instanceof Error)) return "UnknownError";

  const sanitized = sanitizeVideoAnalysisErrorText(error.name).slice(0, 100);
  return sanitized || "Error";
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;

  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return undefined;

  const sanitized = sanitizeVideoAnalysisErrorText(code);
  return /^(?:[A-Z][A-Z0-9_.-]{0,99}|[0-9]{5})$/.test(sanitized)
    ? sanitized
    : undefined;
}

function safeAwsMetadata(error: unknown) {
  if (!error || typeof error !== "object") return {};

  const metadata = (error as {
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
  }).$metadata;
  const httpStatusCode = metadata?.httpStatusCode;
  const requestId = metadata?.requestId;

  return {
    ...(typeof httpStatusCode === "number" &&
    Number.isInteger(httpStatusCode) &&
    httpStatusCode >= 100 &&
    httpStatusCode <= 599
      ? { httpStatusCode }
      : {}),
    ...(typeof requestId === "string" &&
    /^[A-Za-z0-9+/=_-]{1,200}$/.test(requestId)
      ? { awsRequestId: requestId }
      : {}),
  };
}

export function reportApplicationError(input: {
  event: ApplicationLogEvent;
  error: unknown;
  context?: ApplicationLogContext;
}) {
  const errorCode = safeErrorCode(input.error);

  console.error(
    JSON.stringify({
      level: "ERROR",
      event: input.event,
      timestamp: new Date().toISOString(),
      context: sanitizedContext(input.context ?? {}),
      error: {
        name: safeErrorName(input.error),
        ...(errorCode ? { code: errorCode } : {}),
        ...safeAwsMetadata(input.error),
      },
    }),
  );
}

export function reportApplicationWarning(input: {
  event: ApplicationLogEvent;
  context?: ApplicationLogContext;
}) {
  console.warn(
    JSON.stringify({
      level: "WARN",
      event: input.event,
      timestamp: new Date().toISOString(),
      context: sanitizedContext(input.context ?? {}),
    }),
  );
}

export function createUnexpectedErrorReporter(input: {
  event: ApplicationLogEvent;
  reporter?: UnexpectedErrorReporter;
}) {
  return (error: unknown, context: ApplicationLogContext = {}) => {
    if (input.reporter) {
      input.reporter(error);
      return;
    }

    reportApplicationError({
      event: input.event,
      error,
      context,
    });
  };
}
