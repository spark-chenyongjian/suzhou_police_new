import { useState, useEffect } from "react";
import { SettingsIcon, SaveIcon, ServerIcon, DatabaseIcon, PuzzleIcon, Loader2Icon, CheckCircle2Icon } from "lucide-react";

interface ModelConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

export function SettingsPage() {
  const [mainModel, setMainModel] = useState<ModelConfig>({
    endpoint: "http://localhost:11434/v1",
    model: "deepseek-r1:7b",
    maxTokens: 32768,
  });
  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    // In a real implementation, this would POST to /api/settings
    await new Promise((r) => setTimeout(r, 500));
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-2 mb-6">
          <SettingsIcon size={20} className="text-gray-400" />
          <h1 className="text-lg font-semibold text-white">系统设置</h1>
        </div>

        {/* System Status */}
        <Card title="系统状态" icon={<ServerIcon size={16} className="text-green-400" />}>
          {health ? (
            <div className="space-y-1 text-sm">
              <Row label="状态" value={<span className="text-green-400">{health.status}</span>} />
              <Row label="版本" value="0.1.0" />
              <Row label="最后更新" value={new Date(health.timestamp).toLocaleString("zh-CN")} />
            </div>
          ) : (
            <p className="text-sm text-gray-500">加载中...</p>
          )}
        </Card>

        {/* Model Config */}
        <Card title="模型配置" icon={<DatabaseIcon size={16} className="text-blue-400" />}>
          <div className="space-y-3">
            <FormField
              label="API 端点"
              value={mainModel.endpoint}
              onChange={(v) => setMainModel((m) => ({ ...m, endpoint: v }))}
              placeholder="http://localhost:11434/v1"
              hint="支持 Ollama、vLLM、LM Studio 或任何 OpenAI 兼容服务"
            />
            <FormField
              label="模型名称"
              value={mainModel.model}
              onChange={(v) => setMainModel((m) => ({ ...m, model: v }))}
              placeholder="deepseek-r1:7b"
            />
            <FormField
              label="API Key"
              value={mainModel.apiKey || ""}
              onChange={(v) => setMainModel((m) => ({ ...m, apiKey: v }))}
              placeholder="（本地模型可留空）"
              type="password"
            />
            <FormField
              label="最大 Token 数"
              value={String(mainModel.maxTokens || 32768)}
              onChange={(v) => setMainModel((m) => ({ ...m, maxTokens: parseInt(v) || 32768 }))}
              placeholder="32768"
            />
            <p className="text-xs text-gray-500 mt-1">
              修改后需要重启服务或编辑 <code className="bg-gray-800 px-1 rounded">config/model-config.yaml</code>
            </p>
          </div>
        </Card>

        {/* Plugin Status */}
        <Card title="已加载 Plugin/Skill" icon={<PuzzleIcon size={16} className="text-purple-400" />}>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg">
              <CheckCircle2Icon size={13} className="text-green-400" />
              <span className="text-gray-300">judicial-evidence</span>
              <span className="text-xs text-gray-500 ml-auto">v1.0 · 司法证据分析</span>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              在 <code className="bg-gray-800 px-1 rounded">plugins/</code> 目录添加 plugin.yaml 文件即可扩展场景
            </p>
          </div>
        </Card>

        {/* Data Dir Info */}
        <Card title="数据存储" icon={<DatabaseIcon size={16} className="text-yellow-400" />}>
          <div className="space-y-1 text-sm">
            <Row label="数据库" value="data/deepanalyze.db" />
            <Row label="Wiki 文件" value="data/wiki/" />
            <Row label="报告" value="data/wiki/{kbId}/reports/" />
          </div>
        </Card>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
        >
          {isSaving ? (
            <Loader2Icon size={15} className="animate-spin" />
          ) : saved ? (
            <CheckCircle2Icon size={15} />
          ) : (
            <SaveIcon size={15} />
          )}
          {saved ? "已保存" : "保存设置"}
        </button>
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-mono text-xs">{value}</span>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text", hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500 transition-colors"
      />
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}
