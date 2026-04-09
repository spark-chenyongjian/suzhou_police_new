import { useChatStore } from "../store/chat";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { BrainCircuitIcon } from "lucide-react";

export function ChatWindow() {
  const { messages, currentSessionId, sessions, isLoading } = useChatStore();

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="h-12 border-b border-gray-800 bg-gray-900 flex items-center px-4 gap-3 shrink-0">
        <BrainCircuitIcon size={18} className="text-blue-400" />
        <h1 className="text-sm font-medium text-gray-200 truncate">
          {currentSession?.title || "DeepAnalyze"}
        </h1>
        {currentSessionId && (
          <span className="text-xs text-gray-500 font-mono ml-auto truncate">
            {currentSessionId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Messages */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 text-sm">加载中...</div>
        </div>
      ) : (
        <MessageList messages={messages} />
      )}

      {/* Input */}
      <MessageInput />
    </div>
  );
}
