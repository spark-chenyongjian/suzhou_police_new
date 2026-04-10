import { useEffect, useState } from "react";
import { PuzzleIcon, CheckCircle2Icon, BotIcon, FileTextIcon, Loader2Icon } from "lucide-react";

interface PluginInfo {
  name: string;
  version: string;
  description: string;
  agents: string[];
  reportTemplates: string[];
  enabled: boolean;
}

const BASE_URL = import.meta.env.PROD ? "" : "http://localhost:21000";

export function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`${BASE_URL}/api/plugins`)
      .then((r) => r.json())
      .then((data: PluginInfo[]) => setPlugins(data))
      .catch(() => setPlugins([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggle = async (name: string) => {
    await fetch(`${BASE_URL}/api/plugins/${name}/toggle`, { method: "PATCH" });
    load();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="h-12 border-b border-gray-200 flex items-center px-5 gap-3 shrink-0">
        <PuzzleIcon size={17} className="text-purple-500" />
        <span className="text-sm font-semibold text-gray-800">插件管理</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-2xl mx-auto space-y-4">
          <p className="text-xs text-gray-500">
            在{" "}
            <code className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">
              plugins/
            </code>{" "}
            目录下添加{" "}
            <code className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">
              plugin.yaml
            </code>{" "}
            文件即可扩展场景能力
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2Icon size={16} className="animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : plugins.length === 0 ? (
            <div className="text-center py-16">
              <PuzzleIcon size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">暂无插件</p>
              <p className="text-xs text-gray-400 mt-1">启动时自动扫描 plugins/ 目录</p>
            </div>
          ) : (
            plugins.map((p) => (
              <div
                key={p.name}
                className={`bg-white border rounded-xl p-5 transition-colors ${
                  p.enabled ? "border-gray-200" : "border-gray-100 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      p.enabled ? "bg-purple-50" : "bg-gray-100"
                    }`}>
                      <PuzzleIcon size={18} className={p.enabled ? "text-purple-500" : "text-gray-400"} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">{p.name}</h3>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          v{p.version}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(p.name)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${
                      p.enabled
                        ? "text-green-600 bg-green-50 hover:bg-green-100"
                        : "text-gray-500 bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    <CheckCircle2Icon size={13} />
                    {p.enabled ? "已启用" : "已停用"}
                  </button>
                </div>

                {(p.agents.length > 0 || p.reportTemplates.length > 0) && (
                  <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
                    {p.agents.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
                          <BotIcon size={11} /> Agent ({p.agents.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.agents.map((agent) => (
                            <span
                              key={agent}
                              className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-md"
                            >
                              {agent}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {p.reportTemplates.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
                          <FileTextIcon size={11} /> 报告模板 ({p.reportTemplates.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.reportTemplates.map((tpl) => (
                            <span
                              key={tpl}
                              className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-md"
                            >
                              {tpl}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
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
