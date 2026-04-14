/**
 * API Test Client — bypasses system proxy for localhost requests.
 *
 * Usage:
 *   const api = new ApiClient('http://localhost:21000');
 *   const health = await api.get('/api/health');
 */

export class ApiClient {
  constructor(private baseUrl: string) {}

  // ── Core helpers ──────────────────────────────────────────────────────

  private async request(
    path: string,
    options: RequestInit = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      // @ts-expect-error Bun fetch supports proxy bypass
      proxy: '',
    } as RequestInit);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  }

  async get(path: string) {
    return this.request(path);
  }

  async post(path: string, body?: unknown) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch(path: string, body?: unknown) {
    return this.request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put(path: string, body?: unknown) {
    return this.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async del(path: string) {
    return this.request(path, { method: 'DELETE' });
  }

  /** Upload a file via multipart/form-data */
  async upload(path: string, file: { name: string; content: string | Buffer }) {
    const formData = new FormData();
    formData.append('file', new Blob([file.content]), file.name);
    return this.request(path, {
      method: 'POST',
      body: formData,
    });
  }

  /** Read SSE stream, collect all events */
  async sse(
    path: string,
    body: unknown,
    timeout = 30_000,
  ): Promise<{ events: Array<Record<string, unknown>>; status: number }> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // @ts-expect-error Bun fetch proxy bypass
      proxy: '',
    } as RequestInit);

    if (!res.ok || !res.body) {
      return { events: [], status: res.status };
    }

    const events: Array<Record<string, unknown>> = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    const timer = setTimeout(() => {
      reader.cancel();
      done = true;
    }, timeout);

    try {
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              events.push(data);
              if (data.type === 'done' || data.type === 'error') {
                done = true;
                break;
              }
            } catch {
              // skip malformed
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      reader.cancel();
    }

    return { events, status: res.status };
  }
}
