/**
 * The transport every Bitnormous client sits on.
 *
 * It is deliberately small and built on `fetch`, so the same code runs on Node 18+, Bun, Deno,
 * Cloudflare Workers, Vercel Edge and the browser with no adapter and no dependencies.
 *
 * The one piece of real judgement in here is {@link shouldRetry}: a retry is only safe when
 * repeating the request cannot charge a customer twice. GETs always qualify; writes qualify only
 * when they carry an idempotency key, because that key is what makes the server collapse the
 * duplicate.
 */

import { BitnormousConnectionError, BitnormousError, errorFromResponse } from './errors.js';

export const SDK_VERSION = '1.0.0';

export interface RetryOptions {
  /** Attempts AFTER the first. `0` disables retrying. Default: 2. */
  maxRetries?: number;
  /** Base backoff in ms, doubled each attempt and jittered. Default: 250. */
  backoffMs?: number;
  /** Ceiling for a single backoff. Default: 8000. */
  maxBackoffMs?: number;
}

export interface TransportOptions extends RetryOptions {
  /** API origin. Default: `https://api.bitnormous.com`. */
  baseUrl?: string;
  /** Per-request ceiling in ms, across all of connect, send and read. Default: 30_000. */
  timeout?: number;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Swap in your own `fetch` — for tests, tracing, or a proxy. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Makes a write safely repeatable. The server returns the ORIGINAL result for a repeat rather
   * than performing the action again, which is what lets the SDK retry a write it is unsure about.
   */
  idempotencyKey?: string;
  /** Overrides the transport default for this call. */
  timeout?: number;
  /** Abort from your own controller (a React effect cleanup, a cancelled navigation). */
  signal?: AbortSignal;
}

export const DEFAULT_BASE_URL = 'https://api.bitnormous.com';

/** Every business endpoint hangs off this. */
const API_PREFIX = '/api/v1/business';

/**
 * The platform envelope. Success bodies are `{status, success, message, data, code}` and the SDK
 * returns `data` — callers should never have to unwrap a transport detail.
 */
interface Envelope<T> {
  data?: T;
}

export class Transport {
  private readonly baseUrl: string;

  private readonly timeout: number;

  private readonly headers: Record<string, string>;

  private readonly fetchImpl: typeof globalThis.fetch;

  private readonly maxRetries: number;

  private readonly backoffMs: number;

  private readonly maxBackoffMs: number;

  constructor(options: TransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? 30_000;
    this.headers = options.headers ?? {};
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffMs = options.backoffMs ?? 250;
    this.maxBackoffMs = options.maxBackoffMs ?? 8_000;

    const impl = options.fetch ?? globalThis.fetch;
    if (typeof impl !== 'function') {
      throw new TypeError(
        'No global fetch was found. Use Node 18+, or pass one in as `fetch` when constructing the client.',
      );
    }
    // Unbound `globalThis.fetch` throws "Illegal invocation" in browsers.
    this.fetchImpl = impl.bind(globalThis);
  }

  /** Issue a request and return the unwrapped `data`. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(path, options.query);
    const retryable = method === 'GET' || options.idempotencyKey !== undefined;

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.send(url, method, options);

        if (response.ok) {
          return await this.unwrap<T>(response);
        }

        const body = await this.readBody(response);
        const error = errorFromResponse(response.status, body, response.headers);

        if (retryable && attempt < this.maxRetries && shouldRetry(response.status)) {
          await this.backoff(attempt, response.headers.get('retry-after'), options.signal);
          lastError = error;
          continue;
        }

        throw error;
      } catch (cause) {
        // Anything the SDK has already classified — including the response-derived error thrown
        // just above, which has been through the retry decision — passes straight through. Without
        // this, a typed 422 would be caught by our own handler and re-reported as a network
        // failure, which is both wrong and unretryable-looking.
        if (cause instanceof BitnormousError) {
          throw cause;
        }

        if (cause instanceof Error && cause.name !== 'AbortError' && isTransportFailure(cause)) {
          const error = this.asConnectionError(cause, options.signal);

          if (retryable && attempt < this.maxRetries) {
            await this.backoff(attempt, null, options.signal);
            lastError = error;
            continue;
          }

          throw error;
        }

        if (cause instanceof Error && cause.name === 'AbortError') {
          throw this.asConnectionError(cause, options.signal);
        }

        throw cause;
      }
    }

    /* c8 ignore next -- the loop either returns or throws; this only guards a logic slip. */
    throw lastError ?? new BitnormousConnectionError('Bitnormous request failed.');
  }

  private async send(url: string, method: string, options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timeout = options.timeout ?? this.timeout;
    const timer = setTimeout(() => controller.abort(), timeout);

    // The caller's signal and our timeout both have to be able to abort the request.
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Bitnormous-Client': `bitnormous-business-sdk/${SDK_VERSION}`,
      ...this.headers,
      ...options.headers,
    };

    if (options.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    let payload: string | undefined;
    if (options.body !== undefined && method !== 'GET') {
      payload = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        signal: controller.signal,
        ...(payload !== undefined ? { body: payload } : {}),
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async unwrap<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    const body = (await this.readBody(response)) as Envelope<T> | T;

    if (body && typeof body === 'object' && 'data' in (body as Envelope<T>)) {
      return (body as Envelope<T>).data as T;
    }

    return body as T;
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text === '') {
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      // A gateway timeout page, an HTML error, a truncated body: keep it for the error's `raw`.
      return { message: text.slice(0, 500) };
    }
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.baseUrl}${API_PREFIX}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  /** Exponential backoff with full jitter, and `Retry-After` honoured when the server sent one. */
  private async backoff(attempt: number, retryAfter: string | null, signal?: AbortSignal): Promise<void> {
    const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;

    const delay = Number.isFinite(seconds)
      ? Math.min(seconds * 1000, this.maxBackoffMs)
      : // Full jitter: spread retries across the window instead of stacking a thundering herd
        // onto the same millisecond after a blip.
        Math.random() * Math.min(this.backoffMs * 2 ** attempt, this.maxBackoffMs);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new BitnormousConnectionError('The request was aborted.'));
        },
        { once: true },
      );
    });
  }

  private asConnectionError(cause: Error, signal?: AbortSignal): BitnormousConnectionError {
    const aborted = signal?.aborted === true;

    return new BitnormousConnectionError(
      aborted
        ? 'The request was aborted.'
        : cause.name === 'AbortError'
          ? `The request timed out after ${this.timeout}ms.`
          : `Could not reach Bitnormous: ${cause.message}`,
      { cause },
    );
  }
}

/**
 * Whether a failed response is worth trying again.
 *
 * `429` and `5xx` are transient by definition. `408` is a server-side read timeout. Everything
 * else is a decision the server has already made, and repeating it will simply get the same
 * answer more expensively.
 */
export function shouldRetry(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * A thrown error that means "the exchange never completed", as opposed to a bad answer.
 *
 * Runtimes disagree on how they report a dead socket — `TypeError: fetch failed` on Node and
 * browsers, `FetchError` on older polyfills, an `errno`-style `code` on some agents — so this
 * matches the shapes rather than any one of them. SDK errors never reach it: `request()` rethrows
 * those before this is consulted.
 */
function isTransportFailure(error: Error): boolean {
  return (
    error.name === 'AbortError' ||
    error.name === 'TypeError' ||
    error.name === 'FetchError' ||
    'errno' in error ||
    'code' in error
  );
}
