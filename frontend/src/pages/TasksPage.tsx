import { useState, useEffect } from "react";
import { ListTodoIcon, Loader2Icon, CheckCircle2Icon, AlertCircleIcon, ClockIcon, DatabaseIcon } from "lucide-react";
import { api, type KbInfo, type DocInfo } from "../api/client";

interface Props {
  kbId: string | null;
}

export function TasksPage({ kbId }: Props) {
  const [kbs, setKbs] = useState<KbInfo[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(kbId);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    api.listKbs().then(setKbs).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedKbId) { setDocs([]); return; }
    const load = () => api.listDocuments(selectedKbId).then(setDocs).catch(console.error);
    load();
    const iv = setInterval(load, 3000);
    setPolling(true);
    return () => { clearInterval(iv); setPolling(false); };
  }, [selectedKbId]);

  const inProgress = docs.filter((d) => d.status !== "ready" && d.status !== "error");
  const done = docs.filter((d) => d.status === "ready");
  const errored = docs.filter((d) => d.status === "error");

  const statusIcon = (status: string) => {
    if (status === "ready") return <CheckCircle2Icon size={15} className="text-emerald-500" />;
    if (status === "error") return <AlertCircleIcon size={15} className="text-red-500" />;
    return <Loader2Icon size={15} className="animate-spin text-amber-500" />;
  };

  const statusLabel: Record<string, string> = {
    uploaded: "等待处理", parsing: "文档解析中", compiling: "Wiki编译中", ready: "已就绪", error: "失败",
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="h-12 border-b border-stone-200 flex items-center px-5 gap-3 shrink-0">
        <ListTodoIcon size={17} className="text-amber-500" />
        <span className="text-sm font-semibold text-stone-800">任务面板</span>
        {polling && inProgress.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
            <Loader2Icon size={11} className="animate-spin" />实时更新中
          </span>
        )}
        <div className="flex-1" />
        {kbs.length > 0 && (
          <select
            value={selectedKbId || ""}
            onChange={(e) => setSelectedKbId(e.target.value || null)}
            className="text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 text-stone-800 bg-white"
          >
            <option value="">所有知识库</option>
            {kbs.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-stone-50">
        {!selectedKbId ? (
          <div className="text-center py-16">
            <DatabaseIcon size={40} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 text-sm">请选择一个知识库查看任务</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* In progress */}
            {inProgress.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  进行中 ({inProgress.length})
                </h3>
                <div className="space-y-2">
                  {inProgress.map((doc) => (
                    <div key={doc.id} className="bg-white border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
                      {statusIcon(doc.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">{doc.filename}</p>
                        <p className="text-xs text-amber-600 mt-0.5">{statusLabel[doc.status]}</p>
                      </div>
                      <div className="shrink-0">
                        <div className="w-24 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full transition-all duration-1000"
                            style={{
                              width: doc.status === "parsing" ? "30%" : doc.status === "compiling" ? "70%" : "10%",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Errors */}
            {errored.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  失败 ({errored.length})
                </h3>
                <div className="space-y-2">
                  {errored.map((doc) => (
                    <div key={doc.id} className="bg-white border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
                      <AlertCircleIcon size={15} className="text-red-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">{doc.filename}</p>
                        <p className="text-xs text-red-500 mt-0.5">编译失败</p>
                      </div>
                      <button
                        onClick={async () => {
                          await api.retryDocument(selectedKbId, doc.id);
                          const updated = await api.listDocuments(selectedKbId);
                          setDocs(updated);
                        }}
                        className="text-xs text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 font-medium"
                      >
                        重试
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Done */}
            {done.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  已完成 ({done.length})
                </h3>
                <div className="space-y-2">
                  {done.map((doc) => (
                    <div key={doc.id} className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-3">
                      <CheckCircle2Icon size={15} className="text-emerald-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">{doc.filename}</p>
                        <p className="text-xs text-stone-400 mt-0.5">
                          <ClockIcon size={10} className="inline mr-1" />
                          {new Date(doc.createdAt.replace(" ", "T") + "Z").toLocaleString("zh-CN")}
                        </p>
                      </div>
                      <CheckCircle2Icon size={14} className="text-emerald-400 shrink-0" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {docs.length === 0 && (
              <div className="text-center py-16">
                <ListTodoIcon size={40} className="mx-auto text-stone-300 mb-3" />
                <p className="text-stone-500 text-sm">暂无任务</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
