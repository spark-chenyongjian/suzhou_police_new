import { useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { ChatPage } from "./pages/ChatPage";
import { KnowledgeBasePage } from "./pages/KnowledgeBasePage";
import { ReportsPage } from "./pages/ReportsPage";
import { TasksPage } from "./pages/TasksPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PluginsPage } from "./pages/PluginsPage";
import { TimelinePage } from "./pages/TimelinePage";
import { GraphPage } from "./pages/GraphPage";

export type NavPage = "chat" | "kb" | "reports" | "timeline" | "graph" | "tasks" | "settings" | "plugins";

export interface NavState {
  page: NavPage;
  kbId: string | null;
}

export function App() {
  const [nav, setNav] = useState<NavState>({ page: "chat", kbId: null });

  return (
    <div className="h-screen flex bg-slate-950 text-white overflow-hidden">
      <AppSidebar nav={nav} onNavigate={setNav} />
      <main className="flex-1 flex overflow-hidden bg-gray-50 text-gray-900">
        {nav.page === "chat" && <ChatPage kbId={nav.kbId} />}
        {nav.page === "kb" && <KnowledgeBasePage kbId={nav.kbId} onKbChange={(id) => setNav({ page: "kb", kbId: id })} />}
        {nav.page === "reports" && <ReportsPage kbId={nav.kbId} />}
        {nav.page === "timeline" && <TimelinePage kbId={nav.kbId} />}
        {nav.page === "graph" && <GraphPage kbId={nav.kbId} />}
        {nav.page === "tasks" && <TasksPage kbId={nav.kbId} />}
        {nav.page === "settings" && <SettingsPage />}
        {nav.page === "plugins" && <PluginsPage />}
      </main>
    </div>
  );
}
