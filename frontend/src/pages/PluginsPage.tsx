import { useEffect, useState } from "react";
import { PuzzleIcon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";

interface PluginInfo {
  name: string;
  version: string;
  description: string;
  agents?: string[];
}

export function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(() => {
        // Placeholder: in a real impl fetch /api/plugins
        setPlugins([
          {
            name: "judicial-evidence",
            version: "1.0",
            description: "司法证据分析场景插件，适用于公检法案件卷宗分析",
            agents: ["evidence-search", "contradiction-check", "timeline-builder"],
          },
        ]);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-12 border-b border-gray-800 bg-gray-900 flex items-center px-5 gap-3 shrink-0">
        <PuzzleIcon size={17} className="text-purple-400" />
        <span className="text-sm font-semibold text-gray-200">插件管理</span>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <p className="text-xs text-gray-500">
            在 <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">plugins/</code> 目录下添加{" "}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">plugin.yaml</code> 文件即可扩展场景
          </p>

          {plugins.length === 0 ? (
            <div className="text-center py-16">
              <PuzzleIcon size={40} className="mx-auto text-gray-700 mb-3" />
              <p className="text-gray-500 text-sm">暂无插件</p>
            </div>
          ) : (
            plugins.map((p) => (
              <div key={p.name} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-600/20 flex items-center justify-center shrink-0">
                      <PuzzleIcon size={18} className="text-purple-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">{p.name}</h3>
                        <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">v{p.version}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{p.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-green-400 shrink-0">
                    <CheckCircle2Icon size={13} />
                    已启用
                  </div>
                </div>

                {p.agents && p.agents.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-800">
                    <p className="text-xs text-gray-500 mb-2">包含 Agent</p>
                    <div className="flex flex-wrap gap-2">
                      {p.agents.map((agent) => (
                        <span
                          key={agent}
                          className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-md"
                        >
                          {agent}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
