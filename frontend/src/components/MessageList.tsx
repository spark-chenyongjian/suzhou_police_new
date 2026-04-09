import { useEffect, useRef } from "react";
import { BrainCircuitIcon, UserIcon, WrenchIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import type { LocalMessage } from "../store/chat";

interface Props {
  messages: LocalMessage[];
}

export function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <BrainCircuitIcon size={40} className="mx-auto mb-3 text-gray-700" />
          <p className="text-sm">开始一段深度分析对话</p>
          <p className="text-xs mt-1 text-gray-600">上传文档到知识库，或直接提问</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
        >
          {/* Avatar */}
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
              msg.role === "user"
                ? "bg-blue-600"
                : "bg-gray-800 border border-gray-700"
            }`}
          >
            {msg.role === "user" ? (
              <UserIcon size={14} className="text-white" />
            ) : (
              <BrainCircuitIcon size={14} className="text-blue-400" />
            )}
          </div>

          <div className="max-w-[75%] space-y-1">
            {/* Tool call indicators */}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {msg.toolCalls.map((tc, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                      tc.status === "done"
                        ? "border-green-700 bg-green-950 text-green-400"
                        : "border-yellow-700 bg-yellow-950 text-yellow-400"
                    }`}
                  >
                    {tc.status === "done" ? (
                      <CheckCircle2Icon size={10} />
                    ) : (
                      <Loader2Icon size={10} className="animate-spin" />
                    )}
                    {tc.name}
                  </span>
                ))}
              </div>
            )}

            {/* Message bubble */}
            <div
              className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-tr-sm"
                  : "bg-gray-800 text-gray-100 rounded-tl-sm border border-gray-700"
              }`}
            >
              {msg.content || (msg.streaming ? (
                <span className="flex gap-1 items-center h-5">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
                </span>
              ) : "")}
            </div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
