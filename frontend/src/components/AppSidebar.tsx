import { MessageSquareIcon, DatabaseIcon, FileTextIcon, ListTodoIcon, SettingsIcon, BrainCircuitIcon, PuzzleIcon, ClockIcon, GitBranchIcon } from "lucide-react";
import { type NavState, type NavPage } from "../App";

interface Props {
  nav: NavState;
  onNavigate: (nav: NavState) => void;
}

const NAV_ITEMS: { page: NavPage; icon: React.ReactNode; label: string }[] = [
  { page: "chat", icon: <MessageSquareIcon size={18} />, label: "对话分析" },
  { page: "kb", icon: <DatabaseIcon size={18} />, label: "知识库" },
  { page: "reports", icon: <FileTextIcon size={18} />, label: "分析报告" },
  { page: "timeline", icon: <ClockIcon size={18} />, label: "时间线" },
  { page: "graph", icon: <GitBranchIcon size={18} />, label: "关系图谱" },
  { page: "tasks", icon: <ListTodoIcon size={18} />, label: "任务面板" },
  { page: "plugins", icon: <PuzzleIcon size={18} />, label: "插件管理" },
  { page: "settings", icon: <SettingsIcon size={18} />, label: "设置" },
];

export function AppSidebar({ nav, onNavigate }: Props) {
  return (
    <div className="w-56 bg-[#faf7f2] flex flex-col shrink-0 border-r border-stone-200/60">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
          <BrainCircuitIcon size={18} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-stone-800 leading-tight">DeepAnalyze</p>
          <p className="text-[11px] text-stone-400 leading-tight">深度分析系统</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {NAV_ITEMS.map(({ page, icon, label }) => (
          <button
            key={page}
            onClick={() => onNavigate({ page, kbId: nav.kbId })}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all ${
              nav.page === page
                ? "bg-white text-emerald-700 shadow-sm border border-stone-200/60"
                : "text-stone-500 hover:text-stone-800 hover:bg-white/50"
            }`}
          >
            <span className={nav.page === page ? "text-emerald-600" : "text-stone-400"}>{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {/* Version */}
      <div className="px-5 py-4 border-t border-stone-200/60">
        <p className="text-[11px] text-stone-400">v0.1.0</p>
      </div>
    </div>
  );
}
