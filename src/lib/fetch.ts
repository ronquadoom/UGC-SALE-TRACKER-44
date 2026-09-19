/** Tiny fetch helper with sane defaults, timeouts and honest error typing. */

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with retries + backoff. Returns the parsed JSON or null for non-JSON.
 * Throws HttpError for 4xx/5xx after retries.
 */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<any> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 9500;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "application/json,text/plain,*/*",
          ...(init.headers || {}),
        },
      });
      // Roblox APIs sometimes reply 200 with an `errors` array.
      const text = await res.text();
      if (!res.ok) {
        lastErr = new HttpError(`HTTP ${res.status} ${url}`, res.status, text.slice(0, 400));
        if (attempt < retries) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    } catch (e: any) {
      lastErr = e;
      if (e?.name === "AbortError") {
        lastErr = new HttpError(`Timeout ${url}`, 0, "");
      }
      if (attempt < retries) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Fetch raw text (for HTML scraping). Returns "" on failure. */
export async function fetchText(
  url: string,
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<string> {
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 9000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) {
        if (attempt < retries) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        return "";
      }
      return await res.text();
    } catch {
      if (attempt < retries) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      return "";
    } finally {
      clearTimeout(timer);
    }
  }
  return "";
}
