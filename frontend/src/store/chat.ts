import { create } from "zustand";
import { api, streamChat, type SessionInfo, type MessageInfo } from "../api/client";

export interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  toolCalls?: Array<{ name: string; status: "running" | "done" }>;
}

interface ChatState {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  currentKbId: string | null;
  messages: LocalMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;

  loadSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setCurrentKb: (kbId: string | null) => void;
  sendMessage: (content: string) => void;
  appendStreamChunk: (text: string) => void;
  handleStreamEvent: (event: Record<string, unknown>) => void;
  finalizeStreaming: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  currentKbId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",

  loadSessions: async () => {
    try {
      const sessions = await api.listSessions();
      set({ sessions });
    } catch (e) {
      console.error("Failed to load sessions", e);
    }
  },

  createSession: async (title) => {
    const session = await api.createSession(title || "新对话");
    set((s) => ({
      sessions: [session, ...s.sessions],
      currentSessionId: session.id,
      messages: [],
    }));
  },

  selectSession: async (id) => {
    set({ currentSessionId: id, isLoading: true, messages: [] });
    const msgs = await api.getMessages(id);
    const mapped: LocalMessage[] = msgs
      .filter((m): m is MessageInfo & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant"
      )
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content || "",
      }));
    set({ messages: mapped, isLoading: false });
  },

  deleteSession: async (id) => {
    await api.deleteSession(id);
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      ...(s.currentSessionId === id ? { currentSessionId: null, messages: [] } : {}),
    }));
  },

  setCurrentKb: (kbId) => set({ currentKbId: kbId }),

  sendMessage: (content: string) => {
    const { currentSessionId, currentKbId } = get();
    if (!currentSessionId || get().isStreaming) return;

    const userMsg: LocalMessage = { id: Date.now().toString(), role: "user", content };
    const assistantMsg: LocalMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
      streaming: true,
      toolCalls: [],
    };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      isStreaming: true,
      streamingContent: "",
    }));

    streamChat(
      currentSessionId,
      content,
      currentKbId || undefined,
      (event) => get().handleStreamEvent(event),
      () => get().finalizeStreaming(),
      (err) => {
        console.error("Stream error:", err);
        set((s) => ({
          messages: s.messages.map((m) =>
            m.streaming ? { ...m, content: `[错误] ${err}`, streaming: false } : m
          ),
          isStreaming: false,
        }));
      },
    );
  },

  appendStreamChunk: (text: string) => {
    set((s) => {
      const newContent = s.streamingContent + text;
      return {
        streamingContent: newContent,
        messages: s.messages.map((m) =>
          m.streaming ? { ...m, content: newContent } : m
        ),
      };
    });
  },

  handleStreamEvent: (event: Record<string, unknown>) => {
    if (event.type === "text") {
      get().appendStreamChunk(event.content as string);
    } else if (event.type === "tool_call") {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.streaming
            ? {
                ...m,
                toolCalls: [
                  ...(m.toolCalls || []),
                  { name: event.name as string, status: "running" as const },
                ],
              }
            : m
        ),
      }));
    } else if (event.type === "tool_result") {
      // Mark the first "running" tool with this name as done
      set((s) => ({
        messages: s.messages.map((m) => {
          if (!m.streaming) return m;
          let marked = false;
          const toolCalls = (m.toolCalls || []).map((tc) => {
            if (!marked && tc.name === event.name && tc.status === "running") {
              marked = true;
              return { ...tc, status: "done" as const };
            }
            return tc;
          });
          return { ...m, toolCalls };
        }),
      }));
    }
  },

  finalizeStreaming: () => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.streaming ? { ...m, streaming: false } : m
      ),
      isStreaming: false,
      streamingContent: "",
    }));
    get().loadSessions();
  },
}));
