export * from "./schemas";
export * from "./mapping";

const sensitiveKeys = /authorization|token|password|secret|cookie|base64|binary|receiptData|anexos/i;
const jwtPattern = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g;
const bearerPattern = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const dataUriPattern = /data:[^;]+;base64,[A-Za-z0-9+/=\s]+/gi;

function sanitizeString(value: string): string {
  return value.replace(jwtPattern, "<REDACTED>").replace(bearerPattern, "Bearer <REDACTED>").replace(dataUriPattern, "data:<REDACTED>").slice(0, 2_000);
}

export function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKeys.test(key) ? "<REDACTED>" : sanitizeValue(child),
      ]),
    );
  }
  return typeof value === "string" ? sanitizeString(value) : value;
}
