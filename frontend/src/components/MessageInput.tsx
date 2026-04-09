import { useState, useRef } from "react";
import { SendHorizontalIcon, Loader2Icon } from "lucide-react";
import { useChatStore } from "../store/chat";

export function MessageInput() {
  const [text, setText] = useState("");
  const { sendMessage, isStreaming, currentSessionId } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || !currentSessionId) return;
    sendMessage(trimmed);
    setText("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const disabled = !currentSessionId || isStreaming;

  return (
    <div className="border-t border-gray-800 bg-gray-900 px-4 py-3">
      <div className="flex items-end gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-blue-500 transition-colors">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={
            !currentSessionId
              ? "请先创建或选择一个对话..."
              : isStreaming
              ? "AI 正在思考..."
              : "输入消息，Enter 发送，Shift+Enter 换行"
          }
          rows={1}
          className="flex-1 bg-transparent text-gray-100 text-sm resize-none outline-none placeholder-gray-500 min-h-[24px] max-h-[200px] leading-relaxed"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {isStreaming ? (
            <Loader2Icon size={15} className="animate-spin" />
          ) : (
            <SendHorizontalIcon size={15} />
          )}
        </button>
      </div>
      <p className="text-xs text-gray-600 text-center mt-2">
        DeepAnalyze — Agent 驱动的深度文档分析系统
      </p>
    </div>
  );
}
