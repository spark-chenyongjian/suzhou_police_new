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
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const disabled = !currentSessionId || isStreaming;

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      <div className="flex items-end gap-2 bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 focus-within:border-blue-400 focus-within:bg-white transition-colors">
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
          className="flex-1 bg-transparent text-gray-800 text-sm resize-none outline-none placeholder-gray-400 min-h-[24px] max-h-[200px] leading-relaxed"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {isStreaming ? (
            <Loader2Icon size={15} className="animate-spin" />
          ) : (
            <SendHorizontalIcon size={15} />
          )}
        </button>
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">
        DeepAnalyze — Agent 驱动的深度文档分析系统
      </p>
    </div>
  );
}
