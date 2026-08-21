export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly endpoint: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type HttpErrorKind = "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "AUTH" | "RATE_LIMIT" | "SERVER" | "UNKNOWN";

export interface ClassifiedHttpError {
  kind: HttpErrorKind;
  retryable: boolean;
  httpStatus?: number;
  message: string;
}

function summarizeBody(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body.trim().slice(0, 180);
  if (typeof body === "object") {
    const record = body as Record<string, unknown>;
    const detail = record.message ?? record.mensagem ?? record.error ?? record.detail ?? record.title;
    if (typeof detail === "string" && detail.trim()) {
      const errors = record.errors;
      if (errors && typeof errors === "object" && !Array.isArray(errors)) {
        const parts = Object.entries(errors as Record<string, unknown>).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => `${key}: ${String(item)}`) : [`${key}: ${String(value)}`]);
        if (parts.length) return `${detail.trim()}; ${parts.join("; ")}`.slice(0, 180);
      }
      return detail.trim().slice(0, 180);
    }
    if (record.errors && typeof record.errors === "object") return summarizeBody({ message: "Validação recusada", errors: record.errors });
  }
  return "";
}

export function classifyHttpError(error: unknown): ClassifiedHttpError {
  const status = error && typeof error === "object" && "status" in error && typeof (error as { status: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined;
  const body = error && typeof error === "object" && "body" in error ? (error as { body: unknown }).body : undefined;
  const endpoint = error && typeof error === "object" && "endpoint" in error && typeof (error as { endpoint: unknown }).endpoint === "string"
    ? (error as { endpoint: string }).endpoint
    : undefined;
  if (status != null) {
    const detail = summarizeBody(body);
    const suffix = detail ? `: ${detail}` : "";
    if (status === 400) return { kind: "VALIDATION", retryable: false, httpStatus: 400, message: `Validação recusada${suffix}` };
    if (status === 401 || status === 403) return { kind: "AUTH", retryable: false, httpStatus: status, message: `Autenticação recusada HTTP ${status}` };
    if (status === 404) return { kind: "NOT_FOUND", retryable: false, httpStatus: 404, message: `Recurso não encontrado${suffix || (endpoint ? ` em ${endpoint}` : "")}` };
    if (status === 409) return { kind: "CONFLICT", retryable: false, httpStatus: 409, message: `Conflito ou duplicidade${suffix}` };
    if (status === 429) return { kind: "RATE_LIMIT", retryable: true, httpStatus: 429, message: "Limite de requisições atingido" };
    if (status >= 500) return { kind: "SERVER", retryable: true, httpStatus: status, message: `Falha temporária HTTP ${status}${endpoint ? ` em ${endpoint}` : ""}` };
    const where = endpoint ? ` em ${endpoint}` : "";
    return { kind: "UNKNOWN", retryable: false, httpStatus: status, message: `HTTP ${status}${suffix}${where}` };
  }
  if (error instanceof Error && (error.name === "AbortError" || error.message.startsWith("Timeout"))) {
    return { kind: "SERVER", retryable: true, message: error.message };
  }
  return { kind: "UNKNOWN", retryable: false, message: error instanceof Error ? error.message : "Falha desconhecida" };
}

export interface HttpClientOptions {
  baseUrl: string;
  token?: string;
  authorizationHeader?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export type RequestOptions = RequestInit & { retry?: boolean };

export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  async request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const { retry, ...requestInit } = init;
    const retries = this.options.maxRetries ?? 3;
    let attempt = 0;
    for (;;) {
      try {
        return await this.requestOnce<T>(path, requestInit);
      } catch (error) {
        if (attempt >= retries || !isRetryable(error, requestInit.method ?? "GET", retry === true)) throw error;
        const retryAfter = error instanceof HttpError && error.retryAfterMs ? error.retryAfterMs : 0;
        const delay = Math.max(retryAfter, Math.min(10_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 150));
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt += 1;
      }
    }
  }

  private async requestOnce<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const endpoint = `${this.options.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    try {
      const response = await fetch(endpoint, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(this.options.authorizationHeader ? { Authorization: this.options.authorizationHeader } : this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
          ...init.headers,
        },
      });
      const raw = await response.text();
      let body: unknown = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        throw new HttpError(`HTTP ${response.status}`, response.status, body, endpoint, retryAfter ? Number(retryAfter) * 1_000 : undefined);
      }
      return body as T;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Timeout ao acessar ${endpoint}`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRetryable(error: unknown, method: string, force = false): boolean {
  if (!force && !["GET", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase())) return false;
  const status = error && typeof error === "object" && "status" in error && typeof (error as { status: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined;
  if (status != null) return status === 429 || [500, 502, 503, 504].includes(status);
  return error instanceof TypeError || (error instanceof Error && error.message.startsWith("Timeout"));
}
