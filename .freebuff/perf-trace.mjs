/*
 * Scratch: turn a CDP trace into "what actually cost time during this window".
 *
 * Two views, because they answer different questions:
 *   byName       — the browser's own task names (Paint, RasterTask, Layout,
 *                  UpdateLayerTree, Commit, DrawFrame…) ranked by total time
 *   paintByNode  — Paint/PaintImage time per DOM nodeId, so the expensive
 *                  element can be named instead of guessed
 */

export function collectTrace(events) {
  const complete = [];
  for (const e of events) {
    if (e.method !== "Tracing.dataCollected") continue;
    const value = e.params?.value ?? [];
    for (const ev of value) if (ev.ph === "X" && ev.dur > 0.4) complete.push(ev);
  }

  /*
   * Nesting double-counts (a FunctionCall contains its callees), so each group
   * is reported as the *union* of its intervals: how much wall time the main
   * thread — or a raster worker — was inside that kind of work.
   */
  const GROUPS = {
    js: ["FunctionCall", "v8.callFunction", "EvaluateScript", "TimerFire", "FireAnimationFrame", "EventDispatch"],
    style: ["UpdateLayoutTree", "RecalcStyle", "StyleRecalc", "ParseAuthorStyleSheet"],
    layout: ["Layout", "RunStyleAndLayoutLifecyclePhases", "LocalFrameView::RunStyleAndLayoutLifecyclePhases", "UpdateLayoutTree"],
    paint: ["Paint", "PaintImage", "PrePaint", "LocalFrameView::RunPaintLifecyclePhase", "Layerize"],
    raster: ["RasterTask", "RasterizerTaskImpl::RunOnWorkerThread", "GpuRasterBuffer::Playback", "ImageDecodeTask"],
    composite: ["ProxyMain::BeginMainFrame", "ProxyImpl::ScheduledActionDraw", "MainFrame.Draw", "LayerTreeHostImpl::CommitComplete", "ProxyImpl::ReadyToCommit"],
  };
  const unionMs = (names) => {
    const wanted = new Set(names);
    const spans = complete
      .filter((ev) => wanted.has(ev.name))
      .map((ev) => [ev.ts, ev.ts + ev.dur])
      .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur = null;
    for (const span of spans) {
      if (!cur) cur = [...span];
      else if (span[0] <= cur[1]) cur[1] = Math.max(cur[1], span[1]);
      else {
        total += cur[1] - cur[0];
        cur = [...span];
      }
    }
    if (cur) total += cur[1] - cur[0];
    return Math.round(total / 1000);
  };
  const threadTimeMs = {};
  for (const [group, names] of Object.entries(GROUPS)) threadTimeMs[group] = unionMs(names);

  /* JS calls by name: the top entries are usually the mount / handler itself. */
  const jsByName = new Map();
  for (const ev of complete) {
    if (ev.name !== "FunctionCall" && ev.name !== "v8.callFunction") continue;
    const name = ev.args?.data?.functionName || ev.args?.data?.url || "(anonymous)";
    const g = jsByName.get(name) ?? { name, count: 0, totalMs: 0, maxMs: 0 };
    g.count++;
    g.totalMs += ev.dur / 1000;
    g.maxMs = Math.max(g.maxMs, ev.dur / 1000);
    jsByName.set(name, g);
  }
  const topJs = [...jsByName.values()]
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, 12)
    .map((r) => ({ ...r, totalMs: Math.round(r.totalMs * 10) / 10, maxMs: Math.round(r.maxMs * 10) / 10 }));

  /* The single worst JS call, with everything needed to find its source line. */
  let worstCall = null;
  for (const ev of complete) {
    if (ev.name !== "FunctionCall") continue;
    if (!worstCall || ev.dur > worstCall.dur) {
      worstCall = {
        ts: ev.ts,
        endTs: ev.ts + ev.dur,
        durMs: Math.round((ev.dur / 1000) * 10) / 10,
        functionName: ev.args?.data?.functionName ?? null,
        url: ev.args?.data?.url ?? null,
        scriptId: String(ev.args?.data?.scriptId ?? ""),
        lineNumber: ev.args?.data?.lineNumber ?? null,
        columnNumber: ev.args?.data?.columnNumber ?? null,
      };
    }
  }

  /* Timer work, named separately: ticks that land mid-transition. */
  const timers = complete
    .filter((ev) => ev.name === "TimerFire")
    .map((ev) => Math.round((ev.ts - complete[0].ts) / 1000))
    .slice(0, 20);

  const byName = new Map();
  const paintByNode = new Map();
  for (const ev of complete) {
    const g = byName.get(ev.name) ?? { name: ev.name, count: 0, totalMs: 0, maxMs: 0 };
    g.count++;
    g.totalMs += ev.dur / 1000;
    g.maxMs = Math.max(g.maxMs, ev.dur / 1000);
    byName.set(ev.name, g);

    if (/^(Paint|PaintImage|PrePaint|RasterTask|ImageDecodeTask)$/.test(ev.name)) {
      const nodeId = ev.args?.data?.nodeId ?? ev.args?.nodeId;
      if (nodeId) {
        const key = `${ev.name}:${nodeId}`;
        const p = paintByNode.get(key) ?? { name: ev.name, nodeId, count: 0, totalMs: 0, maxMs: 0 };
        p.count++;
        p.totalMs += ev.dur / 1000;
        p.maxMs = Math.max(p.maxMs, ev.dur / 1000);
        paintByNode.set(key, p);
      }
    }
  }

  const rank = (map, n) =>
    [...map.values()]
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, n)
      .map((r) => ({
        ...r,
        totalMs: Math.round(r.totalMs * 10) / 10,
        maxMs: Math.round(r.maxMs * 10) / 10,
      }));

  /*
   * What happened *inside* the worst call? React reconciles as hundreds of
   * tiny calls, whereas a layout or paint block shows up as a few big tasks.
   * The composition of the interval is what names the culprit.
   */
  const insideWorstCall = worstCall
    ? complete
        .filter((ev) => ev.ts >= worstCall.ts && ev.ts + ev.dur <= worstCall.endTs && ev.dur > 300)
        .sort((a, b) => a.ts - b.ts)
        .slice(0, 40)
        .map((ev) => ({
          atMs: Math.round((ev.ts - worstCall.ts) / 1000),
          name: ev.name,
          durMs: Math.round((ev.dur / 1000) * 10) / 10,
          detail: ev.args?.data?.functionName || ev.args?.data?.type || "",
        }))
    : [];

  /* Browser-thread tasks overlapping the worst call: is the main thread in JS
   * for the whole block, or is it waiting on layout/raster it triggered? */
  const overlappingWorstCall = worstCall
    ? complete
        .filter(
          (ev) =>
            ev.ts < worstCall.endTs &&
            ev.ts + ev.dur > worstCall.ts &&
            /Layout|Paint|UpdateLayerTree|RasterTask|Commit|DrawFrame/.test(ev.name),
        )
        .sort((a, b) => b.dur - a.dur)
        .slice(0, 12)
        .map((ev) => ({
          atMs: Math.round((ev.ts - worstCall.ts) / 1000),
          name: ev.name,
          durMs: Math.round((ev.dur / 1000) * 10) / 10,
        }))
    : [];

  return {
    eventCount: complete.length,
    threadTimeMs,
    worstCall,
    insideWorstCall,
    overlappingWorstCall,
    topJs,
    timerFireAtMs: timers,
    byName: rank(byName, 30),
    paintByNode: rank(paintByNode, 14),
  };
}

/**
 * Turn a CDP CPU profile into "which functions actually burned the main thread".
 *
 * Self time per call frame, grouped by name+location, then each location is
 * resolved back to the *served* chunk text — a minified build only has names
 * like `t`, so the source slice is what makes the ranking readable.
 */
export async function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfUs = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const delta = profile.timeDeltas[i] ?? 0;
    selfUs.set(id, (selfUs.get(id) ?? 0) + delta);
  }

  const groups = new Map();
  for (const [id, us] of selfUs) {
    const node = byId.get(id);
    if (!node) continue;
    const f = node.callFrame;
    const key = `${f.functionName || "(anonymous)"}@${f.url}:${f.lineNumber}:${f.columnNumber}`;
    const g = groups.get(key) ?? {
      name: f.functionName || "(anonymous)",
      url: f.url,
      line: f.lineNumber,
      column: f.columnNumber,
      selfMs: 0,
      samples: 0,
    };
    g.selfMs += us / 1000;
    g.samples++;
    groups.set(key, g);
  }

  const top = [...groups.values()]
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 14)
    .map((g) => ({ ...g, selfMs: Math.round(g.selfMs * 10) / 10 }));

  /* Resolve the top frames that live in our own served chunks. */
  const cache = new Map();
  for (const row of top) {
    if (!row.url || !/^https?:\/\//.test(row.url)) continue;
    try {
      if (!cache.has(row.url)) cache.set(row.url, await (await fetch(row.url)).text());
      const text = cache.get(row.url);
      const start = Math.max(0, row.column - 60);
      row.source = text.slice(start, start + 200).replace(/\s+/g, " ");
    } catch (error) {
      row.source = `<fetch failed: ${error}>`;
    }
  }

  return {
    sampleCount: profile.samples.length,
    windowMs: Math.round(profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000),
    topSelfTime: top,
  };
}

/** The most recent layer-tree snapshot from a batch of collected CDP events. */
export function layerSnapshot(events) {
  let snapshot = null;
  for (const e of events) {
    if (e.method === "LayerTree.layerTreeDidChange" && e.params?.layers) snapshot = e.params.layers;
  }
  return snapshot ?? [];
}

/**
 * Which layer repainted how many times during the window?
 *
 * `paintCount` is cumulative for the life of a layer, so the interesting number
 * is the delta against a snapshot taken before the window opened; a layer that
 * did not exist then starts from zero. Paints are main-thread cost that can
 * hide inside a reading of "the compositor is slow", and `backendNodeId` can be
 * resolved back to the DOM node, which is what makes this actionable.
 */
export function summarizeLayers(events, baseline) {
  const before = new Map((baseline ?? []).map((l) => [l.layerId, l.paintCount ?? 0]));
  const final = layerSnapshot(events);
  const rows = final.map((l) => {
    const base = before.get(l.layerId);
    return {
      layerId: l.layerId,
      node: l.backendNodeId ?? null,
      size: `${l.width}×${l.height}`,
      paintCount: l.paintCount ?? 0,
      baseline: base ?? null,
      paints: (l.paintCount ?? 0) - (base ?? 0),
      created: base === undefined,
    };
  });
  return {
    note: "paints = paintCount delta over the window; created = layer did not exist before it",
    layerCount: final.length,
    rows: rows.sort((a, b) => b.paints - a.paints).slice(0, 20),
  };
}

/** backendNodeId → `div.some.class`, via the DOM domain. */
export async function resolveBackendNodes(session, backendNodeIds) {
  const labels = {};
  try {
    await session.send("DOM.enable");
  } catch {
    /* already enabled */
  }
  for (const backendNodeId of backendNodeIds) {
    try {
      const { node } = await session.send("DOM.describeNode", { backendNodeId, depth: 0 });
      const attrs = node.attributes ?? [];
      const at = attrs.indexOf("class");
      const cls = (at >= 0 ? String(attrs[at + 1] ?? "") : "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(".");
      labels[backendNodeId] = `${node.nodeName.toLowerCase()}${cls ? `.${cls}` : ""}`;
    } catch (error) {
      labels[backendNodeId] = `<backend ${backendNodeId}: ${String(error).slice(0, 50)}>`;
    }
  }
  return labels;
}

/** Fetch the source text around the worst call, so it can be named precisely. */
export async function resolveWorstCall(session, worstCall) {
  if (!worstCall?.scriptId) return null;
  try {
    await session.send("Debugger.enable");
    const { scriptSource } = await session.send("Debugger.getScriptSource", {
      scriptId: worstCall.scriptId,
    });
    const lines = scriptSource.split("\n");
    const line = worstCall.lineNumber ?? 0;
    return {
      ...worstCall,
      scriptLines: lines.length,
      sourceLine: (lines[line] ?? "").trim().slice(0, 220),
      context: lines.slice(Math.max(0, line - 2), line + 3).map((l) => l.trim().slice(0, 160)),
    };
  } catch (error) {
    return { ...worstCall, resolveError: String(error) };
  }
}

export async function resolveNodes(session, nodeIds) {
  const labels = new Map();
  try {
    await session.send("DOM.enable");
  } catch {
    /* already enabled */
  }
  for (const nodeId of nodeIds) {
    try {
      const { node } = await session.send("DOM.describeNode", { nodeId, depth: 0 });
      const attrs = node.attributes ?? [];
      const cls = attrs[attrs.indexOf("class") + 1] ?? "";
      const id = attrs.indexOf("id") >= 0 ? `#${attrs[attrs.indexOf("id") + 1]}` : "";
      const classes = String(cls)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      labels.set(nodeId, `${node.nodeName.toLowerCase()}${id}${classes ? `.${classes}` : ""}`);
    } catch {
      labels.set(nodeId, `<node ${nodeId} (gone)>`);
    }
  }
  return labels;
}
