import { MessageSquareIcon, DatabaseIcon, FileTextIcon, ListTodoIcon, SettingsIcon, BrainCircuitIcon } from "lucide-react";
import { type NavState, type NavPage } from "../App";

interface Props {
  nav: NavState;
  onNavigate: (nav: NavState) => void;
}

const NAV_ITEMS: { page: NavPage; icon: React.ReactNode; label: string }[] = [
  { page: "chat", icon: <MessageSquareIcon size={20} />, label: "对话分析" },
  { page: "kb", icon: <DatabaseIcon size={20} />, label: "知识库" },
  { page: "reports", icon: <FileTextIcon size={20} />, label: "分析报告" },
  { page: "tasks", icon: <ListTodoIcon size={20} />, label: "任务面板" },
  { page: "settings", icon: <SettingsIcon size={20} />, label: "设置" },
];

export function AppSidebar({ nav, onNavigate }: Props) {
  return (
    <div className="w-48 bg-slate-900 flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 flex items-center gap-3 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <BrainCircuitIcon size={16} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-tight">DeepAnalyze</p>
          <p className="text-xs text-slate-500 leading-tight">深度分析系统</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-1">
        {NAV_ITEMS.map(({ page, icon, label }) => (
          <button
            key={page}
            onClick={() => onNavigate({ page, kbId: nav.kbId })}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
              nav.page === page
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            <span className={nav.page === page ? "text-white" : "text-slate-500"}>{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {/* Version */}
      <div className="px-4 py-3 border-t border-slate-800">
        <p className="text-xs text-slate-600">v0.1.0</p>
      </div>
    </div>
  );
}
