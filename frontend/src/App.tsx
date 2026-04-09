import { useState } from "react";
import { BrainCircuitIcon, MessageSquareIcon, DatabaseIcon, SettingsIcon } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { KnowledgeBasePage } from "./pages/KnowledgeBasePage";

type Tab = "chat" | "kb";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Top nav */}
      <div className="h-10 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <BrainCircuitIcon size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-white">DeepAnalyze</span>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <TabButton active={activeTab === "chat"} onClick={() => setActiveTab("chat")} icon={<MessageSquareIcon size={14} />} label="对话" />
          <TabButton active={activeTab === "kb"} onClick={() => setActiveTab("kb")} icon={<DatabaseIcon size={14} />} label="知识库" />
        </div>
        <div className="ml-auto">
          <button className="p-1.5 text-gray-500 hover:text-gray-300 rounded transition-colors">
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === "chat" ? (
          <>
            <Sidebar />
            <ChatWindow />
          </>
        ) : (
          <KnowledgeBasePage />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-colors ${
        active
          ? "bg-blue-600/20 text-blue-300 border border-blue-600/30"
          : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
