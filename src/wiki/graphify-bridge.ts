/**
 * Graphify Integration Bridge
 *
 * Leverages graphify's graph algorithms for community detection and cohesion scoring.
 * Uses locally-extracted entities (regex-based) as input to graphify's build + cluster.
 *
 * Key capabilities from graphify:
 *   - Community detection (Louvain/Leiden algorithm)
 *   - Cohesion scoring per community
 *   - Edge confidence (EXTRACTED vs INFERRED)
 *   - Cross-document connection discovery
 */

import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { DATA_DIR } from "../paths.js";
import { buildWikiGraph } from "./knowledge-graph.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DeepGraphData {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    community?: number;
    communityLabel?: string;
    meta?: string;
    sourceFile?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label: string;
    relation: string;
    confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
    confidenceScore: number;
    weight: number;
  }>;
  communities: Array<{
    id: number;
    label: string;
    nodeCount: number;
    cohesion?: number;
  }>;
  stats: {
    totalNodes: number;
    totalEdges: number;
    totalCommunities: number;
    extractionMethod: "graphify-cluster" | "local";
  };
}

// ── Graphify Python integration ────────────────────────────────────────────

let graphifyPython: string | null = null;

async function detectGraphifyPython(): Promise<string | null> {
  if (graphifyPython !== null) return graphifyPython;

  try {
    const proc = Bun.spawn(["which", "graphify"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    if (proc.exitCode !== 0) { graphifyPython = null; return null; }

    const binPath = (await new Response(proc.stdout).text()).trim();
    if (!binPath) { graphifyPython = null; return null; }

    const headProc = Bun.spawn(["head", "-1", binPath], { stdout: "pipe" });
    await headProc.exited;
    const shebang = (await new Response(headProc.stdout).text()).trim();
    const pythonPath = shebang.replace("#!", "").trim();

    const testProc = Bun.spawn([pythonPath, "-c", "import graphify; print('ok')"], {
      stdout: "pipe", stderr: "pipe",
    });
    await testProc.exited;
    if (testProc.exitCode === 0) {
      graphifyPython = pythonPath;
      return pythonPath;
    }
  } catch { /* not available */ }

  graphifyPython = null;
  return null;
}

function graphifyCachePath(kbId: string): string {
  return join(DATA_DIR, "wiki", kbId, "graphify-cache.json");
}

/**
 * Build deep graph using locally-extracted entities + graphify community detection.
 * This does NOT require LLM — it uses graphify's graph algorithms only.
 */
export async function buildDeepGraph(kbId: string, onProgress?: (stage: string) => void): Promise<DeepGraphData> {
  onProgress?.("提取本地实体...");

  const quick = buildWikiGraph(kbId);

  if (quick.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      communities: [],
      stats: { totalNodes: 0, totalEdges: 0, totalCommunities: 0, extractionMethod: "local" },
    };
  }

  // Try graphify clustering
  const python = await detectGraphifyPython();
  if (!python) {
    onProgress?.("graphify 不可用，使用本地分析");
    return localFallback(quick);
  }

  onProgress?.("社区检测 (graphify)...");

  // Convert to graphify format and run clustering
  const graphifyNodes = quick.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    file_type: n.type === "document" ? "document" : "code", // graphify only accepts certain types
    source_file: n.id,
  }));

  const graphifyEdges = quick.edges.map((e) => ({
    source: e.source,
    target: e.target,
    relation: e.label,
    confidence: "EXTRACTED",
    confidence_score: 1.0,
    weight: e.weight,
  }));

  const inputJson = JSON.stringify({ nodes: graphifyNodes, edges: graphifyEdges });

  const clusterScript = `
import json, sys
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all

data = json.loads(sys.stdin.read())
try:
    G = build_from_json(data)
    if G.number_of_nodes() == 0:
        print(json.dumps({"communities": {}, "cohesion": {}}))
    else:
        communities = cluster(G)
        cohesion = score_all(G, communities)
        result = {
            "communities": {str(k): v for k, v in communities.items()},
            "cohesion": {str(k): round(v, 2) for k, v in cohesion.items()},
        }
        print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    print(json.dumps({"communities": {}, "cohesion": {}}))
`;

  try {
    const proc = Bun.spawn([python, "-c", clusterScript], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    proc.stdin.write(inputJson);
    proc.stdin.end();

    const timeout = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, 60_000);
    try { await proc.exited; } finally { clearTimeout(timeout); }

    if (proc.exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      console.warn(`[Graphify] Clustering failed:`, err.slice(0, 300));
      return localFallback(quick);
    }

    const output = await new Response(proc.stdout).text();
    const lines = output.split("\n");
    const jsonLine = lines.find((l) => l.trim().startsWith("{"));
    if (!jsonLine) return localFallback(quick);

    const clusterResult = JSON.parse(jsonLine);
    const rawCommunities = clusterResult.communities as Record<string, string[]>;
    const rawCohesion = clusterResult.cohesion as Record<string, number>;

    // Build community data
    const nodeCommunity = new Map<string, number>();
    for (const [cid, nodeList] of Object.entries(rawCommunities)) {
      for (const nodeId of nodeList) {
        nodeCommunity.set(nodeId, parseInt(cid));
      }
    }

    // Auto-label communities using document nodes and top entity types
    const communityLabels = new Map<number, string>();
    for (const [cid, nodeList] of Object.entries(rawCommunities)) {
      const cNodes = (nodeList as string[])
        .map((nid) => quick.nodes.find((n) => n.id === nid))
        .filter(Boolean);

      // Get document names in this community
      const docNames = cNodes
        .filter((n) => n!.type === "document")
        .map((n) => n!.label.replace(/\.[^.]+$/, ""));

      // Get entity types distribution
      const typeCounts = new Map<string, number>();
      cNodes.forEach((n) => {
        if (n!.type !== "document") {
          typeCounts.set(n!.type, (typeCounts.get(n!.type) || 0) + 1);
        }
      });
      const topTypes = [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([t]) => t === "org" ? "机构" : t === "location" ? "地点" : t === "money" ? "金额" : "关键词");

      if (docNames.length > 0 && docNames.length <= 3) {
        communityLabels.set(parseInt(cid), docNames.join(" + "));
      } else if (docNames.length > 3) {
        communityLabels.set(parseInt(cid), `${docNames[0]} 等 ${docNames.length} 篇文档`);
      } else if (topTypes.length > 0) {
        communityLabels.set(parseInt(cid), `${topTypes.join("/")}群 (${cNodes.length})`);
      } else {
        communityLabels.set(parseInt(cid), `社区 ${parseInt(cid) + 1}`);
      }
    }

    const communities: DeepGraphData["communities"] = Object.entries(rawCommunities).map(([cid, nodeList]) => ({
      id: parseInt(cid),
      label: communityLabels.get(parseInt(cid)) || `社区 ${parseInt(cid) + 1}`,
      nodeCount: (nodeList as unknown[]).length,
      cohesion: rawCohesion[cid],
    }));

    const nodes: DeepGraphData["nodes"] = quick.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      community: nodeCommunity.get(n.id),
      communityLabel: nodeCommunity.has(n.id)
        ? communityLabels.get(nodeCommunity.get(n.id)!)
        : undefined,
      meta: n.meta,
    }));

    const edges: DeepGraphData["edges"] = quick.edges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
      relation: e.label,
      confidence: "EXTRACTED" as const,
      confidenceScore: 1.0,
      weight: e.weight,
    }));

    const result: DeepGraphData = {
      nodes,
      edges,
      communities,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        totalCommunities: communities.length,
        extractionMethod: "graphify-cluster",
      },
    };

    // Cache result
    try {
      writeFileSync(graphifyCachePath(kbId), JSON.stringify(result));
    } catch { /* ignore cache errors */ }

    onProgress?.(`完成: ${nodes.length} 节点, ${communities.length} 社区`);
    return result;
  } catch (err) {
    console.warn(`[Graphify] Error:`, err);
    return localFallback(quick);
  }
}

function localFallback(quick: ReturnType<typeof buildWikiGraph>): DeepGraphData {
  return {
    nodes: quick.nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, meta: n.meta })),
    edges: quick.edges.map((e) => ({
      source: e.source, target: e.target, label: e.label, relation: e.label,
      confidence: "EXTRACTED" as const, confidenceScore: 1.0, weight: e.weight,
    })),
    communities: [],
    stats: {
      totalNodes: quick.nodes.length,
      totalEdges: quick.edges.length,
      totalCommunities: 0,
      extractionMethod: "local",
    },
  };
}

/**
 * Get cached graphify results for a KB.
 */
export function getCachedGraphifyResult(kbId: string): DeepGraphData | null {
  const cachePath = graphifyCachePath(kbId);
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8"));
  } catch { return null; }
}

/**
 * Get graph data using local extraction only.
 */
export function getLocalGraphData(kbId: string): DeepGraphData {
  return localFallback(buildWikiGraph(kbId));
}
