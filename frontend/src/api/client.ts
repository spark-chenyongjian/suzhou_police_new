const BASE_URL = import.meta.env.PROD ? "" : "http://localhost:21000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status} ${resp.statusText}`);
  return resp.json();
}

export interface SessionInfo {
  id: string;
  title: string | null;
  kbScope: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageInfo {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  createdAt: string;
}

export interface KbInfo {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface DocInfo {
  id: string;
  kbId: string;
  filename: string;
  status: string;
  fileSize: number | null;
  createdAt: string;
}

export const api = {
  listSessions: () => request<SessionInfo[]>("/api/sessions"),
  createSession: (title?: string) =>
    request<SessionInfo>("/api/sessions", { method: "POST", body: JSON.stringify({ title }) }),
  getMessages: (sessionId: string) =>
    request<MessageInfo[]>(`/api/sessions/${sessionId}/messages`),

  listKbs: () => request<KbInfo[]>("/api/kb"),
  createKb: (name: string, description?: string) =>
    request<KbInfo>("/api/kb", { method: "POST", body: JSON.stringify({ name, description }) }),
  listDocuments: (kbId: string) => request<DocInfo[]>(`/api/kb/${kbId}/documents`),
  uploadDocument: (kbId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE_URL}/api/kb/${kbId}/documents/upload`, { method: "POST", body: form })
      .then((r) => r.json() as Promise<DocInfo>);
  },
  searchKb: (kbId: string, query: string, levels?: string[]) =>
    request<{ hits: unknown[]; total: number }>(`/api/search/${kbId}`, {
      method: "POST",
      body: JSON.stringify({ query, levels }),
    }),
};

// SSE streaming with event dispatch
export function streamChat(
  sessionId: string,
  content: string,
  kbId: string | undefined,
  onEvent: (event: Record<string, unknown>) => void,
  onDone: () => void,
  onError: (err: string) => void,
): () => void {
  const controller = new AbortController();

  fetch(`${BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, content, kbId }),
    signal: controller.signal,
  }).then(async (resp) => {
    if (!resp.ok) { onError(`HTTP ${resp.status}`); return; }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (data.type === "done") { onDone(); return; }
          else if (data.type === "error") { onError(data.error as string); return; }
          else onEvent(data);
        } catch { /* skip malformed */ }
      }
    }
    onDone();
  }).catch((err) => {
    if (err.name !== "AbortError") onError(String(err));
  });

  return () => controller.abort();
}
