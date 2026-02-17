/**
 * DAG Dashboard — real-time visual DAG execution viewer.
 * Pure HTML/CSS/JS, no build step, served inline.
 */

export function getDAGDashboardHTML(projectName: string, port: number): string {
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
      padding: 40px;
    }

    .dag-container {
      position: relative;
      min-width: 100%;
      min-height: 100%;
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

    svg.edges marker path {
      fill: var(--border);
    }

    /* ── Block Nodes ── */
    .block-node {
      position: absolute;
      width: 200px;
      background: var(--surface);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      z-index: 2;
      transition: all 0.5s ease;
      cursor: default;
    }

    .block-node.status-pending {
      border-color: var(--border);
      opacity: 0.6;
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
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .block-id {
      font-size: 11px;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .block-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
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
      margin-top: 8px;
      font-size: 11px;
      color: var(--text-dim);
    }

    .block-ports {
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
    }

    .port-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .port {
      font-size: 9px;
      color: var(--text-dim);
      padding: 1px 4px;
      border-radius: 3px;
      background: var(--surface2);
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
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:baseline">
      <h1>⚡ ${projectName}</h1>
      <span class="subtitle">DAG Runner</span>
    </div>
    <div class="controls">
      <select id="dagSelect">
        <option value="">Select a DAG...</option>
      </select>
      <div class="speed-control">
        <span>Speed:</span>
        <input type="range" id="speedSlider" min="1" max="10" value="5">
        <span id="speedLabel">1x</span>
      </div>
      <button class="primary" id="runBtn" disabled>▶ Run DAG</button>
    </div>
  </div>

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
          <div><span class="label">Status:</span> <span id="runStatus">—</span></div>
          <div><span class="label">Elapsed:</span> <span id="runElapsed">—</span></div>
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
    </div>
  </div>

  <script>
    const API = '';
    let currentDag = null;
    let currentRunId = null;
    let eventSource = null;
    let runStartTime = null;
    let elapsedInterval = null;

    // Load examples
    async function loadExamples() {
      const res = await fetch(API + '/api/dag/examples');
      const { examples } = await res.json();
      const sel = document.getElementById('dagSelect');
      for (const ex of examples) {
        const opt = document.createElement('option');
        opt.value = ex.file;
        opt.textContent = ex.name;
        sel.appendChild(opt);
      }
    }

    document.getElementById('dagSelect').addEventListener('change', async (e) => {
      const file = e.target.value;
      if (!file) {
        document.getElementById('runBtn').disabled = true;
        currentDag = null;
        return;
      }
      const res = await fetch(API + '/api/dag/examples/' + file);
      const { dag, order } = await res.json();
      currentDag = { ...dag, order, file };
      document.getElementById('runBtn').disabled = false;
      renderDAG(dag);
    });

    document.getElementById('runBtn').addEventListener('click', runDAG);

    document.getElementById('speedSlider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      const speed = val <= 5 ? (val / 5).toFixed(1) : ((val - 4) * 1).toFixed(0);
      document.getElementById('speedLabel').textContent = speed + 'x';
    });

    async function runDAG() {
      if (!currentDag) return;
      const btn = document.getElementById('runBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Running...';

      // Reset UI
      document.getElementById('eventLog').innerHTML = '';
      runStartTime = Date.now();
      updateElapsed();
      elapsedInterval = setInterval(updateElapsed, 100);

      // Speed → delay mapping
      const speedVal = parseInt(document.getElementById('speedSlider').value);
      const minDelay = speedVal <= 5 ? (6 - speedVal) * 1000 : Math.max(200, 1000 / (speedVal - 4));
      const maxDelay = minDelay * 2.5;

      const res = await fetch(API + '/api/dag/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          example: currentDag.file,
          context: getDefaultContext(currentDag.name),
          minDelay,
          maxDelay,
        }),
      });

      const data = await res.json();
      currentRunId = data.run_id;
      document.getElementById('runId').textContent = data.run_id.slice(0, 16);
      document.getElementById('runDag').textContent = data.dag_name;
      document.getElementById('runStatus').textContent = 'running';
      document.getElementById('statTotal').textContent = data.blocks.length;

      // Connect SSE
      if (eventSource) eventSource.close();
      eventSource = new EventSource(API + '/api/dag/runs/' + data.run_id + '/events');

      eventSource.addEventListener('block:start', (e) => handleEvent(JSON.parse(e.data)));
      eventSource.addEventListener('block:complete', (e) => handleEvent(JSON.parse(e.data)));
      eventSource.addEventListener('block:fail', (e) => handleEvent(JSON.parse(e.data)));
      eventSource.addEventListener('run:start', (e) => handleEvent(JSON.parse(e.data)));
      eventSource.addEventListener('run:complete', (e) => handleRunEnd(JSON.parse(e.data)));
      eventSource.addEventListener('run:fail', (e) => handleRunEnd(JSON.parse(e.data)));
    }

    function handleEvent(event) {
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
          // Update meta
          const metaEl = node.querySelector('.block-meta');
          if (metaEl && event.data?.instance?.execution) {
            const exec = event.data.instance.execution;
            metaEl.textContent = exec.duration_ms + 'ms · ' + exec.tokens_in + ' tok';
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

      // Update stats
      updateStats();
      addEventLog(event);
    }

    function handleRunEnd(event) {
      handleEvent(event);
      clearInterval(elapsedInterval);
      document.getElementById('runStatus').textContent = event.data.status;
      const btn = document.getElementById('runBtn');
      btn.disabled = false;
      btn.textContent = '▶ Run DAG';
      if (eventSource) { eventSource.close(); eventSource = null; }
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

    function addEventLog(event) {
      const log = document.getElementById('eventLog');
      if (log.querySelector('div[style]')) log.innerHTML = '';

      const entry = document.createElement('div');
      const cls = event.type.replace(':', '-');
      entry.className = 'event-entry ' + cls;

      const icons = {
        'run:start': '🚀', 'block:start': '⚡', 'block:complete': '✅',
        'block:fail': '❌', 'run:complete': '🎉', 'run:fail': '💥'
      };

      const time = new Date(event.timestamp).toLocaleTimeString();
      const blockLabel = event.block_id ? ' [' + event.block_id + ']' : '';
      entry.innerHTML = '<span class="event-time">' + time + '</span> ' +
        (icons[event.type] ?? '·') + ' ' + event.type + blockLabel;

      log.insertBefore(entry, log.firstChild);
    }

    function updateElapsed() {
      if (!runStartTime) return;
      const ms = Date.now() - runStartTime;
      const s = (ms / 1000).toFixed(1);
      document.getElementById('runElapsed').textContent = s + 's';
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
      const nodeW = 200, nodeH = 120, gapX = 80, gapY = 60;
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
            '<div class="block-meta"></div>' +
            '<div class="block-ports">' +
              '<div class="port-group">' + inputs.map(p => '<div class="port in">← ' + p + '</div>').join('') + '</div>' +
              '<div class="port-group">' + outputs.map(p => '<div class="port out">' + p + ' →</div>').join('') + '</div>' +
            '</div>';

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

    function getDefaultContext(dagName) {
      switch (dagName) {
        case 'coding-pipeline':
          return { prompt: 'Build a real-time chat widget with WebSocket support' };
        case 'research-pipeline':
          return { query: 'What are the emerging trends in AI agent frameworks in 2026?' };
        case 'content-pipeline':
          return { topic: 'The SaaSpocalypse: How AI Agents Are Replacing Traditional Software' };
        default:
          return {};
      }
    }

    loadExamples();
  </script>
</body>
</html>`;
}
