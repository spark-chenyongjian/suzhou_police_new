import { useEffect } from "react";
import { PlusIcon, MessageSquareIcon, BrainCircuitIcon } from "lucide-react";
import { useChatStore } from "../store/chat";

export function Sidebar() {
  const { sessions, currentSessionId, loadSessions, createSession, selectSession } = useChatStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const formatTime = (iso: string) => {
    const d = new Date(iso.replace(" ", "T") + "Z");
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return d.toLocaleDateString("zh-CN");
  };

  return (
    <div className="w-64 bg-gray-900 flex flex-col border-r border-gray-800 shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 flex items-center gap-2 border-b border-gray-800">
        <BrainCircuitIcon size={20} className="text-blue-400" />
        <span className="font-semibold text-white text-sm">DeepAnalyze</span>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={() => createSession()}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <PlusIcon size={16} />
          新建对话
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {sessions.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-8">暂无对话记录</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => selectSession(s.id)}
            className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-lg text-left transition-colors group ${
              currentSessionId === s.id
                ? "bg-blue-600/20 text-blue-300 border border-blue-600/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
          >
            <MessageSquareIcon size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">
                {s.title || "未命名对话"}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{formatTime(s.updatedAt)}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-800">
        <p className="text-xs text-gray-600 text-center">v0.1.0</p>
      </div>
    </div>
  );
}
