import { useState, useEffect, useRef } from "react";
import { GitBranchIcon, Loader2Icon, ZoomInIcon, ZoomOutIcon, MaximizeIcon, FileTextIcon, TableIcon } from "lucide-react";
import { api, type KbInfo, type SheetInfo } from "../api/client";

interface Props {
  kbId: string | null;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

type DataSource = "wiki" | "xlsx";

// Force-directed layout simulation
const SIMULATION_STEPS = 120;
const REPULSION = 2000;
const ATTRACTION = 0.005;
const DAMPING = 0.85;
const CENTER_PULL = 0.01;

export function GraphPage({ kbId }: Props) {
  const [kbs, setKbs] = useState<KbInfo[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(kbId);
  const [dataSource, setDataSource] = useState<DataSource>("wiki");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [col1, setCol1] = useState<string | null>(null);
  const [col2, setCol2] = useState<string | null>(null);
  const [relationCol, setRelationCol] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [communities, setCommunities] = useState<Array<{ id: number; label: string; nodeCount: number; cohesion?: number }>>([]);
  const [extractionMethod, setExtractionMethod] = useState<string>("local");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { api.listKbs().then(setKbs).catch(console.error); }, []);

  useEffect(() => {
    if (!selectedKbId) { setSheets([]); return; }
    api.listXlsxSheets(selectedKbId).then(setSheets).catch(console.error);
  }, [selectedKbId]);

  // Auto-select columns for xlsx mode
  useEffect(() => {
    const sheet = sheets.find((s) => s.id === selectedSheetId);
    if (!sheet) return;
    const textCols = sheet.headerRow.filter((h) => (sheet.schemaJson[h] || "text") === "text");
    setCol1(textCols[0] || sheet.headerRow[0] || null);
    setCol2(textCols[1] || sheet.headerRow[1] || null);
    setRelationCol(textCols[2] || null);
  }, [selectedSheetId, sheets]);

  // Auto-load graph when KB or data source changes (for wiki mode)
  useEffect(() => {
    if (selectedKbId && dataSource === "wiki") {
      loadWikiGraph();
    }
  }, [selectedKbId, dataSource]);

  const loadWikiGraph = async (deep = false) => {
    if (!selectedKbId) return;
    setIsLoading(true);
    setNodes([]);
    setEdges([]);
    setCommunities([]);
    setSelectedNode(null);
    try {
      let result;
      if (deep) {
        result = await api.getWikiDeepGraph(selectedKbId);
      } else {
        result = await api.getWikiGraph(selectedKbId);
      }

      const nodeMap = new Map<string, GraphNode>();
      const edgeList: GraphEdge[] = [];

      // Set extraction method
      setExtractionMethod(result.stats?.extractionMethod || "local");

      // Set communities
      if (result.communities) {
        setCommunities(result.communities);
      }

      // Convert API nodes to GraphNodes
      for (const n of result.nodes) {
        nodeMap.set(n.id, {
          id: n.id,
          label: n.label,
          type: n.type,
          x: Math.random() * 600 - 300,
          y: Math.random() * 600 - 300,
          vx: 0,
          vy: 0,
        });
      }

      for (const e of result.edges) {
        edgeList.push({ source: e.source, target: e.target, label: e.label || e.relation || "" });
      }

      // Run force simulation
      const simNodes = [...nodeMap.values()];
      if (simNodes.length > 0) {
        for (let step = 0; step < SIMULATION_STEPS; step++) {
          for (let i = 0; i < simNodes.length; i++) {
            for (let j = i + 1; j < simNodes.length; j++) {
              const dx = simNodes[i].x - simNodes[j].x;
              const dy = simNodes[i].y - simNodes[j].y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const force = REPULSION / (dist * dist);
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              simNodes[i].vx += fx; simNodes[i].vy += fy;
              simNodes[j].vx -= fx; simNodes[j].vy -= fy;
            }
          }
          for (const edge of edgeList) {
            const s = nodeMap.get(edge.source);
            const t = nodeMap.get(edge.target);
            if (!s || !t) continue;
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            s.vx += dx * ATTRACTION; s.vy += dy * ATTRACTION;
            t.vx -= dx * ATTRACTION; t.vy -= dy * ATTRACTION;
          }
          for (const n of simNodes) {
            n.vx -= n.x * CENTER_PULL;
            n.vy -= n.y * CENTER_PULL;
            n.vx *= DAMPING;
            n.vy *= DAMPING;
            n.x += n.vx;
            n.y += n.vy;
          }
        }
      }

      setNodes(simNodes);
      setEdges(edgeList);
    } finally {
      setIsLoading(false);
    }
  };

  const buildXlsxGraph = async () => {
    if (!selectedKbId || !selectedSheetId || !col1 || !col2) return;
    setIsLoading(true);
    try {
      const result = await api.queryXlsx(selectedKbId, { sheetId: selectedSheetId, limit: 5000 });
      const nodeMap = new Map<string, GraphNode>();
      const edgeList: GraphEdge[] = [];

      for (const row of result.rows) {
        const a = String(row[col1] || "").trim();
        const b = String(row[col2] || "").trim();
        if (!a || !b || a === b) continue;
        if (!nodeMap.has(a)) nodeMap.set(a, { id: a, label: a, type: "entity", x: Math.random() * 600 - 300, y: Math.random() * 600 - 300, vx: 0, vy: 0 });
        if (!nodeMap.has(b)) nodeMap.set(b, { id: b, label: b, type: "entity", x: Math.random() * 600 - 300, y: Math.random() * 600 - 300, vx: 0, vy: 0 });
        const relLabel = relationCol ? String(row[relationCol] || "") : "";
        edgeList.push({ source: a, target: b, label: relLabel });
      }

      const simNodes = [...nodeMap.values()];
      for (let step = 0; step < SIMULATION_STEPS; step++) {
        for (let i = 0; i < simNodes.length; i++) {
          for (let j = i + 1; j < simNodes.length; j++) {
            const dx = simNodes[i].x - simNodes[j].x;
            const dy = simNodes[i].y - simNodes[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = REPULSION / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            simNodes[i].vx += fx; simNodes[i].vy += fy;
            simNodes[j].vx -= fx; simNodes[j].vy -= fy;
          }
        }
        for (const edge of edgeList) {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) continue;
          s.vx += (t.x - s.x) * ATTRACTION; s.vy += (t.y - s.y) * ATTRACTION;
          t.vx -= (t.x - s.x) * ATTRACTION; t.vy -= (t.y - s.y) * ATTRACTION;
        }
        for (const n of simNodes) {
          n.vx -= n.x * CENTER_PULL;
          n.vy -= n.y * CENTER_PULL;
          n.vx *= DAMPING;
          n.vy *= DAMPING;
          n.x += n.vx;
          n.y += n.vy;
        }
      }

      setNodes(simNodes);
      setEdges(edgeList);
    } finally {
      setIsLoading(false);
    }
  };

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const cx = rect.width / 2 + pan.x;
    const cy = rect.height / 2 + pan.y;

    ctx.clearRect(0, 0, rect.width, rect.height);

    // Color map by type — warm earth-tone palette matching the reference UI
    const communityColors = [
      "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2",
      "#ea580c", "#db2777", "#0d9488", "#9333ea", "#65a30d",
    ];
    const typeColors: Record<string, string> = {
      document: "#059669",
      entity: "#0891b2",
      heading: "#d97706",
      person: "#dc2626",
      org: "#7c3aed",
      location: "#0d9488",
      money: "#ea580c",
      keyword: "#059669",
    };

    // Build community color lookup
    const nodeColorMap = new Map<string, string>();
    if (communities.length > 0) {
      for (const n of nodes) {
        nodeColorMap.set(n.id, typeColors[n.type] || "#059669");
      }
    }

    // Draw edges
    ctx.strokeStyle = "#d6d3d1";
    ctx.lineWidth = 1;
    ctx.font = "10px sans-serif";
    for (const edge of edges) {
      const s = nodes.find((n) => n.id === edge.source);
      const t = nodes.find((n) => n.id === edge.target);
      if (!s || !t) continue;
      ctx.beginPath();
      ctx.moveTo(cx + s.x * zoom, cy + s.y * zoom);
      ctx.lineTo(cx + t.x * zoom, cy + t.y * zoom);
      ctx.stroke();
      if (edge.label && zoom > 0.6) {
        const mx = cx + (s.x + t.x) / 2 * zoom;
        const my = cy + (s.y + t.y) / 2 * zoom;
        ctx.fillStyle = "#78716c";
        ctx.textAlign = "center";
        ctx.fillText(edge.label.slice(0, 12), mx, my - 3);
      }
    }

    // Draw nodes
    for (const node of nodes) {
      const x = cx + node.x * zoom;
      const y = cy + node.y * zoom;
      const isSelected = selectedNode?.id === node.id;
      const color = typeColors[node.type] || "#059669";
      const radius = node.type === "document" ? 8 : 5;

      // Highlight ring for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, (radius + 4) * zoom, 0, Math.PI * 2);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, radius * zoom, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#fff" : `${color}88`;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Label
      if (zoom > 0.4) {
        ctx.fillStyle = "#292524";
        ctx.font = `${Math.max(9, (node.type === "document" ? 12 : 10) * zoom)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(node.label.slice(0, 15), x, y - (radius + 3) * zoom);
      }
    }

    // Legend
    const legendItems = [
      { label: "文档", color: typeColors.document },
      { label: "关键词", color: typeColors.keyword },
      { label: "机构", color: typeColors.org },
      { label: "地点", color: typeColors.location },
      { label: "金额", color: typeColors.money },
    ];
    ctx.font = "11px sans-serif";
    let ly = 20;
    for (const item of legendItems) {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(15, ly, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#78716c";
      ctx.textAlign = "left";
      ctx.fillText(item.label, 25, ly + 4);
      ly += 18;
    }
  }, [nodes, edges, zoom, pan, selectedNode, communities]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const cx = rect.width / 2 + pan.x;
    const cy = rect.height / 2 + pan.y;

    let closest: GraphNode | null = null;
    let closestDist = 20; // pixel threshold
    for (const node of nodes) {
      const nx = cx + node.x * zoom;
      const ny = cy + node.y * zoom;
      const d = Math.sqrt((clickX - nx) ** 2 + (clickY - ny) ** 2);
      if (d < closestDist) {
        closestDist = d;
        closest = node;
      }
    }
    setSelectedNode(closest);
  };

  const sheet = sheets.find((s) => s.id === selectedSheetId);

  // Node info panel
  const connectedEdges = selectedNode
    ? edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
    : [];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Config */}
      <div className="w-72 border-r border-stone-200 bg-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-stone-200">
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">知识库</label>
          <select value={selectedKbId || ""} onChange={(e) => {
            const val = e.target.value || null;
            setSelectedKbId(val);
            setSelectedSheetId(null);
            setNodes([]);
            setSelectedNode(null);
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
              <button onClick={() => { setDataSource("wiki"); setNodes([]); setSelectedNode(null); }}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${
                  dataSource === "wiki" ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}>
                <FileTextIcon size={12} /> Wiki 文档
              </button>
              <button onClick={() => { setDataSource("xlsx"); setNodes([]); setSelectedNode(null); }}
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
              <select value={selectedSheetId || ""} onChange={(e) => { setSelectedSheetId(e.target.value || null); setNodes([]); }}
                className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
                <option value="">选择工作表...</option>
                {sheets.map((s) => <option key={s.id} value={s.id}>{s.sheetName} ({s.rowCount}行)</option>)}
              </select>
            </div>
            {sheet && (
              <div className="px-4 py-3 border-b border-stone-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">实体列 A</label>
                  <select value={col1 || ""} onChange={(e) => setCol1(e.target.value)}
                    className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
                    {sheet.headerRow.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">实体列 B</label>
                  <select value={col2 || ""} onChange={(e) => setCol2(e.target.value)}
                    className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
                    {sheet.headerRow.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">关系标签列 (可选)</label>
                  <select value={relationCol || ""} onChange={(e) => setRelationCol(e.target.value || null)}
                    className="w-full text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white">
                    <option value="">无</option>
                    {sheet.headerRow.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <button onClick={buildXlsxGraph} disabled={!col1 || !col2 || isLoading}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white text-sm font-medium rounded-lg transition-colors">
                  {isLoading ? <Loader2Icon size={14} className="animate-spin inline mr-1" /> : <GitBranchIcon size={14} className="inline mr-1" />}
                  生成关系图谱
                </button>
              </div>
            )}
          </>
        )}

        {selectedKbId && dataSource === "wiki" && (
          <div className="px-4 py-3 border-b border-stone-200">
            <p className="text-xs text-stone-500 mb-2">从 Wiki 文档中自动提取实体和关系。</p>
            <div className="space-y-2">
              <button onClick={() => loadWikiGraph(false)} disabled={isLoading}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white text-sm font-medium rounded-lg transition-colors">
                {isLoading ? <Loader2Icon size={14} className="animate-spin inline mr-1" /> : <GitBranchIcon size={14} className="inline mr-1" />}
                快速提取
              </button>
              <button onClick={() => loadWikiGraph(true)} disabled={isLoading}
                className="w-full py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-stone-300 text-white text-sm font-medium rounded-lg transition-colors">
                {isLoading ? <Loader2Icon size={14} className="animate-spin inline mr-1" /> : <GitBranchIcon size={14} className="inline mr-1" />}
                深度分析 (Graphify)
              </button>
            </div>
            {extractionMethod === "graphify" && (
              <p className="text-xs text-violet-600 mt-2">使用 Graphify 语义提取 + 社区检测</p>
            )}
            {communities.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-stone-500 mb-1">社区聚类 ({communities.length})</p>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {communities.slice(0, 10).map((c) => (
                    <li key={c.id} className="text-xs text-stone-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ["#059669","#d97706","#dc2626","#7c3aed","#0891b2"][c.id % 5] }} />
                      <span className="truncate">{c.label} ({c.nodeCount})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {nodes.length > 0 && (
          <div className="px-4 py-3 text-xs text-stone-500 border-b border-stone-200">
            {nodes.length} 个节点，{edges.length} 条关系
          </div>
        )}

        {/* Node detail panel */}
        {selectedNode && (
          <div className="px-4 py-3 flex-1 overflow-y-auto">
            <h4 className="text-sm font-semibold text-stone-800 mb-2">{selectedNode.label}</h4>
            <p className="text-xs text-stone-500 mb-2">
              类型: <span className="font-medium text-stone-700">{selectedNode.type === "document" ? "文档" : selectedNode.type === "org" ? "机构" : selectedNode.type === "location" ? "地点" : selectedNode.type === "money" ? "金额" : selectedNode.type === "keyword" ? "关键词" : selectedNode.type}</span>
            </p>
            {connectedEdges.length > 0 && (
              <div>
                <p className="text-xs text-stone-500 mb-1">关联 ({connectedEdges.length}):</p>
                <ul className="space-y-1">
                  {connectedEdges.slice(0, 20).map((e, i) => {
                    const otherId = e.source === selectedNode.id ? e.target : e.source;
                    const otherNode = nodes.find((n) => n.id === otherId);
                    return (
                      <li key={i} className="text-xs text-stone-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span className="truncate">{otherNode?.label || otherId}</span>
                        {e.label && <span className="text-stone-400 text-[10px] shrink-0">({e.label})</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Graph canvas */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {nodes.length === 0 && !isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <GitBranchIcon size={48} className="mx-auto text-stone-300 mb-3" />
              <p className="text-stone-500 text-sm font-medium">选择知识库自动生成知识图谱</p>
              <p className="text-stone-400 text-xs mt-1">支持 Wiki 文档和 Excel 数据两种来源</p>
            </div>
          </div>
        ) : (
          <>
            <div className="h-10 border-b border-stone-200 flex items-center px-4 gap-2 shrink-0">
              <button onClick={() => setZoom((z) => Math.min(z * 1.3, 5))} className="p-1.5 rounded hover:bg-stone-100"><ZoomInIcon size={14} /></button>
              <button onClick={() => setZoom((z) => Math.max(z / 1.3, 0.2))} className="p-1.5 rounded hover:bg-stone-100"><ZoomOutIcon size={14} /></button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1.5 rounded hover:bg-stone-100"><MaximizeIcon size={14} /></button>
              <span className="text-xs text-stone-400 ml-2">{Math.round(zoom * 100)}%</span>
              {isLoading && <Loader2Icon size={14} className="animate-spin text-emerald-500 ml-auto" />}
            </div>
            <canvas ref={canvasRef} className="flex-1 w-full" style={{ cursor: "grab" }}
              onClick={handleCanvasClick}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
                const onMove = (ev: MouseEvent) => setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
                const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
              onWheel={(e) => setZoom((z) => Math.max(0.2, Math.min(5, z - e.deltaY * 0.001)))}
            />
          </>
        )}
      </div>
    </div>
  );
}
