/**
 * DAG Dashboard — real-time visual DAG execution viewer.
 * Pure HTML/CSS/JS, no build step, served inline.
 */

export function getDAGDashboardHTML(projectName: string, port: number, opts?: { liveMode?: boolean }): string {
  const liveMode = opts?.liveMode === true;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName} — DAG Runner</title>
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --surface2: #1a1a26;
      --border: #2a2a3a;
      --text: #e0e0e8;
      --text-dim: #8888a0;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.3);
      --green: #22c55e;
      --green-glow: rgba(34, 197, 94, 0.3);
      --yellow: #eab308;
      --yellow-glow: rgba(234, 179, 8, 0.3);
      --red: #ef4444;
      --red-glow: rgba(239, 68, 68, 0.3);
      --blue: #3b82f6;
      --blue-glow: rgba(59, 130, 246, 0.3);
      --cyan: #06b6d4;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      overflow-x: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .header h1 {
      font-size: 18px;
      font-weight: 600;
      color: var(--accent);
    }

    .header .subtitle {
      font-size: 12px;
      color: var(--text-dim);
      margin-left: 12px;
    }

    .controls {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .topic-input {
      width: 420px;
      max-width: 100%;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface2);
      color: var(--text);
      font-family: inherit;
      font-size: 12px;
    }

    .run-actions {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      margin-left: auto;
    }

    select, button {
      font-family: inherit;
      font-size: 13px;
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface2);
      color: var(--text);
      cursor: pointer;
      transition: all 0.2s;
    }

    button:hover { border-color: var(--accent); }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
      font-weight: 600;
    }
    button.primary:hover { opacity: 0.9; }
    button.primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .main {
      display: grid;
      grid-template-columns: 1fr 360px;
      height: calc(100vh - 57px);
    }

    /* ── DAG Canvas ── */
    .dag-canvas {
      position: relative;
      overflow: auto;
      padding: 24px;
      display: grid;
      grid-template-columns: ${liveMode ? "380px 1fr" : "1fr"};
      gap: 20px;
      align-items: start;
    }

    .dag-container {
      position: relative;
      min-width: 100%;
      min-height: 100%;
    }

    .center-preview {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      min-height: 620px;
      padding: 10px;
      display: ${liveMode ? "block" : "none"};
    }
    .center-preview h3 {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    svg.edges {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 1;
    }

    svg.edges line, svg.edges path {
      stroke: var(--border);
      stroke-width: 2;
      fill: none;
      transition: stroke 0.5s, stroke-width 0.5s;
    }

    svg.edges line.active, svg.edges path.active {
      stroke: var(--green);
      stroke-width: 2.5;
      filter: drop-shadow(0 0 4px var(--green-glow));
    }

    svg.edges path.dimmed {
      opacity: 0.15;
    }

    svg.edges marker path {
      fill: var(--border);
    }

    /* ── Block Nodes ── */
    .block-node {
      position: absolute;
      width: 240px;
      background: var(--surface);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      z-index: 2;
      transition: all 0.5s ease;
      cursor: pointer;
    }

    .block-node.status-pending {
      border-color: var(--border);
      opacity: 0.9;
    }

    .block-node.status-ready {
      border-color: var(--blue);
      box-shadow: 0 0 12px var(--blue-glow);
      opacity: 0.8;
    }

    .block-node.status-running {
      border-color: var(--yellow);
      box-shadow: 0 0 20px var(--yellow-glow);
      opacity: 1;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .block-node.status-completed {
      border-color: var(--green);
      box-shadow: 0 0 16px var(--green-glow);
      opacity: 1;
    }

    .block-node.status-failed {
      border-color: var(--red);
      box-shadow: 0 0 16px var(--red-glow);
      opacity: 1;
    }

    .block-node.status-retrying {
      border-color: var(--yellow);
      box-shadow: 0 0 20px var(--yellow-glow);
      animation: pulse 0.8s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.02); }
    }

    .block-name {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .block-id {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 6px;
    }

    .block-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--border);
    }

    .status-pending .status-dot { background: var(--text-dim); }
    .status-running .status-dot { background: var(--yellow); animation: blink 1s infinite; }
    .status-completed .status-dot { background: var(--green); }
    .status-failed .status-dot { background: var(--red); }
    .status-retrying .status-dot { background: var(--yellow); animation: blink 0.5s infinite; }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .block-meta {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-dim);
    }

    .block-insight {
      margin-top: 6px;
      font-size: 10px;
      color: #fca5a5;
      min-height: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .block-ports {
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .port-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .port {
      font-size: 10px;
      color: var(--text-dim);
      padding: 2px 4px;
      border-radius: 3px;
      background: var(--surface2);
      max-width: 104px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .port.in { border-left: 2px solid var(--cyan); }
    .port.out { border-right: 2px solid var(--accent); }

    /* ── Side Panel ── */
    .side-panel {
      background: var(--surface);
      border-left: 1px solid var(--border);
      overflow-y: auto;
      padding: 16px;
    }

    .panel-section {
      margin-bottom: 20px;
    }

    .panel-section h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-dim);
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }

    .run-info {
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .run-info .label {
      color: var(--text-dim);
      display: inline-block;
      width: 70px;
    }

    .run-state-pill {
      display: inline-block;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 11px;
      line-height: 18px;
      text-transform: lowercase;
      background: var(--surface2);
    }
    .run-state-pending, .run-state-running { border-color: var(--yellow); color: var(--yellow); }
    .run-state-paused_approval { border-color: var(--blue); color: var(--blue); }
    .run-state-completed { border-color: var(--green); color: var(--green); }
    .run-state-iterated { border-color: var(--cyan); color: var(--cyan); }
    .run-state-failed, .run-state-cancelled { border-color: var(--red); color: var(--red); }

    .event-log {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 400px;
      overflow-y: auto;
    }

    .event-entry {
      font-size: 11px;
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--surface2);
      border-left: 3px solid var(--border);
    }

    .event-entry.block-start { border-left-color: var(--yellow); }
    .event-entry.block-complete { border-left-color: var(--green); }
    .event-entry.block-fail { border-left-color: var(--red); }
    .event-entry.run-start { border-left-color: var(--blue); }
    .event-entry.run-complete { border-left-color: var(--green); }
    .event-entry.run-fail { border-left-color: var(--red); }

    .event-time {
      color: var(--text-dim);
      font-size: 10px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .stat-card {
      background: var(--surface2);
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--accent);
    }

    .stat-label {
      font-size: 10px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-dim);
      text-align: center;
      gap: 12px;
    }

    .empty-state .icon {
      font-size: 48px;
      opacity: 0.3;
    }

    /* Speed control */
    .speed-control {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-dim);
    }

    input[type="range"] {
      width: 80px;
      accent-color: var(--accent);
    }

    @media (max-width: 1100px) {
      .header {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .controls {
        justify-content: flex-start;
      }
      .topic-input {
        flex: 1 1 100%;
        min-width: 220px;
      }
      .run-actions {
        margin-left: 0;
        position: sticky;
        right: 0;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:baseline">
      <h1>⚡ ${projectName}</h1>
      <span class="subtitle">${liveMode ? "DAG Live View" : "DAG Runner"}</span>
    </div>
    <div class="controls">
      <select id="dagSelect">
        <option value="">Select a DAG...</option>
        <option value="coding-pipeline.yaml">coding-pipeline</option>
        <option value="research-pipeline.yaml">research-pipeline</option>
        <option value="content-pipeline.yaml">content-pipeline</option>
      </select>
      <select id="providerSelect" disabled>
        <option value="openclaw">🦞 OpenClaw (real agents)</option>
      </select>
      <input id="topicInput" class="topic-input" placeholder="Enter pipeline input (e.g., research about cats vs dogs)" />
      <label style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:6px"><input type="checkbox" id="devModeToggle" /> dev mode</label>
      <label style="font-size:11px;color:var(--text-dim)">filter
        <select id="viewFilter" style="margin-left:4px;padding:4px 6px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:11px">
          <option value="all">all</option>
          <option value="active">active</option>
          <option value="failed">failed</option>
          <option value="failedPath">failed-path</option>
        </select>
      </label>
      <div style="display:flex;gap:4px;align-items:center">
        <button id="zoomOutBtn" style="padding:4px 8px">−</button>
        <button id="zoomResetBtn" style="padding:4px 8px">100%</button>
        <button id="zoomInBtn" style="padding:4px 8px">＋</button>
        <button id="zoomFitBtn" style="padding:4px 8px">Fit</button>
      </div>
      <div class="run-actions">
        <button class="primary" id="runBtn" disabled>▶ Run DAG</button>
        <button id="stopBtn" style="display:none;background:var(--red);border-color:var(--red);color:white;font-weight:600">■ Stop</button>
        <button id="refreshRunBtn" title="Refresh current run status from API">↻ Refresh</button>
      </div>
    </div>
  </div>

  <div id="approvalBanner" style="display:none;padding:10px 16px;border-bottom:1px solid var(--border);background:rgba(59,130,246,.12);color:#bfdbfe;font-size:13px;font-weight:600">
    ⏸ Waiting for approval at block: <span id="approvalBannerBlock">—</span>
  </div>

  <div id="streamToast" style="display:none;position:fixed;right:16px;bottom:16px;z-index:9999;background:rgba(10,14,26,.96);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:12px;box-shadow:0 6px 24px rgba(0,0,0,.35)"></div>

  <div class="main">
    <div class="dag-canvas" id="dagCanvas">
      <div class="empty-state" id="emptyState">
        <div class="icon">◇</div>
        <div>Select a DAG and hit Run</div>
        <div style="font-size:12px">Watch blocks execute in real time</div>
      </div>
      <div class="dag-container" id="dagContainer" style="display:none">
        <svg class="edges" id="edgesSvg">
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <path d="M0,0 L10,3.5 L0,7" fill="var(--border)" />
            </marker>
            <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <path d="M0,0 L10,3.5 L0,7" fill="var(--green)" />
            </marker>
          </defs>
        </svg>
      </div>

      <div class="center-preview" id="centerPreviewPane">
        <h3>Live Product Preview</h3>
        <div id="previewHint" style="font-size:12px;color:var(--text-dim);padding:6px 0">Waiting for visual artifact...</div>
        <iframe id="livePreviewFrame" style="display:none;width:100%;height:560px;border:1px solid var(--border);border-radius:6px;background:white"></iframe>
        <img id="livePreviewImage" style="display:none;width:100%;max-height:560px;object-fit:contain;border:1px solid var(--border);border-radius:6px;background:#111" />
        <pre id="livePreviewText" style="display:none;max-height:520px;overflow:auto;background:var(--surface2);padding:8px;border-radius:6px;font-size:11px;line-height:1.4"></pre>
        <div style="font-size:10px;color:var(--text-dim);margin-top:6px">Source: <span id="livePreviewSource">—</span></div>
      </div>
    </div>

    <div class="side-panel">
      <div class="panel-section">
        <h3>Run Status</h3>
        <div class="stats-grid" id="statsGrid">
          <div class="stat-card"><div class="stat-value" id="statTotal">0</div><div class="stat-label">Blocks</div></div>
          <div class="stat-card"><div class="stat-value" id="statDone" style="color:var(--green)">0</div><div class="stat-label">Completed</div></div>
          <div class="stat-card"><div class="stat-value" id="statRunning" style="color:var(--yellow)">0</div><div class="stat-label">Running</div></div>
          <div class="stat-card"><div class="stat-value" id="statFailed" style="color:var(--red)">0</div><div class="stat-label">Failed</div></div>
        </div>
        <div class="run-info" id="runInfo" style="margin-top:12px">
          <div><span class="label">Run ID:</span> <span id="runId">—</span></div>
          <div><span class="label">DAG:</span> <span id="runDag">—</span></div>
          <div><span class="label">Status:</span> <span id="runStatus" class="run-state-pill">—</span></div>
          <div><span class="label">Stream:</span> <span id="streamStatus">disconnected</span></div>
          <div><span class="label">Last evt:</span> <span id="lastEventAt">—</span></div>
          <div><span class="label">Elapsed:</span> <span id="runElapsed">—</span></div>
          <div><span class="label">Cycle:</span> <span id="runCycle">1/—</span></div>
          <div><span class="label">Run chain:</span> <span id="runChain">—</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            <button id="jumpRootBtn" style="padding:4px 8px;font-size:11px">root</button>
            <button id="jumpParentBtn" style="padding:4px 8px;font-size:11px">parent</button>
            <button id="jumpLatestBtn" style="padding:4px 8px;font-size:11px">latest</button>
          </div>
          <div style="margin-top:4px"><label style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:4px"><input type="checkbox" id="followLatestIterated" checked /> follow latest iterated run</label></div>
        </div>
        <div id="iterationHistory" style="margin-top:8px;font-size:11px;color:var(--text-dim);max-height:120px;overflow:auto;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
          No iteration history yet
        </div>
        <div id="approvalPanel" style="display:none;margin-top:10px;padding:8px;border:1px solid var(--yellow);border-radius:6px;background:rgba(234,179,8,0.08)">
          <div style="font-size:11px;color:var(--yellow);margin-bottom:4px">Waiting for approval</div>
          <div id="approvalText" style="font-size:11px;color:var(--text);margin-bottom:8px"></div>
          <textarea id="approvalFeedback" placeholder="If rejecting, what should change?" style="width:100%;min-height:56px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:11px"></textarea>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
            <label style="font-size:11px;color:var(--text-dim)">On reject
              <select id="approvalRestartMode" style="margin-left:4px;padding:4px 6px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:11px">
                <option value="refine">refine current draft</option>
                <option value="from_scratch">restart from scratch</option>
              </select>
            </label>
            <label style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:4px">
              <input type="checkbox" id="approvalIterate" checked /> auto-iterate
            </label>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button id="approveBtn" style="padding:6px 10px;background:var(--green);border-color:var(--green);color:white">Approve</button>
            <button id="rejectBtn" style="padding:6px 10px;background:var(--red);border-color:var(--red);color:white">Reject</button>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <h3>Event Log</h3>
        <div class="event-log" id="eventLog">
          <div style="font-size:12px;color:var(--text-dim);text-align:center;padding:20px">
            No events yet
          </div>
        </div>
      </div>

      <div class="panel-section">
        <h3>Block Inspector</h3>
        <div id="inspectorEmpty" style="font-size:12px;color:var(--text-dim);padding:8px 0">Click any block node to inspect full JSON</div>
        <div id="inspector" style="display:none">
          <div style="font-size:12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
            <b id="inspectorTitle">—</b>
            <button id="copyInspectorBtn" style="padding:4px 8px;font-size:11px">Copy JSON</button>
          </div>
          <pre id="inspectorJson" style="max-height:240px;overflow:auto;background:var(--surface2);padding:8px;border-radius:6px;font-size:10px;line-height:1.4"></pre>
          <div style="font-size:11px;margin:8px 0 4px;color:var(--text-dim)">Final Output (terminal block)</div>
          <pre id="finalOutputJson" style="max-height:140px;overflow:auto;background:var(--surface2);padding:8px;border-radius:6px;font-size:10px;line-height:1.4"></pre>
        </div>
      </div>

      <div class="panel-section">
        <h3>Network Log</h3>
        <div class="event-log" id="networkLog">
          <div style="font-size:12px;color:var(--text-dim);text-align:center;padding:20px">
            No API calls yet
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const API = '';
    const LIVE_MODE = ${liveMode ? "true" : "false"};
    let currentDag = null;
    let currentRunId = null;
    let currentRunData = null;
    let eventSource = null;
    let runStartTime = null;
    let elapsedInterval = null;
    let livePoll = null;
    let pendingApproval = null;
    let staleRunDetected = false;
    let latestBlockErrors = {};
    let lastSseEventAt = 0;
    let sseWatchdog = null;
    let dagZoom = 1;
    let currentFilter = 'all';
    let followSwitchInFlight = false;
    let toastTimer = null;
    let lastPreviewSignature = null;

    function setApprovalBanner(show, blockId) {
      const bar = document.getElementById('approvalBanner');
      const block = document.getElementById('approvalBannerBlock');
      if (!bar || !block) return;
      bar.style.display = show ? 'block' : 'none';
      if (show) block.textContent = blockId || 'unknown';
    }

    function showToast(msg, ms = 2600) {
      const el = document.getElementById('streamToast');
      if (!el) return;
      el.textContent = msg;
      el.style.display = 'block';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
    }

    function setRunStatus(status) {
      const el = document.getElementById('runStatus');
      if (!el) return;
      const normalized = (status || '—').toString();
      el.textContent = normalized;
      el.className = 'run-state-pill run-state-' + normalized;
    }

    function setStreamStatus(text) {
      const el = document.getElementById('streamStatus');
      if (el) el.textContent = text;
    }

    function markEventSeen(ts) {
      const t = ts ? new Date(ts) : new Date();
      const el = document.getElementById('lastEventAt');
      if (el) el.textContent = t.toLocaleTimeString();
    }

    // Load examples
    async function loadDagByFile(file) {
      if (!file) {
        document.getElementById('runBtn').disabled = true;
        currentDag = null;
        return;
      }
      const res = await apiFetch(API + '/api/dag/examples/' + file);
      if (!res.ok) throw new Error('Failed to load DAG: ' + file);
      const { dag, order } = await res.json();
      currentDag = { ...dag, order, file };
      document.getElementById('runBtn').disabled = false;
      renderDAG(dag);
    }

    async function loadExamples() {
      const res = await apiFetch(API + '/api/dag/examples');
      const { examples } = await res.json();
      const sel = document.getElementById('dagSelect');
      const existing = new Set(Array.from(sel.options).map(o => o.value));
      for (const ex of examples) {
        if (existing.has(ex.file)) continue;
        const opt = document.createElement('option');
        opt.value = ex.file;
        opt.textContent = ex.name;
        sel.appendChild(opt);
      }

      // Auto-load currently selected DAG (important when browser restores select state)
      if (sel.value) {
        await loadDagByFile(sel.value).catch((err) => {
          addEventLog({ type: 'run:fail', run_id: 'ui', data: { status: err.message }, timestamp: new Date().toISOString() });
        });
      }
    }

    document.getElementById('dagSelect').addEventListener('change', async (e) => {
      await loadDagByFile(e.target.value).catch((err) => {
        addEventLog({ type: 'run:fail', run_id: 'ui', data: { status: err.message }, timestamp: new Date().toISOString() });
      });
    });

    document.getElementById('runBtn').addEventListener('click', runDAG);
    document.getElementById('stopBtn').addEventListener('click', stopDAG);
    document.getElementById('refreshRunBtn').addEventListener('click', () => refreshRunData());
    document.getElementById('jumpRootBtn').addEventListener('click', () => jumpRunByChain('root'));
    document.getElementById('jumpParentBtn').addEventListener('click', () => jumpRunByChain('parent'));
    document.getElementById('jumpLatestBtn').addEventListener('click', () => jumpRunByChain('latest'));
    document.getElementById('topicInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const runBtn = document.getElementById('runBtn');
      const stopBtn = document.getElementById('stopBtn');
      if (!runBtn.disabled && stopBtn.style.display === 'none') runDAG();
    });
    document.getElementById('approveBtn').addEventListener('click', () => decideApproval('approve'));
    document.getElementById('rejectBtn').addEventListener('click', () => decideApproval('reject'));
    document.getElementById('copyInspectorBtn').addEventListener('click', copyInspectorJson);
    document.getElementById('viewFilter').addEventListener('change', (e) => { currentFilter = e.target.value; applyViewFilter(); });
    document.getElementById('zoomInBtn').addEventListener('click', () => setDagZoom(dagZoom + 0.1));
    document.getElementById('zoomOutBtn').addEventListener('click', () => setDagZoom(dagZoom - 0.1));
    document.getElementById('zoomResetBtn').addEventListener('click', () => setDagZoom(1));
    document.getElementById('zoomFitBtn').addEventListener('click', fitDagToView);

    // OpenClaw-only mode for now (no mock toggle)


    // Wrapped fetch that logs to network panel
    async function apiFetch(url, options = {}) {
      const method = options.method || 'GET';
      const startMs = Date.now();
      const noisyRunPoll = method === 'GET' && url.includes('/api/dag/runs/');
      if (!noisyRunPoll) logNetwork(method, url, 'pending');

      try {
        const res = await fetch(url, options);
        const elapsed = Date.now() - startMs;
        const body = await res.clone().text();

        // Suppress repetitive poll spam in network log
        if (!noisyRunPoll) {
          logNetwork(method, url, res.status + ' (' + elapsed + 'ms)', body.slice(0, 200));
        }

        // If run disappeared (stale id), stop live polling/stream cleanly (once)
        if (noisyRunPoll && res.status === 404 && !staleRunDetected) {
          staleRunDetected = true;
          handleStaleRun();
        }

        return res;
      } catch (err) {
        logNetwork(method, url, 'FAILED: ' + err.message);
        throw err;
      }
    }

    function logNetwork(method, url, status, preview) {
      const log = document.getElementById('networkLog');
      if (log.querySelector('div[style]')) log.innerHTML = '';

      const entry = document.createElement('div');
      const isOk = typeof status === 'string' && (status.startsWith('2') || status === 'pending');
      entry.className = 'event-entry ' + (status === 'pending' ? 'block-start' : isOk ? 'block-complete' : 'block-fail');

      const time = new Date().toLocaleTimeString();
      let html = '<span class="event-time">' + time + '</span> <b>' + method + '</b> ' + url.replace(API, '') + ' → ' + status;
      if (preview) {
        html += '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;word-break:break-all">' + escapeHtml(preview) + '</div>';
      }
      entry.innerHTML = html;
      log.insertBefore(entry, log.firstChild);
    }

    async function copyInspectorJson() {
      const text = document.getElementById('inspectorJson')?.textContent || '';
      if (!text.trim()) return;
      const btn = document.getElementById('copyInspectorBtn');
      try {
        await navigator.clipboard.writeText(text);
        if (btn) {
          const prev = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = prev || 'Copy JSON'; }, 1200);
        }
      } catch {
        if (btn) {
          const prev = btn.textContent;
          btn.textContent = 'Copy failed';
          setTimeout(() => { btn.textContent = prev || 'Copy JSON'; }, 1200);
        }
      }
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function handleStaleRun() {
      if (livePoll) { clearInterval(livePoll); livePoll = null; }
      if (sseWatchdog) { clearInterval(sseWatchdog); sseWatchdog = null; }
      if (eventSource) { eventSource.close(); eventSource = null; }
      setStreamStatus('disconnected');
      currentRunId = null;
      pendingApproval = null;
      setApprovalBanner(false);
      setRunStatus('stale-run');
      document.getElementById('runBtn').disabled = false;
      document.getElementById('runBtn').textContent = '▶ Run DAG';
      document.getElementById('stopBtn').style.display = 'none';
      const panel = document.getElementById('approvalPanel');
      if (panel) panel.style.display = 'none';
      clearInterval(elapsedInterval);
      addEventLog({
        type: 'run:fail',
        run_id: 'stale',
        data: { status: 'Run not found (likely server restart). Start a new run.' },
        timestamp: new Date().toISOString(),
      });
    }

    async function stopDAG() {
      if (!currentRunId) return;
      await apiFetch(API + '/api/dag/runs/' + currentRunId + '/stop', { method: 'POST' });
      document.getElementById('stopBtn').style.display = 'none';
      document.getElementById('runBtn').disabled = false;
      document.getElementById('runBtn').textContent = '▶ Run DAG';
      clearInterval(elapsedInterval);
    }

    async function decideApproval(decision) {
      if (!currentRunId) return;
      const feedback = (document.getElementById('approvalFeedback')?.value || '').trim();
      const restart_mode = document.getElementById('approvalRestartMode')?.value || 'refine';
      const iterate = document.getElementById('approvalIterate')?.checked !== false;

      const res = await apiFetch(API + '/api/dag/runs/' + currentRunId + '/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, feedback, restart_mode, iterate })
      });
      const data = await res.json().catch(() => ({}));

      pendingApproval = null;
      setApprovalBanner(false);
      document.getElementById('approvalPanel').style.display = 'none';
      const fbEl = document.getElementById('approvalFeedback');
      if (fbEl) fbEl.value = '';

      // Auto-follow iterated run when backend spawns a new cycle
      if (data && data.iterated_run_id) {
        currentRunId = data.iterated_run_id;
        document.getElementById('runId').textContent = currentRunId;
        setRunStatus('running');
        setupSSE(currentRunId);
        addEventLog({
          type: 'run:start',
          run_id: currentRunId,
          data: { status: 'Iterated run started', from_reject: true },
          timestamp: new Date().toISOString(),
        });
      }
    }

    function setupSSE(runId) {
      if (!runId) return;
      if (eventSource) { eventSource.close(); eventSource = null; }
      if (sseWatchdog) { clearInterval(sseWatchdog); sseWatchdog = null; }
      const sseUrl = API + '/api/dag/runs/' + runId + '/events';
      setStreamStatus('connecting…');
      logNetwork('SSE', sseUrl, 'connecting');
      eventSource = new EventSource(sseUrl);
      eventSource.onopen = () => {
        lastSseEventAt = Date.now();
        setStreamStatus('connected');
        markEventSeen();
        logNetwork('SSE', sseUrl, 'connected');
        if (livePoll) { clearInterval(livePoll); livePoll = null; }
      };
      eventSource.onerror = () => {
        setStreamStatus('reconnecting…');
        showToast('Live event stream disconnected — reconnecting…');
      };

      const onSseEvent = (handler) => (e) => {
        lastSseEventAt = Date.now();
        handler(JSON.parse(e.data));
      };
      eventSource.addEventListener('block:start', onSseEvent(handleEvent));
      eventSource.addEventListener('block:complete', onSseEvent(handleEvent));
      eventSource.addEventListener('block:fail', onSseEvent(handleEvent));
      eventSource.addEventListener('approval:requested', onSseEvent(handleEvent));
      eventSource.addEventListener('approval:decided', onSseEvent(handleEvent));
      eventSource.addEventListener('run:start', onSseEvent(handleEvent));
      eventSource.addEventListener('run:complete', onSseEvent(handleRunEnd));
      eventSource.addEventListener('run:fail', onSseEvent(handleRunEnd));

      sseWatchdog = setInterval(async () => {
        if (!currentRunId) return;
        const staleFor = Date.now() - lastSseEventAt;
        if (staleFor > 5000 && !livePoll) {
          setStreamStatus('polling fallback');
          showToast('Switched to polling fallback (stream stale)');
          livePoll = setInterval(async () => {
            await refreshRunData();
            if (LIVE_MODE) focusActiveBlock();
          }, 2000);
          addEventLog({ type: 'transport:warn', run_id: currentRunId, data: { status: 'SSE stale, fallback polling enabled' }, timestamp: new Date().toISOString() });
        }
      }, 1500);
    }

    function jumpRunByChain(kind) {
      const run = currentRunData?.run;
      if (!run) return;
      const root = run?.context?.__iteration_root_run_id;
      const parent = run?.context?.__iteration_parent_run_id;
      const latest = run?.context?.__latest_iterated_run_id;
      const target = kind === 'root' ? root : kind === 'parent' ? parent : latest;
      if (!target || target === currentRunId) return;
      currentRunId = String(target);
      document.getElementById('runId').textContent = currentRunId;
      setupSSE(currentRunId);
      refreshRunData();
      addEventLog({ type: 'run:start', run_id: currentRunId, data: { status: 'Jumped to ' + kind + ' run' }, timestamp: new Date().toISOString() });
    }

    async function runDAG() {
      if (!currentDag) {
        const sel = document.getElementById('dagSelect');
        if (sel && sel.value) {
          await loadDagByFile(sel.value).catch(() => {});
        }
      }
      if (!currentDag) return;

      const btn = document.getElementById('runBtn');
      try {
        staleRunDetected = false;
        btn.disabled = true;
        btn.textContent = '⏳ Running...';
        document.getElementById('stopBtn').style.display = 'inline-block';

      // Reset UI
      latestBlockErrors = {};
      document.getElementById('eventLog').innerHTML = '';
      document.getElementById('networkLog').innerHTML = '';
      const cycleEl = document.getElementById('runCycle'); if (cycleEl) cycleEl.textContent = '1/5';
      const histEl = document.getElementById('iterationHistory'); if (histEl) histEl.textContent = 'No iteration history yet';
      if (LIVE_MODE) {
        const hint = document.getElementById('previewHint');
        const frame = document.getElementById('livePreviewFrame');
        const img = document.getElementById('livePreviewImage');
        const txt = document.getElementById('livePreviewText');
        const src = document.getElementById('livePreviewSource');
        if (hint) { hint.style.display = 'block'; hint.textContent = 'Waiting for visual artifact...'; }
        if (frame) { frame.style.display = 'none'; frame.src = 'about:blank'; frame.srcdoc = ''; }
        if (img) { img.style.display = 'none'; img.src = ''; }
        if (txt) { txt.style.display = 'none'; txt.textContent = ''; }
        if (src) src.textContent = '—';
      }
      runStartTime = Date.now();
      updateElapsed();
      elapsedInterval = setInterval(updateElapsed, 100);

      const providerMode = 'openclaw';
      const userTopic = (document.getElementById('topicInput').value || '').trim();

      // Build request body (OpenClaw real-agent mode only)
      const reqBody = {
        example: currentDag.file,
        context: buildContext(currentDag.name, userTopic),
        provider: providerMode,
        timeoutSeconds: 300,
      };
      if (document.getElementById('devModeToggle')?.checked) reqBody.devMode = true;

      const res = await apiFetch(API + '/api/dag/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || ('Run failed to start (HTTP ' + res.status + ')'));
      }
      currentRunId = data.run_id;
      currentRunData = null;

      // SSE-first mode: no default polling. Poll only as fallback via watchdog.
      if (livePoll) { clearInterval(livePoll); livePoll = null; }
      document.getElementById('runId').textContent = data.run_id.slice(0, 16);
      document.getElementById('runDag').textContent = data.dag_name;
      setRunStatus('running');
      document.getElementById('statTotal').textContent = data.blocks.length;

      // Connect SSE
      setupSSE(data.run_id);

      } catch (err) {
        btn.disabled = false;
        btn.textContent = '▶ Run DAG';
        document.getElementById('stopBtn').style.display = 'none';
        setStreamStatus('disconnected');
        clearInterval(elapsedInterval);
        const msg = err?.message || String(err);
        setRunStatus('failed');
        addEventLog({ type: 'run:fail', run_id: 'ui', data: { status: msg }, timestamp: new Date().toISOString() });
      }
    }

    function handleEvent(event) {
      markEventSeen(event.timestamp);
      if (event.type === 'approval:requested') {
        pendingApproval = event.data;
        setApprovalBanner(true, event.block_id || event.data?.block_id || 'unknown');
        document.getElementById('approvalPanel').style.display = 'block';
        document.getElementById('approvalText').textContent = (event.data.prompt || 'Approval needed') + ' [' + (event.block_id || '') + ']';
      }

      if (event.type === 'block:fail' && event.block_id) {
        latestBlockErrors[event.block_id] = {
          error: event.data?.error || null,
          error_code: event.data?.error_code || null,
          error_stage: event.data?.error_stage || null,
          error_message: event.data?.error_message || null,
          repair: event.data?.repair || null,
          contract_trace: event.data?.contract_trace || null,
          raw_output_preview: event.data?.raw_output_preview || null,
          provider_exit_code: event.data?.provider_exit_code || null,
          attempt: event.data?.attempt || null,
          max_attempts: event.data?.max_attempts || null,
          failed_at: event.data?.failed_at || event.timestamp,
          at: event.timestamp,
        };
      }
      if (event.type === 'approval:decided') {
        pendingApproval = null;
        setApprovalBanner(false);
        document.getElementById('approvalPanel').style.display = 'none';
      }

      // Update block visual
      if (event.block_id) {
        const node = document.getElementById('block-' + event.block_id);
        if (node) {
          const status = event.data?.instance?.status ?? event.type.split(':')[1];
          node.className = 'block-node status-' + status;
          const statusEl = node.querySelector('.block-status');
          if (statusEl) {
            statusEl.innerHTML = '<span class="status-dot"></span>' + status;
          }
          // Update assignee/model
          const assignEl = node.querySelector('.block-assignee');
          if (assignEl) {
            // Prefer provider-reported execution identity over planned assignment
            const aid = event.data?.instance?.execution?.agent_id || event.data?.instance?.active_agent_id;
            const mdl = event.data?.instance?.execution?.model || event.data?.instance?.active_model;
            assignEl.textContent = 'agent: ' + (aid || '—') + (mdl ? ' · ' + mdl : '');
          }

          // Update meta
          const metaEl = node.querySelector('.block-meta');
          const insightEl = node.querySelector('.block-insight');
          if (metaEl && event.data?.instance?.execution) {
            const exec = event.data.instance.execution;
            metaEl.textContent = (exec.duration_ms || 0) + 'ms · ' + (exec.tokens_in || 0) + ' tok';
          }
          if (insightEl) {
            if (event.type === 'block:fail') {
              const code = event?.data?.error_code ? '[' + event.data.error_code + '] ' : '';
              insightEl.textContent = code + (event?.data?.error || 'Block failed');
            } else if (event.type === 'block:complete') {
              insightEl.textContent = 'completed';
            } else {
              insightEl.textContent = '';
            }
          }
        }

        // Update edges
        if (event.type === 'block:complete') {
          document.querySelectorAll('.edge-from-' + event.block_id).forEach(el => {
            el.classList.add('active');
            el.setAttribute('marker-end', 'url(#arrowhead-active)');
          });
        }
      }

      // Update stats + fetch latest run JSON snapshot
      updateStats();
      applyViewFilter();
      addEventLog(event);
      refreshRunData().then(() => { if (LIVE_MODE) focusActiveBlock(); });
    }

    function handleRunEnd(event) {
      handleEvent(event);
      clearInterval(elapsedInterval);
      setRunStatus(event.data.status);
      const btn = document.getElementById('runBtn');
      btn.disabled = false;
      btn.textContent = '▶ Run DAG';
      document.getElementById('stopBtn').style.display = 'none';
      refreshRunData().then(() => {
        const failed = Object.entries(currentRunData?.run?.blocks || {}).find(([_, b]) => b.status === 'failed');
        if (failed) return showInspector(failed[0]);
        const terminal = findTerminalBlockId();
        if (terminal) showInspector(terminal);
      });
      if (livePoll) { clearInterval(livePoll); livePoll = null; }
      if (sseWatchdog) { clearInterval(sseWatchdog); sseWatchdog = null; }
      if (eventSource) { eventSource.close(); eventSource = null; }
      setStreamStatus('disconnected');
    }

    function updateStats() {
      const nodes = document.querySelectorAll('.block-node');
      let done = 0, running = 0, failed = 0;
      nodes.forEach(n => {
        if (n.classList.contains('status-completed')) done++;
        else if (n.classList.contains('status-running')) running++;
        else if (n.classList.contains('status-failed')) failed++;
      });
      document.getElementById('statDone').textContent = done;
      document.getElementById('statRunning').textContent = running;
      document.getElementById('statFailed').textContent = failed;
    }

    function setDagZoom(next) {
      dagZoom = Math.max(0.6, Math.min(1.6, next));
      const container = document.getElementById('dagContainer');
      if (container) {
        container.style.transformOrigin = 'top left';
        container.style.transform = 'scale(' + dagZoom.toFixed(2) + ')';
      }
      const reset = document.getElementById('zoomResetBtn');
      if (reset) reset.textContent = Math.round(dagZoom * 100) + '%';
    }

    function fitDagToView() {
      const pane = document.getElementById('dagCanvas');
      const container = document.getElementById('dagContainer');
      if (!pane || !container) return;
      const pw = pane.clientWidth - 40;
      const ph = pane.clientHeight - 40;
      const cw = container.scrollWidth || 1;
      const ch = container.scrollHeight || 1;
      const scale = Math.min(1.6, Math.max(0.6, Math.min(pw / cw, ph / ch)));
      setDagZoom(scale);
    }

    function applyViewFilter() {
      const nodes = Array.from(document.querySelectorAll('.block-node'));

      const failedIds = new Set(nodes.filter((n) => n.classList.contains('status-failed')).map((n) => n.id.replace('block-', '')));
      const pathIds = new Set(failedIds);
      if (currentFilter === 'failedPath') {
        const edges = Array.from(document.querySelectorAll('svg.edges path'));
        // include direct upstream/downstream neighbors of failed nodes
        edges.forEach((p) => {
          const from = p.dataset.from;
          const to = p.dataset.to;
          if (failedIds.has(from) || failedIds.has(to)) {
            if (from) pathIds.add(from);
            if (to) pathIds.add(to);
          }
        });
      }

      nodes.forEach((n) => {
        const isRunning = n.classList.contains('status-running');
        const isFailed = n.classList.contains('status-failed');
        const id = n.id.replace('block-', '');
        const show =
          currentFilter === 'all' ||
          (currentFilter === 'active' && isRunning) ||
          (currentFilter === 'failed' && isFailed) ||
          (currentFilter === 'failedPath' && pathIds.has(id));
        n.style.display = show ? 'block' : 'none';
      });

      const edges = document.querySelectorAll('svg.edges path');
      edges.forEach((p) => {
        const from = p.dataset.from;
        const to = p.dataset.to;
        const fromNode = document.getElementById('block-' + from);
        const toNode = document.getElementById('block-' + to);
        const visible = fromNode && toNode && fromNode.style.display !== 'none' && toNode.style.display !== 'none';
        p.classList.toggle('dimmed', !visible);
      });
    }

    function addEventLog(event) {
      const log = document.getElementById('eventLog');
      if (log.querySelector('div[style]')) log.innerHTML = '';

      const entry = document.createElement('div');
      const cls = event.type.replace(':', '-');
      entry.className = 'event-entry ' + cls;

      const icons = {
        'run:start': '🚀', 'block:start': '⚡', 'block:complete': '✅',
        'block:fail': '❌', 'run:complete': '🎉', 'run:fail': '💥',
        'transport:warn': '⚠️'
      };

      const time = new Date(event.timestamp).toLocaleTimeString();
      const blockLabel = event.block_id ? ' [' + event.block_id + ']' : '';
      const code = event?.data?.error_code ? (' (' + event.data.error_code + ')') : '';
      entry.innerHTML = '<span class="event-time">' + time + '</span> ' +
        (icons[event.type] ?? '·') + ' ' + event.type + blockLabel + code;

      log.insertBefore(entry, log.firstChild);
    }

    function updateElapsed() {
      if (!runStartTime) return;
      const ms = Date.now() - runStartTime;
      const s = (ms / 1000).toFixed(1);
      document.getElementById('runElapsed').textContent = s + 's';
    }

    function showInspector(blockId) {
      if (!currentRunData || !currentRunData.run || !currentRunData.run.blocks) return;
      const block = currentRunData.run.blocks[blockId];
      if (!block) return;

      document.getElementById('inspectorEmpty').style.display = 'none';
      document.getElementById('inspector').style.display = 'block';
      document.getElementById('inspectorTitle').textContent = blockId + ' (' + block.status + ')';

      const details = {
        blockId,
        status: block.status,
        active_agent_id: block.active_agent_id,
        active_model: block.active_model,
        active_provider: block.active_provider,
        transport_provider: block.execution?.transport_provider,
        model_provider: block.execution?.provider,
        schema_guided_mode: block.active_schema_guided === true,
        inputs: block.inputs,
        outputs: block.outputs,
        execution: block.execution,
        pre_gates: block.pre_gate_results,
        post_gates: block.post_gate_results,
        failure: latestBlockErrors[blockId] || null,
      };
      document.getElementById('inspectorJson').textContent = JSON.stringify(details, null, 2);

      // Terminal block output
      const terminalId = findTerminalBlockId();
      const terminal = terminalId ? currentRunData.run.blocks[terminalId] : null;
      document.getElementById('finalOutputJson').textContent = JSON.stringify({
        terminal_block: terminalId,
        outputs: terminal?.outputs ?? null,
        execution: terminal?.execution ?? null,
      }, null, 2);
    }

    function findTerminalBlockId() {
      if (!currentDag) return null;
      const fromSet = new Set((currentDag.edges || []).map(e => e.from));
      const terminals = (currentDag.blocks || []).map(b => b.id).filter(id => !fromSet.has(id));
      return terminals.length ? terminals[0] : null;
    }

    function extractVisualArtifact(blockId, outputs, allowTextFallback = false) {
      if (!outputs || typeof outputs !== 'object') return null;

      // URL-based artifact
      const url = outputs.artifact_url || outputs.preview_url || outputs.url || outputs.deploy_url;
      if (typeof url === 'string' && /^https?:\\/\\//.test(url)) {
        return { kind: 'url', value: url, source: blockId + '.url' };
      }

      // Inline HTML artifact
      const html = outputs.artifact_html || outputs.html || outputs.preview_html || outputs.code;
      if (typeof html === 'string' && /<\\/?(html|div|canvas|script|body)/i.test(html)) {
        return { kind: 'html', value: html, source: blockId + '.html' };
      }

      // Image artifact
      const image = outputs.image_url || outputs.image || outputs.screenshot;
      if (typeof image === 'string' && (image.startsWith('data:image/') || /^https?:\\/\\//.test(image))) {
        return { kind: 'image', value: image, source: blockId + '.image' };
      }

      // Fallback only when no visual artifact exists in any completed block
      if (allowTextFallback) {
        const keys = Object.keys(outputs);
        if (keys.length) return { kind: 'text', value: JSON.stringify(outputs, null, 2), source: blockId + '.outputs' };
      }
      return null;
    }

    function updateLivePreview() {
      if (!LIVE_MODE || !currentRunData?.run?.blocks) return;

      const frame = document.getElementById('livePreviewFrame');
      const img = document.getElementById('livePreviewImage');
      const txt = document.getElementById('livePreviewText');
      const hint = document.getElementById('previewHint');
      const source = document.getElementById('livePreviewSource');

      // Prefer latest completed block that has a VISUAL artifact
      const completed = Object.entries(currentRunData.run.blocks)
        .filter(([_, b]) => b.status === 'completed')
        .sort((a, b) => new Date(a[1].completed_at || 0).getTime() - new Date(b[1].completed_at || 0).getTime());

      let artifact = null;
      for (let i = completed.length - 1; i >= 0; i--) {
        const [blockId, block] = completed[i];
        artifact = extractVisualArtifact(blockId, block.outputs, false);
        if (artifact) break;
      }

      // If no visual artifact exists anywhere, show latest completed block outputs as text
      if (!artifact && completed.length) {
        const [blockId, block] = completed[completed.length - 1];
        artifact = extractVisualArtifact(blockId, block.outputs, true);
      }

      frame.style.display = 'none';
      img.style.display = 'none';
      txt.style.display = 'none';

      if (!artifact) {
        hint.style.display = 'block';
        hint.textContent = 'Waiting for visual artifact...';
        source.textContent = '—';
        return;
      }

      hint.style.display = 'none';
      source.textContent = artifact.source;

      // Prevent constant iframe/image reload while polling: only update media when artifact changed.
      const nextSignature = artifact.kind + '|' + artifact.source + '|' + String(artifact.value || '').slice(0, 1600);
      const changed = nextSignature !== lastPreviewSignature;
      lastPreviewSignature = nextSignature;

      if (artifact.kind === 'url') {
        frame.style.display = 'block';
        if (changed && frame.src !== artifact.value) frame.src = artifact.value;
      } else if (artifact.kind === 'html') {
        frame.style.display = 'block';
        if (changed) frame.srcdoc = artifact.value;
      } else if (artifact.kind === 'image') {
        img.style.display = 'block';
        if (changed && img.src !== artifact.value) img.src = artifact.value;
      } else {
        txt.style.display = 'block';
        if (changed) txt.textContent = artifact.value;
      }
    }

    function updateIterationUI(run) {
      const shared = run?.context?.__shared_memory || {};
      const cycle = Number(shared.cycle || 1);
      const max = Number(shared.max_cycles || 5);
      const cycleEl = document.getElementById('runCycle');
      if (cycleEl) cycleEl.textContent = cycle + '/' + max;

      const chainEl = document.getElementById('runChain');
      if (chainEl) {
        const root = run?.context?.__iteration_root_run_id || run?.id || '—';
        const parent = run?.context?.__iteration_parent_run_id;
        const latest = run?.context?.__latest_iterated_run_id;
        const parts = [root === run?.id ? 'root:this' : ('root:' + String(root).slice(0, 10))];
        if (parent) parts.push('parent:' + String(parent).slice(0, 10));
        if (latest) parts.push('latest:' + String(latest).slice(0, 10));
        chainEl.textContent = parts.join(' → ');
      }

      const historyEl = document.getElementById('iterationHistory');
      if (!historyEl) return;
      const decisions = Array.isArray(shared.decisions) ? shared.decisions : [];
      if (!decisions.length) {
        historyEl.textContent = 'No iteration history yet';
        return;
      }
      historyEl.innerHTML = decisions.slice(-8).reverse().map((d) => {
        const at = (d.at || '').toString().replace('T', ' ').slice(0, 19);
        const dec = d.decision || 'decision';
        const mode = d.restart_mode || 'refine';
        const fb = (d.feedback || '').toString();
        const shortFb = fb.length > 90 ? fb.slice(0, 90) + '…' : fb;
        return '<div style="margin-bottom:6px"><b>' + dec + '</b> · ' + mode + (at ? ' · ' + at : '') + (shortFb ? '<div style="color:var(--text);margin-top:2px">' + shortFb.replace(/</g,'&lt;') + '</div>' : '') + '</div>';
      }).join('');
    }

    async function refreshRunData() {
      if (!currentRunId) return;
      try {
        const res = await apiFetch(API + '/api/dag/runs/' + currentRunId);
        if (!res.ok) return;
        currentRunData = await res.json();

        // Snapshot truth sync (for SSE drops or reconnect gaps)
        const run = currentRunData?.run;
        if (run?.status) {
          setRunStatus(run.status);
          Object.entries(run.blocks || {}).forEach(([id, b]) => {
            const node = document.getElementById('block-' + id);
            if (!node) return;
            node.className = 'block-node status-' + (b.status || 'pending');
            const statusEl = node.querySelector('.block-status');
            if (statusEl) statusEl.innerHTML = '<span class="status-dot"></span>' + (b.status || 'pending');
            const assignEl = node.querySelector('.block-assignee');
            if (assignEl) {
              const aid = b?.execution?.agent_id || b?.active_agent_id;
              const mdl = b?.execution?.model || b?.active_model;
              assignEl.textContent = 'agent: ' + (aid || '—') + (mdl ? ' · ' + mdl : '');
            }
          });
          updateStats();
          applyViewFilter();
          updateIterationUI(run);

          const follow = document.getElementById('followLatestIterated')?.checked === true;
          const latestIterated = run?.context?.__latest_iterated_run_id;
          if (follow && latestIterated && latestIterated !== currentRunId && !followSwitchInFlight) {
            followSwitchInFlight = true;
            currentRunId = latestIterated;
            document.getElementById('runId').textContent = currentRunId;
            setupSSE(currentRunId);
            addEventLog({ type: 'run:start', run_id: currentRunId, data: { status: 'Followed latest iterated run' }, timestamp: new Date().toISOString() });
            setTimeout(() => { followSwitchInFlight = false; }, 400);
            return;
          }

          if (run.status === 'failed' || run.status === 'completed' || run.status === 'cancelled' || run.status === 'iterated') {
            const btn = document.getElementById('runBtn');
            btn.disabled = false;
            btn.textContent = '▶ Run DAG';
            document.getElementById('stopBtn').style.display = 'none';
            if (eventSource) { eventSource.close(); eventSource = null; }
            if (sseWatchdog) { clearInterval(sseWatchdog); sseWatchdog = null; }
            if (livePoll) { clearInterval(livePoll); livePoll = null; }
            clearInterval(elapsedInterval);
          }
        }

        if (currentRunData.approval && currentRunData.approval.status === 'pending') {
          pendingApproval = currentRunData.approval;
          setApprovalBanner(true, pendingApproval.block_id || 'unknown');
          document.getElementById('approvalPanel').style.display = 'block';
          document.getElementById('approvalText').textContent = (pendingApproval.prompt || 'Approval needed') + ' [' + (pendingApproval.block_id || '') + ']';

          // When paused on approval, force-highlight the approval block as paused to avoid stale "running" emphasis.
          if (run?.status === 'paused_approval' && pendingApproval.block_id) {
            const id = String(pendingApproval.block_id);
            const node = document.getElementById('block-' + id);
            if (node) {
              node.className = 'block-node status-paused_approval';
              const statusEl = node.querySelector('.block-status');
              if (statusEl) statusEl.innerHTML = '<span class="status-dot"></span>paused_approval';
              showInspector(id);
            }
          }
        } else {
          setApprovalBanner(false);
        }
        if (LIVE_MODE) updateLivePreview();
      } catch (_) {}
    }

    function focusActiveBlock() {
      if (!currentRunData?.run?.blocks) return;
      const entries = Object.entries(currentRunData.run.blocks);
      const running = entries.find(([_, b]) => b.status === 'running');
      if (running) return showInspector(running[0]);
      const completed = entries.filter(([_, b]) => b.status === 'completed');
      if (completed.length) return showInspector(completed[completed.length - 1][0]);
    }

    // ── DAG Layout & Rendering ──
    function renderDAG(dag) {
      document.getElementById('emptyState').style.display = 'none';
      const container = document.getElementById('dagContainer');
      container.style.display = 'block';
      container.innerHTML = '<svg class="edges" id="edgesSvg"><defs>' +
        '<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><path d="M0,0 L10,3.5 L0,7" fill="var(--border)"/></marker>' +
        '<marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><path d="M0,0 L10,3.5 L0,7" fill="var(--green)"/></marker>' +
        '</defs></svg>';

      // Compute layout using topological layers
      const layers = computeLayers(dag);
      const nodeW = 240, nodeH = 190, gapX = 90, gapY = 70;
      const positions = {};

      // Center each layer
      const maxLayerWidth = Math.max(...layers.map(l => l.length));

      layers.forEach((layer, li) => {
        const layerWidth = layer.length * (nodeW + gapX) - gapX;
        const offsetX = (maxLayerWidth * (nodeW + gapX) - gapX - layerWidth) / 2;

        layer.forEach((blockId, bi) => {
          const x = offsetX + bi * (nodeW + gapX) + 40;
          const y = li * (nodeH + gapY) + 20;
          positions[blockId] = { x, y };

          const blockDef = dag.blocks.find(b => b.id === blockId);
          const node = document.createElement('div');
          node.id = 'block-' + blockId;
          node.className = 'block-node status-pending';
          node.style.left = x + 'px';
          node.style.top = y + 'px';

          const inputs = blockDef.inputs ? Object.keys(blockDef.inputs) : [];
          const outputs = blockDef.outputs ? Object.keys(blockDef.outputs) : [];

          node.innerHTML =
            '<div class="block-name">' + (blockDef.name || blockId) + '</div>' +
            '<div class="block-id">' + blockId + '</div>' +
            '<div class="block-status"><span class="status-dot"></span>pending</div>' +
            '<div class="block-assignee" style="font-size:10px;color:var(--text-dim);margin-top:4px">agent: —</div>' +
            '<div class="block-meta">in:' + inputs.length + ' · out:' + outputs.length + '</div>' +
            '<div class="block-insight"></div>' +
            '<div class="block-ports">' +
              '<div class="port-group">' + inputs.map(p => '<div class="port in" title="' + p + '">← ' + p + '</div>').join('') + '</div>' +
              '<div class="port-group">' + outputs.map(p => '<div class="port out" title="' + p + '">' + p + ' →</div>').join('') + '</div>' +
            '</div>';

          node.addEventListener('click', () => showInspector(blockId));
          container.appendChild(node);
        });
      });

      // Set container size
      const maxX = Math.max(...Object.values(positions).map(p => p.x)) + nodeW + 40;
      const maxY = Math.max(...Object.values(positions).map(p => p.y)) + nodeH + 40;
      container.style.width = maxX + 'px';
      container.style.height = maxY + 'px';

      // Draw edges
      const svg = document.getElementById('edgesSvg');
      svg.setAttribute('width', maxX);
      svg.setAttribute('height', maxY);

      for (const edge of dag.edges) {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) continue;

        const x1 = from.x + nodeW / 2;
        const y1 = from.y + nodeH;
        const x2 = to.x + nodeW / 2;
        const y2 = to.y;

        // Cubic bezier for nice curves
        const midY = (y1 + y2) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2);
        path.setAttribute('marker-end', 'url(#arrowhead)');
        path.classList.add('edge-from-' + edge.from);
        path.dataset.from = edge.from;
        path.dataset.to = edge.to;
        svg.appendChild(path);
      }

      setDagZoom(dagZoom);
      applyViewFilter();
    }

    function computeLayers(dag) {
      // Kahn's algorithm for layer assignment
      const inDeg = {};
      const adj = {};
      for (const b of dag.blocks) {
        inDeg[b.id] = 0;
        adj[b.id] = [];
      }
      for (const e of dag.edges) {
        adj[e.from].push(e.to);
        inDeg[e.to] = (inDeg[e.to] || 0) + 1;
      }

      const layers = [];
      let queue = Object.keys(inDeg).filter(id => inDeg[id] === 0);

      while (queue.length > 0) {
        layers.push([...queue]);
        const nextQueue = [];
        for (const node of queue) {
          for (const neighbor of (adj[node] || [])) {
            inDeg[neighbor]--;
            if (inDeg[neighbor] === 0) nextQueue.push(neighbor);
          }
        }
        queue = nextQueue;
      }

      return layers;
    }

    function buildContext(dagName, userText) {
      const text = userText && userText.length ? userText : null;
      switch (dagName) {
        case 'coding-pipeline':
          return { prompt: text || 'Build a real-time chat widget with WebSocket support' };
        case 'game-builder-pipeline':
          return { prompt: text || 'Build a flappy bird style game with one creative mechanic' };
        case 'research-pipeline':
          return { query: text || 'What are the emerging trends in AI agent frameworks in 2026?' };
        case 'content-pipeline':
          return { topic: text || 'The SaaSpocalypse: How AI Agents Are Replacing Traditional Software' };
        case 'website-builder-pipeline':
          return { topic: text || 'A landing page for OpenSkelo with strong CTA' };
        default:
          return text ? { input: text } : {};
      }
    }

    loadExamples();
  </script>
</body>
</html>`;
}
