/**
 * Development diagnostics are deliberately local: they are never posted to a
 * collector. Keep payloads small and free of account, game, or board data so
 * a console capture is safe to share when debugging a development build.
 */

type DiagnosticData = Record<string, unknown>;

const MAX_DEPTH = 3;
const MAX_ENTRIES = 24;
const MAX_STRING_LENGTH = 160;
const SENSITIVE_KEY =
  /(?:auth|token|secret|password|cookie|email|user(?:name)?|account|owner|game(?:id)?|pgn|fen|move(?:s)?|position|url|uri|host|session|run)/i;
const SENSITIVE_VALUE = /(?:https?:\/\/|bearer\s+|token=|^[prnbqk1-8/]+ [wb] [KQkq-]+ )/i;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    if (SENSITIVE_VALUE.test(value)) return "[redacted]";
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value;
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((item) => redact(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ENTRIES)
        .map(([key, nested]) => [
          key,
          SENSITIVE_KEY.test(key) ? "[redacted]" : redact(nested, depth + 1),
        ])
    );
  }
  return String(value);
}

export function agentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: DiagnosticData = {}
): void {
  if (!__DEV__) return;

  console.debug("[chess-wrapped diagnostic]", {
    hypothesisId,
    location,
    message,
    data: redact(data),
    timestamp: new Date().toISOString(),
  });
}
