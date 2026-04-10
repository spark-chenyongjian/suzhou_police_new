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

export interface SheetInfo {
  id: string;
  docId: string;
  sheetName: string;
  sheetIndex: number;
  rowCount: number;
  colCount: number;
  headerRow: string[];
  schemaJson: Record<string, string>;
  createdAt: string;
}

export interface ColumnMeta {
  colName: string;
  colIndex: number;
  detectedType: string;
  nullCount: number;
  distinctCount: number;
  minValue: string | null;
  maxValue: string | null;
  avgValue: string | null;
  sampleValues: string[];
}

export interface DataQueryResult {
  sheetId: string;
  sheetName: string;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

export const api = {
  listSessions: () => request<SessionInfo[]>("/api/sessions"),
  createSession: (title?: string) =>
    request<SessionInfo>("/api/sessions", { method: "POST", body: JSON.stringify({ title }) }),
  deleteSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}`, { method: "DELETE" }),
  getMessages: (sessionId: string) =>
    request<MessageInfo[]>(`/api/sessions/${sessionId}/messages`),

  listKbs: () => request<KbInfo[]>("/api/kb"),
  createKb: (name: string, description?: string) =>
    request<KbInfo>("/api/kb", { method: "POST", body: JSON.stringify({ name, description }) }),
  renameKb: (kbId: string, name: string) =>
    request<KbInfo>(`/api/kb/${kbId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteKb: (kbId: string) =>
    request<{ ok: boolean }>(`/api/kb/${kbId}`, { method: "DELETE" }),
  listDocuments: (kbId: string) => request<DocInfo[]>(`/api/kb/${kbId}/documents`),
  deleteDocument: (kbId: string, docId: string) =>
    request<{ ok: boolean }>(`/api/kb/${kbId}/documents/${docId}`, { method: "DELETE" }),
  retryDocument: (kbId: string, docId: string) =>
    request<{ ok: boolean }>(`/api/kb/${kbId}/documents/${docId}/retry`, { method: "POST" }),
  listWikiPages: (kbId: string) =>
    request<{ id: string; title: string; pageType: string; docId: string | null; tokenCount: number | null; createdAt: string }[]>(`/api/kb/${kbId}/wiki/pages`),
  getWikiPageContent: (kbId: string, pageId: string) =>
    fetch(`${BASE_URL}/api/kb/${kbId}/wiki/pages/${pageId}/content`).then((r) => r.text()),
  listReports: (kbId: string) =>
    request<{ id: string; title: string; tokenCount: number | null; createdAt: string; updatedAt: string }[]>(`/api/kb/${kbId}/reports`),
  getReportContent: (kbId: string, reportId: string) =>
    fetch(`${BASE_URL}/api/kb/${kbId}/reports/${reportId}/content`).then((r) => r.text()),
  updateReport: (kbId: string, reportId: string, content: string) =>
    request<{ ok: boolean }>(`/api/kb/${kbId}/reports/${reportId}`, { method: "PUT", body: JSON.stringify({ content }) }),
  deleteReport: (kbId: string, reportId: string) =>
    request<{ ok: boolean }>(`/api/kb/${kbId}/reports/${reportId}`, { method: "DELETE" }),

  // XLSX data tables
  listXlsxSheets: (kbId: string) =>
    request<SheetInfo[]>(`/api/kb/${kbId}/xlsx/sheets`),
  getXlsxSheet: (kbId: string, sheetId: string) =>
    request<SheetInfo & { columns: ColumnMeta[] }>(`/api/kb/${kbId}/xlsx/sheets/${sheetId}`),
  queryXlsx: (kbId: string, body: { sheetId: string; select?: string[]; where?: string; orderBy?: string; limit?: number; offset?: number }) =>
    request<DataQueryResult>(`/api/kb/${kbId}/xlsx/query`, { method: "POST", body: JSON.stringify(body) }),

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
