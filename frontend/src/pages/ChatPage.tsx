import { useEffect } from "react";
import { PlusIcon, MessageSquareIcon, BrainCircuitIcon, Trash2Icon } from "lucide-react";
import { useChatStore } from "../store/chat";
import { MessageList } from "../components/MessageList";
import { MessageInput } from "../components/MessageInput";

interface Props {
  kbId: string | null;
}

export function ChatPage({ kbId }: Props) {
  const {
    sessions,
    currentSessionId,
    messages,
    isLoading,
    loadSessions,
    createSession,
    selectSession,
    deleteSession,
    setCurrentKb,
  } = useChatStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    setCurrentKb(kbId);
  }, [kbId, setCurrentKb]);

  const formatTime = (iso: string) => {
    const d = new Date(iso.replace(" ", "T") + "Z");
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return d.toLocaleDateString("zh-CN");
  };

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Session list */}
      <div className="w-56 border-r border-stone-200 bg-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-stone-200">
          <button
            onClick={() => createSession()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <PlusIcon size={15} />
            新建对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-xs text-stone-400 text-center py-6">暂无对话</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => selectSession(s.id)}
              className={`group flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                currentSessionId === s.id
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"
              }`}
            >
              <MessageSquareIcon size={13} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{s.title || "未命名对话"}</p>
                <p className="text-xs text-stone-400 mt-0.5">{formatTime(s.updatedAt)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-stone-400 hover:text-red-500 transition-all shrink-0 mt-0.5"
              >
                <Trash2Icon size={12} />
              </button>
            </div>
          ))}
        </div>
        {kbId && (
          <div className="px-3 py-2 border-t border-stone-200 bg-emerald-50">
            <p className="text-xs text-emerald-600 text-center">已关联知识库</p>
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="h-12 border-b border-stone-200 flex items-center px-5 gap-3 shrink-0">
          <BrainCircuitIcon size={17} className="text-emerald-500" />
          <span className="text-sm font-semibold text-stone-800 truncate">
            {currentSession?.title || (currentSessionId ? "对话" : "DeepAnalyze 深度分析")}
          </span>
          {currentSessionId && (
            <span className="text-xs text-stone-400 font-mono ml-auto">
              {currentSessionId.slice(0, 8)}
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">加载中...</div>
        ) : (
          <MessageList messages={messages} />
        )}
        <MessageInput />
      </div>
    </div>
  );
}
