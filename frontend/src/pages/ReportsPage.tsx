import { useState, useEffect } from "react";
import { FileTextIcon, Loader2Icon, Trash2Icon, PencilIcon, CheckIcon, XIcon, DatabaseIcon, CodeIcon } from "lucide-react";
import { api, type KbInfo } from "../api/client";
import { MarkdownView } from "../components/MarkdownView";

type ReportInfo = { id: string; title: string; tokenCount: number | null; createdAt: string; updatedAt: string };

interface Props {
  kbId: string | null;
}

export function ReportsPage({ kbId }: Props) {
  const [kbs, setKbs] = useState<KbInfo[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(kbId);
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReportInfo | null>(null);
  const [content, setContent] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [isRawView, setIsRawView] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    api.listKbs().then(setKbs).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedKbId) { setReports([]); return; }
    api.listReports(selectedKbId).then(setReports).catch(console.error);
  }, [selectedKbId]);

  const loadReport = async (report: ReportInfo) => {
    if (!selectedKbId) return;
    setSelectedReport(report);
    setIsEditing(false);
    setIsLoading(true);
    try {
      const c = await api.getReportContent(selectedKbId, report.id);
      setContent(c);
      setEditContent(c);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedKbId || !selectedReport) return;
    setIsSaving(true);
    try {
      await api.updateReport(selectedKbId, selectedReport.id, editContent);
      setContent(editContent);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (report: ReportInfo) => {
    if (!selectedKbId || !confirm(`确定删除报告「${report.title}」？`)) return;
    await api.deleteReport(selectedKbId, report.id);
    setReports((p) => p.filter((r) => r.id !== report.id));
    if (selectedReport?.id === report.id) { setSelectedReport(null); setContent(""); }
  };

  const formatDate = (iso: string) =>
    new Date(iso.replace(" ", "T") + "Z").toLocaleString("zh-CN");

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: KB selector + report list */}
      <div className="w-64 border-r border-gray-200 bg-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-200">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">知识库</label>
          <select
            value={selectedKbId || ""}
            onChange={(e) => { setSelectedKbId(e.target.value || null); setSelectedReport(null); setContent(""); }}
            className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-gray-800 bg-white"
          >
            <option value="">选择知识库...</option>
            {kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {!selectedKbId ? (
            <div className="text-center py-10">
              <DatabaseIcon size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">请先选择知识库</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-10">
              <FileTextIcon size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">暂无分析报告</p>
              <p className="text-xs text-gray-400 mt-1">在对话中使用 report_generate 生成</p>
            </div>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className={`group flex items-start gap-2 px-3 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                  selectedReport?.id === r.id ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
                onClick={() => loadReport(r)}
              >
                <FileTextIcon size={14} className={`mt-0.5 shrink-0 ${selectedReport?.id === r.id ? "text-blue-500" : "text-gray-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${selectedReport?.id === r.id ? "text-blue-700" : "text-gray-800"}`}>
                    {r.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(r.createdAt)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(r); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all"
                >
                  <Trash2Icon size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: content viewer/editor */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {!selectedReport ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileTextIcon size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm font-medium">选择左侧报告查看内容</p>
            </div>
          </div>
        ) : (
          <>
            <div className="h-12 border-b border-gray-200 flex items-center px-5 gap-3 shrink-0">
              <FileTextIcon size={16} className="text-blue-500 shrink-0" />
              <span className="text-sm font-semibold text-gray-800 flex-1 truncate">{selectedReport.title}</span>
              <div className="flex items-center gap-2 shrink-0">
                {isEditing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                    >
                      {isSaving ? <Loader2Icon size={12} className="animate-spin" /> : <CheckIcon size={12} />}
                      保存
                    </button>
                    <button
                      onClick={() => { setIsEditing(false); setEditContent(content); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50"
                    >
                      <XIcon size={12} />取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setIsRawView((v) => !v)}
                      title={isRawView ? "切换到渲染视图" : "切换到原文视图"}
                      className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-medium rounded-lg transition-colors ${
                        isRawView
                          ? "border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <CodeIcon size={12} />{isRawView ? "原文" : "渲染"}
                    </button>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50"
                    >
                      <PencilIcon size={12} />编辑
                    </button>
                    <button
                      onClick={() => handleDelete(selectedReport)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50"
                    >
                      <Trash2Icon size={12} />删除
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm gap-2">
                  <Loader2Icon size={16} className="animate-spin" />加载中...
                </div>
              ) : isEditing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full p-6 text-sm text-gray-800 font-mono resize-none outline-none leading-relaxed bg-gray-50 border-0"
                  spellCheck={false}
                />
              ) : isRawView ? (
                <div className="h-full overflow-y-auto p-6">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
                </div>
              ) : (
                <div className="h-full overflow-y-auto p-6 max-w-3xl">
                  <MarkdownView content={content} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
