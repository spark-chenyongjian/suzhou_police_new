import { useState, useEffect } from "react";
import {
  SaveIcon,
  ServerIcon,
  BrainCircuitIcon,
  PuzzleIcon,
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
  HardDriveIcon,
  CircleCheckBigIcon,
} from "lucide-react";

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
  const [saveResult, setSaveResult] = useState<"ok" | "error" | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});

    fetch("/api/settings/model")
      .then((r) => r.json())
      .then((cfg: ModelConfig) => {
        if (cfg.endpoint) setMainModel(cfg);
      })
      .catch(() => {})
      .finally(() => setIsLoadingConfig(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveResult(null);
    try {
      const resp = await fetch("/api/settings/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mainModel),
      });
      setSaveResult(resp.ok ? "ok" : "error");
    } catch {
      setSaveResult("error");
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveResult(null), 3000);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-stone-50">
      {/* Header */}
      <div className="h-14 border-b border-stone-200 bg-white flex items-center px-6 shrink-0">
        <h1 className="text-base font-semibold text-stone-900">系统设置</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto py-8 px-6 space-y-5">

          {/* System Status */}
          <Section
            icon={<ServerIcon size={17} className="text-emerald-500" />}
            title="系统状态"
            badge={health ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                运行中
              </span>
            ) : null}
          >
            {health ? (
              <div className="grid grid-cols-3 gap-4">
                <Stat label="版本" value="0.1.0" />
                <Stat label="状态" value={health.status} />
                <Stat label="最后更新" value={new Date(health.timestamp).toLocaleTimeString("zh-CN")} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-stone-400">
                <Loader2Icon size={14} className="animate-spin" />
                连接中...
              </div>
            )}
          </Section>

          {/* Model Config */}
          <Section
            icon={<BrainCircuitIcon size={17} className="text-emerald-500" />}
            title="大模型配置"
            hint="保存后立即生效，无需重启"
          >
            {isLoadingConfig ? (
              <div className="flex items-center gap-2 text-sm text-stone-400 py-2">
                <Loader2Icon size={14} className="animate-spin" />
                加载配置...
              </div>
            ) : (
              <div className="space-y-4">
                <Field
                  label="API 端点"
                  value={mainModel.endpoint}
                  onChange={(v) => setMainModel((m) => ({ ...m, endpoint: v }))}
                  placeholder="https://api.openai.com/v1"
                  hint="支持 OpenAI、DashScope、Ollama 等兼容接口"
                />
                <Field
                  label="模型名称"
                  value={mainModel.model}
                  onChange={(v) => setMainModel((m) => ({ ...m, model: v }))}
                  placeholder="gpt-4o"
                />
                <Field
                  label="API Key"
                  value={mainModel.apiKey || ""}
                  onChange={(v) => setMainModel((m) => ({ ...m, apiKey: v }))}
                  placeholder="sk-..."
                  type="password"
                />
                <Field
                  label="最大 Token 数"
                  value={String(mainModel.maxTokens || 32768)}
                  onChange={(v) => setMainModel((m) => ({ ...m, maxTokens: parseInt(v) || 32768 }))}
                  placeholder="32768"
                />

                <div className="pt-1">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                      saveResult === "ok"
                        ? "bg-emerald-500 text-white"
                        : saveResult === "error"
                        ? "bg-red-500 text-white"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    } disabled:opacity-60`}
                  >
                    {isSaving ? (
                      <Loader2Icon size={15} className="animate-spin" />
                    ) : saveResult === "ok" ? (
                      <CheckCircle2Icon size={15} />
                    ) : saveResult === "error" ? (
                      <AlertCircleIcon size={15} />
                    ) : (
                      <SaveIcon size={15} />
                    )}
                    {saveResult === "ok" ? "已保存" : saveResult === "error" ? "保存失败" : "保存配置"}
                  </button>
                </div>
              </div>
            )}
          </Section>

          {/* Plugins */}
          <Section
            icon={<PuzzleIcon size={17} className="text-violet-500" />}
            title="已加载插件"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg">
                <CircleCheckBigIcon size={15} className="text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">judicial-evidence</p>
                  <p className="text-xs text-stone-500">司法证据分析插件</p>
                </div>
                <span className="text-xs text-stone-400 bg-white border border-stone-200 px-2 py-0.5 rounded-full">v1.0</span>
              </div>
              <p className="text-xs text-stone-400 mt-1">
                在 <code className="bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">plugins/</code> 目录添加{" "}
                <code className="bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">plugin.yaml</code> 即可扩展场景
              </p>
            </div>
          </Section>

          {/* Data Storage */}
          <Section
            icon={<HardDriveIcon size={17} className="text-amber-500" />}
            title="数据存储"
          >
            <div className="space-y-2">
              <StorageRow label="数据库" path="data/deepanalyze.db" />
              <StorageRow label="Wiki 文件" path="data/wiki/" />
              <StorageRow label="原始文档" path="data/wiki/{kbId}/originals/" />
              <StorageRow label="分析报告" path="data/wiki/{kbId}/reports/" />
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-stone-100">
        {icon}
        <h2 className="text-sm font-semibold text-stone-800 flex-1">{title}</h2>
        {hint && <span className="text-xs text-stone-400">{hint}</span>}
        {badge}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-stone-50 rounded-lg px-3 py-2.5">
      <p className="text-xs text-stone-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-stone-800">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder-stone-300 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
      />
      {hint && <p className="text-xs text-stone-400 mt-1">{hint}</p>}
    </div>
  );
}

function StorageRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-stone-500">{label}</span>
      <code className="text-xs text-stone-600 bg-stone-50 border border-stone-200 px-2 py-1 rounded">{path}</code>
    </div>
  );
}
