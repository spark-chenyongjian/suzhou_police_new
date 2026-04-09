import { useState, useEffect } from "react";
import { DatabaseIcon, PlusIcon, FileTextIcon, UploadIcon, Loader2Icon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import { api, type KbInfo, type DocInfo } from "../api/client";
import { useChatStore } from "../store/chat";

export function KnowledgeBasePage() {
  const [kbs, setKbs] = useState<KbInfo[]>([]);
  const [selectedKb, setSelectedKb] = useState<KbInfo | null>(null);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [newKbName, setNewKbName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { setCurrentKb } = useChatStore();

  useEffect(() => {
    api.listKbs().then(setKbs).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedKb) { setDocs([]); return; }
    api.listDocuments(selectedKb.id).then(setDocs).catch(console.error);
    const interval = setInterval(() => {
      api.listDocuments(selectedKb.id).then(setDocs).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedKb]);

  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    setIsCreating(true);
    try {
      const kb = await api.createKb(newKbName.trim());
      setKbs((p) => [kb, ...p]);
      setNewKbName("");
      setSelectedKb(kb);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedKb || !e.target.files?.length) return;
    setIsUploading(true);
    try {
      for (const file of e.target.files) {
        await api.uploadDocument(selectedKb.id, file);
      }
      const updated = await api.listDocuments(selectedKb.id);
      setDocs(updated);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const statusIcon = (status: string) => {
    if (status === "ready") return <CheckCircle2Icon size={14} className="text-green-400" />;
    if (status === "error") return <AlertCircleIcon size={14} className="text-red-400" />;
    return <Loader2Icon size={14} className="animate-spin text-yellow-400" />;
  };

  const statusLabel: Record<string, string> = {
    uploaded: "等待处理",
    parsing: "解析中...",
    compiling: "编译中...",
    ready: "就绪",
    error: "错误",
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* KB list */}
      <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-900">
        <div className="p-3 border-b border-gray-800">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">知识库</p>
          <div className="flex gap-1">
            <input
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateKb()}
              placeholder="新建知识库..."
              className="flex-1 text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500"
            />
            <button
              onClick={handleCreateKb}
              disabled={isCreating || !newKbName.trim()}
              className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white"
            >
              {isCreating ? <Loader2Icon size={12} className="animate-spin" /> : <PlusIcon size={12} />}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {kbs.map((kb) => (
            <button
              key={kb.id}
              onClick={() => { setSelectedKb(kb); setCurrentKb(kb.id); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                selectedKb?.id === kb.id
                  ? "bg-blue-600/20 text-blue-300 border border-blue-600/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              <DatabaseIcon size={14} className="shrink-0" />
              <span className="truncate">{kb.name}</span>
            </button>
          ))}
          {kbs.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-6">暂无知识库</p>
          )}
        </div>
      </div>

      {/* Document list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedKb ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            <div className="text-center">
              <DatabaseIcon size={36} className="mx-auto mb-2 text-gray-700" />
              <p>选择或创建一个知识库</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white text-sm">{selectedKb.name}</h2>
                <p className="text-xs text-gray-500">{docs.length} 个文档</p>
              </div>
              <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${
                isUploading ? "bg-gray-700 text-gray-400" : "bg-blue-600 hover:bg-blue-500 text-white"
              }`}>
                {isUploading ? <Loader2Icon size={13} className="animate-spin" /> : <UploadIcon size={13} />}
                上传文档
                <input type="file" className="hidden" multiple onChange={handleUpload} disabled={isUploading}
                  accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.xlsx,.csv" />
              </label>
            </div>

            {/* Document list */}
            <div className="flex-1 overflow-y-auto p-4">
              {docs.length === 0 ? (
                <div className="text-center py-16 text-gray-600">
                  <FileTextIcon size={36} className="mx-auto mb-2 text-gray-700" />
                  <p className="text-sm">暂无文档，点击"上传文档"开始</p>
                  <p className="text-xs mt-1">支持 PDF、Word、PPT、Markdown、Excel 等格式</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div key={doc.id} className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 flex items-center gap-3">
                      <FileTextIcon size={16} className="text-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{doc.filename}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(1)} KB` : "—"}
                          {" · "}
                          {new Date(doc.createdAt.replace(" ", "T") + "Z").toLocaleString("zh-CN")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs shrink-0">
                        {statusIcon(doc.status)}
                        <span className={doc.status === "ready" ? "text-green-400" : doc.status === "error" ? "text-red-400" : "text-yellow-400"}>
                          {statusLabel[doc.status] || doc.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
