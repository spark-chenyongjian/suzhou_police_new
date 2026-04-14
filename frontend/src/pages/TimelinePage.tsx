import { useState, useEffect, useMemo } from "react";
import { ClockIcon, Loader2Icon, ChevronDownIcon, ChevronRightIcon, FileTextIcon, TableIcon } from "lucide-react";
import { api, type KbInfo, type SheetInfo } from "../api/client";

interface Props {
  kbId: string | null;
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  description: string;
  entity: string;
  confidence: string;
  source: string;
}

type DataSource = "wiki" | "xlsx";

// Date column candidates for xlsx mode
const DATE_COL_NAMES = ["日期", "时间", "date", "time", "datetime", "timestamp", "发生时间", "创建时间", "交易日期", "交易时间"];

export function TimelinePage({ kbId }: Props) {
  const [kbs, setKbs] = useState<KbInfo[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(kbId);
  const [dataSource, setDataSource] = useState<DataSource>("wiki");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [dateCol, setDateCol] = useState<string | null>(null);
  const [descCol, setDescCol] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"day" | "month" | "year">("month");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => { api.listKbs().then(setKbs).catch(console.error); }, []);

  useEffect(() => {
    if (!selectedKbId) { setSheets([]); return; }
    api.listXlsxSheets(selectedKbId).then(setSheets).catch(console.error);
  }, [selectedKbId]);

  // Auto-load timeline when KB changes in wiki mode
  useEffect(() => {
    if (selectedKbId && dataSource === "wiki") {
      loadWikiTimeline();
    }
  }, [selectedKbId, dataSource]);

  const loadWikiTimeline = async () => {
    if (!selectedKbId) return;
    setIsLoading(true);
    setEvents([]);
    try {
      const result = await api.getWikiTimeline(selectedKbId);
      setEvents(result.events);
    } finally {
      setIsLoading(false);
    }
  };

  const loadXlsxTimeline = async () => {
    if (!selectedKbId || !selectedSheetId || !dateCol) return;
    setIsLoading(true);
    try {
      const result = await api.queryXlsx(selectedKbId, {
        sheetId: selectedSheetId,
        limit: 5000,
      });
      const mapped = result.rows
        .map((row, i) => ({
          id: String(i),
          timestamp: String(row[dateCol] || ""),
          description: descCol ? String(row[descCol] || "") : Object.entries(row).filter(([k]) => k !== dateCol).map(([, v]) => v).join(" | "),
          entity: "",
          confidence: "confirmed",
          source: result.sheetName,
        }))
        .filter((e) => e.timestamp)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      setEvents(mapped);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-detect columns for xlsx mode
  useEffect(() => {
    const sheet = sheets.find((s) => s.id === selectedSheetId);
    if (!sheet) { setDateCol(null); setDescCol(null); return; }
    const headers = sheet.headerRow;
    const detected = headers.find((h) => DATE_COL_NAMES.some((d) => h.toLowerCase().includes(d)));
    setDateCol(detected || headers[0] || null);
    const descCandidates = headers.filter((h) =>
      ["描述", "摘要", "内容", "备注", "说明", "description", "summary", "detail", "remark", "note", "事项", "类型"].some((d) => h.toLowerCase().includes(d))
    );
    setDescCol(descCandidates[0] || null);
  }, [selectedSheetId, sheets]);

  // Group events
  const grouped = useMemo(() => {
    const groups = new Map<string, TimelineEvent[]>();
    for (const ev of events) {
      let key: string;
      const ts = ev.timestamp.slice(0, 10);
      if (groupBy === "year") key = ts.slice(0, 4);
      else if (groupBy === "month") key = ts.slice(0, 7);
      else key = ts;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ev);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events, groupBy]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const sheet = sheets.find((s) => s.id === selectedSheetId);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Config panel */}
      <div className="w-72 border-r border-stone-200 bg-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-stone-200">
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">知识库</label>
          <select value={selectedKbId || ""} onChange={(e) => {
            setSelectedKbId(e.target.value || null);
            setSelectedSheetId(null);
            setEvents([]);
          }}
            className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
            <option value="">选择知识库...</option>
            {kbs.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
        </div>

        {selectedKbId && (
          <div className="px-4 py-3 border-b border-stone-200">
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">数据来源</label>
            <div className="flex gap-1">
              <button onClick={() => { setDataSource("wiki"); setEvents([]); }}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${
                  dataSource === "wiki" ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}>
                <FileTextIcon size={12} /> Wiki 文档
              </button>
              <button onClick={() => { setDataSource("xlsx"); setEvents([]); }}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${
                  dataSource === "xlsx" ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}>
                <TableIcon size={12} /> Excel 表格
              </button>
            </div>
          </div>
        )}

        {selectedKbId && dataSource === "xlsx" && (
          <>
            <div className="px-4 py-3 border-b border-stone-200">
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">数据表</label>
              <select value={selectedSheetId || ""} onChange={(e) => { setSelectedSheetId(e.target.value || null); setEvents([]); }}
                className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
                <option value="">选择工作表...</option>
                {sheets.map((s) => <option key={s.id} value={s.id}>{s.sheetName} ({s.rowCount}行)</option>)}
              </select>
            </div>
            {sheet && (
              <div className="px-4 py-3 border-b border-stone-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">时间列</label>
                  <select value={dateCol || ""} onChange={(e) => setDateCol(e.target.value)}
                    className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
                    {sheet.headerRow.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">描述列</label>
                  <select value={descCol || ""} onChange={(e) => setDescCol(e.target.value || null)}
                    className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
                    <option value="">自动</option>
                    {sheet.headerRow.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <button onClick={loadXlsxTimeline} disabled={!dateCol || isLoading}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white text-sm font-medium rounded-lg transition-colors">
                  {isLoading ? <Loader2Icon size={14} className="animate-spin inline mr-1" /> : <ClockIcon size={14} className="inline mr-1" />}
                  生成时间线
                </button>
              </div>
            )}
          </>
        )}

        {selectedKbId && dataSource === "wiki" && (
          <div className="px-4 py-3 border-b border-stone-200">
            <p className="text-xs text-stone-500 mb-2">自动从 Wiki 文档中提取日期和时间信息。</p>
            <button onClick={loadWikiTimeline} disabled={isLoading}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white text-sm font-medium rounded-lg transition-colors">
              {isLoading ? <Loader2Icon size={14} className="animate-spin inline mr-1" /> : <ClockIcon size={14} className="inline mr-1" />}
              刷新时间线
            </button>
          </div>
        )}

        {/* Group by controls */}
        {events.length > 0 && (
          <div className="px-4 py-3 border-b border-stone-200">
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">分组</label>
            <div className="flex gap-1">
              {(["day", "month", "year"] as const).map((g) => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                    groupBy === g ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}>
                  {g === "day" ? "按天" : g === "month" ? "按月" : "按年"}
                </button>
              ))}
            </div>
          </div>
        )}

        {events.length > 0 && (
          <div className="px-4 py-3 text-xs text-stone-500">
            共 {events.length} 个事件，{grouped.length} 个分组
          </div>
        )}
      </div>

      {/* Right: Timeline visualization */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {events.length === 0 && !isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <ClockIcon size={48} className="mx-auto text-stone-300 mb-3" />
              <p className="text-stone-500 text-sm font-medium">选择知识库自动提取时间线</p>
              <p className="text-stone-400 text-xs mt-1">支持 Wiki 文档和 Excel 数据两种来源</p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Loader2Icon size={32} className="mx-auto text-emerald-400 mb-3 animate-spin" />
              <p className="text-stone-500 text-sm">正在提取时间信息...</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            {grouped.map(([groupKey, groupEvents]) => {
              const isExpanded = expandedGroups.has(groupKey) || grouped.length <= 10;
              return (
                <div key={groupKey} className="mb-4">
                  <button onClick={() => toggleGroup(groupKey)}
                    className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors">
                    {isExpanded ? <ChevronDownIcon size={14} className="text-stone-400" /> : <ChevronRightIcon size={14} className="text-stone-400" />}
                    <span className="text-sm font-bold text-stone-800">{groupKey}</span>
                    <span className="text-xs text-stone-400 ml-2">{groupEvents.length} 事件</span>
                  </button>
                  {isExpanded && (
                    <div className="ml-4 border-l-2 border-emerald-200 pl-4 mt-1 space-y-1">
                      {groupEvents.slice(0, 100).map((ev) => (
                        <div key={ev.id} className="flex items-start gap-3 py-1.5 px-2 rounded hover:bg-stone-50 group">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-mono text-stone-500">{ev.timestamp}</p>
                            <p className="text-sm text-stone-800 break-words">{ev.description.slice(0, 200)}</p>
                            {ev.source && <p className="text-xs text-stone-400 mt-0.5">来源: {ev.source}</p>}
                          </div>
                        </div>
                      ))}
                      {groupEvents.length > 100 && (
                        <p className="text-xs text-stone-400 px-2">... 还有 {groupEvents.length - 100} 条</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
