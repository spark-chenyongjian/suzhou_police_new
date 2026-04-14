import { useState, useEffect, useRef, useCallback } from "react";
import {
  DatabaseIcon, PlusIcon, FileTextIcon, UploadIcon, Loader2Icon,
  CheckCircle2Icon, AlertCircleIcon, PencilIcon, Trash2Icon, MoreHorizontalIcon,
  RefreshCwIcon, BookOpenIcon, XIcon, FolderIcon,
} from "lucide-react";
import { api, type KbInfo, type DocInfo } from "../api/client";

interface Props {
  kbId?: string | null;
  onKbChange?: (id: string) => void;
}

type WikiPageInfo = {
  id: string; title: string; pageType: string; docId: string | null; tokenCount: number | null; createdAt: string;
};

/* ── Toast (纯 inline style，不依赖 Tailwind JIT 扫描) ──────────────── */
let globalToastEl: HTMLDivElement | null = null;
let globalToastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(type: "success" | "error", msg: string) {
  if (!globalToastEl) return;
  clearTimeout(globalToastTimer);
  const el = globalToastEl;
  // 全部用 inline style，确保不被 Tailwind JIT 遗漏
  Object.assign(el.style, {
    display: "flex",
    position: "fixed",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "99999",
    alignItems: "center",
    gap: "8px",
    padding: "10px 20px",
    borderRadius: "8px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
    fontSize: "14px",
    fontWeight: "500",
    color: "#fff",
    backgroundColor: type === "success" ? "#059669" : "#dc2626",
    pointerEvents: "auto",
    transition: "opacity 0.3s",
    opacity: "1",
  });
  el.textContent = "";
  const icon = document.createElement("span");
  icon.textContent = type === "success" ? "✓ " : "✕ ";
  el.appendChild(icon);
  el.appendChild(document.createTextNode(msg));
  globalToastTimer = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => { el.style.display = "none"; el.style.opacity = "1"; }, 350);
  }, 3000);
}

export function ToastContainer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { globalToastEl = ref.current; }, []);
  return <div ref={ref} style={{ display: "none", pointerEvents: "none" }} />;
}

/* ── Resizable Divider ────────────────────────────────────────────────── */
function ResizableDivider({ onResize }: { onResize: (dx: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const startDrag = useCallback((startX: number) => {
    dragging.current = true;
    lastX.current = startX;
    setActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      onResize(ev.clientX - lastX.current);
      lastX.current = ev.clientX;
    };
    const onUp = () => {
      dragging.current = false;
      setActive(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onResize]);

  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "8px",
        flexShrink: 0,
        cursor: "col-resize",
        background: active ? "#059669" : hover ? "#a7f3d0" : "transparent",
        transition: "background 0.15s",
        position: "relative",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{
        width: "2px",
        height: "24px",
        borderRadius: "1px",
        background: active ? "#fff" : hover ? "#059669" : "#d6d3d1",
        transition: "background 0.15s",
      }} />
    </div>
  );
}

/* ── KnowledgeBasePage ────────────────────────────────────────────────── */
export function KnowledgeBasePage({ kbId: initialKbId, onKbChange }: Props) {
  const [kbs, setKbs] = useState<KbInfo[]>([]);
  const [selectedKb, setSelectedKb] = useState<KbInfo | null>(null);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [newKbName, setNewKbName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"docs" | "wiki">("docs");
  const [renamingKbId, setRenamingKbId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showMenuId, setShowMenuId] = useState<string | null>(null);
  const [showNewKbInput, setShowNewKbInput] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resizable panel widths
  const [leftWidth, setLeftWidth] = useState(220);
  const menuRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listKbs().then((list) => {
      setKbs(list);
      if (initialKbId) {
        const match = list.find((k) => k.id === initialKbId);
        if (match) setSelectedKb(match);
      }
    }).catch((err) => {
      console.error("Failed to load knowledge bases:", err);
      setErrorMsg("加载知识库失败: " + (err instanceof Error ? err.message : String(err)));
    });
  }, [initialKbId]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!selectedKb) { setDocs([]); return; }
    api.listDocuments(selectedKb.id).then(setDocs).catch(console.error);
    const interval = setInterval(async () => {
      const d = await api.listDocuments(selectedKb.id).catch(() => null);
      if (!d) return;
      setDocs(d);
      if (d.every((doc) => doc.status === "ready" || doc.status === "error")) {
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedKb]);

  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    setIsCreating(true);
    setErrorMsg(null);
    try {
      const kb = await api.createKb(newKbName.trim());
      setKbs((p) => [kb, ...p]);
      setNewKbName("");
      setShowNewKbInput(false);
      setSelectedKb(kb);
      onKbChange?.(kb.id);
      showToast("success", `知识库「${kb.name}」创建成功`);
    } catch (err) {
      console.error("Failed to create KB:", err);
      const msg = "创建失败: " + (err instanceof Error ? err.message : String(err));
      setErrorMsg(msg);
      showToast("error", msg);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRename = async (kbId: string) => {
    if (!renameValue.trim()) return;
    try {
      const updated = await api.renameKb(kbId, renameValue.trim());
      setKbs((p) => p.map((k) => (k.id === kbId ? updated : k)));
      if (selectedKb?.id === kbId) setSelectedKb(updated);
      setRenamingKbId(null);
      showToast("success", "重命名成功");
    } catch (err) {
      showToast("error", "重命名失败: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDeleteKb = async (kbId: string) => {
    if (!confirm("确定删除此知识库？所有文档和Wiki页面将被清除。")) return;
    try {
      await api.deleteKb(kbId);
      setKbs((p) => p.filter((k) => k.id !== kbId));
      if (selectedKb?.id === kbId) setSelectedKb(null);
      setShowMenuId(null);
      showToast("success", "知识库已删除");
    } catch (err) {
      showToast("error", "删除失败: " + (err instanceof Error ? err.message : String(err)));
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
      showToast("success", `${e.target.files.length} 个文件上传成功，正在编译...`);
    } catch (err) {
      showToast("error", "上传失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleDeleteDoc = async (doc: DocInfo) => {
    if (!selectedKb || !confirm(`确定删除文档「${doc.filename}」？`)) return;
    await api.deleteDocument(selectedKb.id, doc.id);
    setDocs((p) => p.filter((d) => d.id !== doc.id));
  };

  const handleRetry = async (doc: DocInfo) => {
    if (!selectedKb) return;
    await api.retryDocument(selectedKb.id, doc.id);
    const updated = await api.listDocuments(selectedKb.id);
    setDocs(updated);
  };

  const statusIcon = (status: string) => {
    if (status === "ready") return <CheckCircle2Icon size={14} className="text-emerald-500" />;
    if (status === "error") return <AlertCircleIcon size={14} className="text-red-500" />;
    return <Loader2Icon size={14} className="animate-spin text-amber-500" />;
  };

  const statusLabel: Record<string, string> = {
    uploaded: "等待处理", parsing: "解析中", compiling: "编译中", ready: "就绪", error: "错误",
  };

  const wikiPageCount = docs.filter((d) => d.status === "ready").length * 3;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* KB list sidebar */}
      <div style={{ width: leftWidth, minWidth: 160, maxWidth: 400 }} className="bg-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">知识库</span>
          <button
            onClick={() => setShowNewKbInput((v) => !v)}
            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
          >
            <PlusIcon size={13} />
            新建
          </button>
        </div>

        {errorMsg && (
          <div className="px-3 py-2 border-b border-red-200 bg-red-50 flex items-center gap-2">
            <AlertCircleIcon size={12} className="text-red-500 shrink-0" />
            <span className="text-xs text-red-600 flex-1">{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600">
              <XIcon size={12} />
            </button>
          </div>
        )}

        {showNewKbInput && (
          <div className="px-3 py-2 border-b border-stone-200 bg-stone-50 flex gap-2">
            <input
              autoFocus
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateKb();
                if (e.key === "Escape") { setShowNewKbInput(false); setNewKbName(""); }
              }}
              placeholder="知识库名称..."
              className="flex-1 text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 text-stone-800"
            />
            <button
              onClick={handleCreateKb}
              disabled={isCreating || !newKbName.trim()}
              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-lg text-white text-xs font-medium"
            >
              {isCreating ? "..." : "创建"}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1">
          {kbs.map((kb) => (
            <div key={kb.id} className="relative">
              {renamingKbId === kb.id ? (
                <div className="flex items-center gap-1 px-3 py-2">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(kb.id);
                      if (e.key === "Escape") setRenamingKbId(null);
                    }}
                    className="flex-1 text-sm border border-emerald-400 rounded px-2 py-1 outline-none text-stone-800"
                  />
                  <button onClick={() => handleRename(kb.id)} className="text-emerald-600 hover:text-emerald-700">
                    <CheckCircle2Icon size={14} />
                  </button>
                  <button onClick={() => setRenamingKbId(null)} className="text-stone-400 hover:text-stone-600">
                    <XIcon size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setSelectedKb(kb); onKbChange?.(kb.id); }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors group ${
                    selectedKb?.id === kb.id
                      ? "bg-emerald-50 text-emerald-700 border-r-2 border-emerald-600"
                      : "text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <DatabaseIcon size={14} className={`shrink-0 ${selectedKb?.id === kb.id ? "text-emerald-500" : "text-stone-400"}`} />
                  <span className="truncate flex-1 font-medium">{kb.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenuId(kb.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-opacity"
                  >
                    <MoreHorizontalIcon size={14} />
                  </button>
                </button>
              )}
              {showMenuId === kb.id && (
                <div ref={menuRef} className="absolute right-2 top-8 z-50 bg-white border border-stone-200 rounded-lg shadow-lg py-1 w-32">
                  <button
                    onClick={() => { setRenamingKbId(kb.id); setRenameValue(kb.name); setShowMenuId(null); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                  >
                    <PencilIcon size={13} />重命名
                  </button>
                  <button
                    onClick={() => handleDeleteKb(kb.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2Icon size={13} />删除
                  </button>
                </div>
              )}
            </div>
          ))}
          {kbs.length === 0 && !showNewKbInput && (
            <div className="text-center py-10">
              <DatabaseIcon size={28} className="mx-auto text-stone-300 mb-2" />
              <p className="text-xs text-stone-400">点击"新建"创建知识库</p>
            </div>
          )}
        </div>
      </div>

      {/* Resizable divider */}
      <ResizableDivider onResize={(dx) => setLeftWidth((w) => Math.max(160, Math.min(400, w + dx)))} />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedKb ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <DatabaseIcon size={48} className="mx-auto text-stone-300 mb-3" />
              <p className="text-stone-500 text-sm font-medium">选择或创建一个知识库</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-stone-200 bg-white flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-stone-900">{selectedKb.name}</h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  {docs.length} 个文档 · {docs.filter((d) => d.status === "ready").length} 个就绪
                  {wikiPageCount > 0 && ` · ${wikiPageCount} 个Wiki页面`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Upload files */}
                <label className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors ${
                  isUploading ? "bg-stone-100 text-stone-400 pointer-events-none" : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}>
                  {isUploading ? <Loader2Icon size={14} className="animate-spin" /> : <UploadIcon size={14} />}
                  上传文件
                  <input type="file" className="hidden" multiple onChange={handleUpload} disabled={isUploading}
                    accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp,.bmp,.wav,.mp3,.m4a,.flac,.ogg,.aac" />
                </label>
                {/* Upload folder */}
                <button
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isUploading}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors border ${
                    isUploading
                      ? "border-stone-200 text-stone-400 pointer-events-none"
                      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  }`}
                >
                  <FolderIcon size={14} />
                  上传文件夹
                </button>
                <input
                  ref={folderInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={handleUpload}
                  disabled={isUploading}
                  // @ts-expect-error webkitdirectory is non-standard but widely supported
                  webkitdirectory=""
                  directory=""
                />
              </div>
            </div>

            <div className="px-6 border-b border-stone-200 bg-white flex gap-6">
              {[
                { key: "docs" as const, label: "文档管理", icon: <FileTextIcon size={13} /> },
                { key: "wiki" as const, label: "Wiki浏览", icon: <BookOpenIcon size={13} /> },
              ].map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === key
                      ? "border-emerald-600 text-emerald-600"
                      : "border-transparent text-stone-500 hover:text-stone-700"
                  }`}
                >
                  {icon}{label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-stone-50">
              {activeTab === "docs" ? (
                docs.length === 0 ? (
                  <div className="text-center py-16">
                    <FileTextIcon size={40} className="mx-auto text-stone-300 mb-3" />
                    <p className="text-stone-500 text-sm">暂无文档，点击"上传文件"或"上传文件夹"开始</p>
                    <p className="text-xs text-stone-400 mt-1">支持 PDF、Word、PPT、Markdown、Excel 等格式，支持文件夹批量上传</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {docs.map((doc) => (
                      <div key={doc.id} className="bg-white border border-stone-200 rounded-xl px-5 py-3.5 flex items-center gap-4 hover:border-stone-300 transition-colors group">
                        <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                          <FileTextIcon size={17} className="text-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-900 truncate">{doc.filename}</p>
                          <p className="text-xs text-stone-400 mt-0.5">
                            {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(1)} KB` : "—"}
                            {" · "}
                            {new Date(doc.createdAt.replace(" ", "T") + "Z").toLocaleString("zh-CN")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1.5 text-xs">
                            {statusIcon(doc.status)}
                            <span className={
                              doc.status === "ready" ? "text-emerald-600" :
                              doc.status === "error" ? "text-red-600" : "text-amber-600"
                            }>{statusLabel[doc.status] || doc.status}</span>
                          </div>
                          {doc.status === "error" && (
                            <button
                              onClick={() => handleRetry(doc)}
                              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50"
                            >
                              <RefreshCwIcon size={11} />重试
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteDoc(doc)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-500 transition-all"
                          >
                            <Trash2Icon size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <WikiBrowser kbId={selectedKb.id} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Wiki Browser ─────────────────────────────────────────────────────── */
function WikiBrowser({ kbId }: { kbId: string }) {
  const [pages, setPages] = useState<WikiPageInfo[]>([]);
  const [filter, setFilter] = useState<"all" | "abstract" | "overview" | "fulltext">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [listWidth, setListWidth] = useState(280);

  useEffect(() => {
    fetch(`/api/kb/${kbId}/wiki/pages`)
      .then((r) => r.json())
      .then(setPages)
      .catch(() => {});
  }, [kbId]);

  const loadPage = async (pageId: string) => {
    setSelected(pageId);
    setLoading(true);
    try {
      const resp = await fetch(`/api/kb/${kbId}/wiki/pages/${pageId}/content`);
      setContent(await resp.text());
    } finally {
      setLoading(false);
    }
  };

  const typeFilter: Record<string, string> = {
    all: "全部", abstract: "L0", overview: "L1", fulltext: "L2",
  };

  const badge = (pageType: string) => {
    switch (pageType) {
      case "abstract": return { label: "L0 摘要", cls: "bg-emerald-100 text-emerald-700" };
      case "overview": return { label: "L1 概览", cls: "bg-sky-100 text-sky-700" };
      case "fulltext": return { label: "L2 全文", cls: "bg-violet-100 text-violet-700" };
      case "entity":  return { label: "实体", cls: "bg-amber-100 text-amber-700" };
      case "report":  return { label: "报告", cls: "bg-teal-100 text-teal-700" };
      default: return { label: pageType, cls: "bg-stone-100 text-stone-600" };
    }
  };

  const filteredPages = filter === "all" ? pages : pages.filter((p) => p.pageType === filter);
  const docGroups: Record<string, WikiPageInfo[]> = {};
  const ungrouped: WikiPageInfo[] = [];
  for (const p of filteredPages) {
    if (p.docId) {
      if (!docGroups[p.docId]) docGroups[p.docId] = [];
      docGroups[p.docId].push(p);
    } else {
      ungrouped.push(p);
    }
  }

  if (pages.length === 0) {
    return (
      <div className="text-center py-16">
        <BookOpenIcon size={40} className="mx-auto text-stone-300 mb-3" />
        <p className="text-stone-500 text-sm">暂无Wiki页面，请先上传并编译文档</p>
      </div>
    );
  }

  return (
    <div className="flex gap-0" style={{ minHeight: 0 }}>
      {/* Left: page list */}
      <div style={{ width: listWidth, minWidth: 180, maxWidth: 500 }} className="shrink-0 flex flex-col">
        <div className="flex gap-1 mb-3">
          {(["all", "abstract", "overview", "fulltext"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-emerald-600 text-white"
                  : "bg-white border border-stone-200 text-stone-600 hover:border-stone-300"
              }`}
            >
              {typeFilter[f]}
            </button>
          ))}
        </div>

        <div className="space-y-3 overflow-y-auto flex-1">
          {Object.entries(docGroups).map(([docId, docPages]) => {
            const firstName = docPages[0]?.title.replace(/^\[L[012]\] /, "") ?? docId.slice(0, 8);
            return (
              <div key={docId}>
                <p className="text-xs font-medium text-stone-500 mb-1.5 truncate" title={firstName}>{firstName}</p>
                <div className="space-y-1">
                  {docPages.map((p) => {
                    const b = badge(p.pageType);
                    return (
                      <button
                        key={p.id}
                        onClick={() => loadPage(p.id)}
                        className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                          selected === p.id
                            ? "bg-emerald-50 border border-emerald-200"
                            : "bg-white border border-stone-200 hover:border-stone-300"
                        }`}
                      >
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5 ${b.cls}`}>
                          {b.label}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-stone-800 truncate">
                            {p.title.replace(/^\[L[012]\] /, "")}
                          </p>
                          {p.tokenCount && (
                            <p className="text-xs text-stone-400 mt-0.5">~{p.tokenCount.toLocaleString()} tokens</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {ungrouped.length > 0 && (
            <div>
              <p className="text-xs font-medium text-stone-500 mb-1.5">其他</p>
              <div className="space-y-1">
                {ungrouped.map((p) => {
                  const b = badge(p.pageType);
                  return (
                    <button
                      key={p.id}
                      onClick={() => loadPage(p.id)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        selected === p.id ? "bg-emerald-50 border border-emerald-200" : "bg-white border border-stone-200 hover:border-stone-300"
                      }`}
                    >
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5 ${b.cls}`}>{b.label}</span>
                      <p className="text-xs font-medium text-stone-800 truncate">{p.title}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Resizable divider */}
      <ResizableDivider onResize={(dx) => setListWidth((w) => Math.max(180, Math.min(500, w + dx)))} />

      {/* Right: content */}
      <div className="flex-1 bg-white border border-stone-200 rounded-xl p-6 overflow-y-auto min-w-0">
        {loading ? (
          <div className="flex items-center gap-2 text-stone-400 text-sm py-8 justify-center">
            <Loader2Icon size={16} className="animate-spin" />加载中...
          </div>
        ) : content ? (
          <pre className="text-sm text-stone-800 whitespace-pre-wrap font-sans leading-relaxed">{content}</pre>
        ) : (
          <p className="text-stone-400 text-sm text-center py-8">选择左侧Wiki页面查看内容</p>
        )}
      </div>
    </div>
  );
}
