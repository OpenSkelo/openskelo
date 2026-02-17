export function getDashboardHTML(projectName: string, _port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${projectName} — OpenSkelo Block Core</title>
<style>
  body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #0b1020; color: #e5e7eb; }
  .wrap { display: grid; grid-template-columns: 320px 1fr 360px; gap: 12px; height: 100vh; padding: 12px; box-sizing: border-box; }
  .panel { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; overflow: auto; }
  h2 { margin: 0 0 10px; font-size: 13px; color: #f59e0b; }
  input, textarea, button { font: inherit; }
  input, textarea { width: 100%; background: #0f172a; color: #e5e7eb; border: 1px solid #334155; border-radius: 6px; padding: 8px; box-sizing: border-box; }
  button { background: #f59e0b; color: #111827; border: none; border-radius: 6px; padding: 8px 10px; cursor: pointer; font-weight: 700; }
  .muted { color: #94a3b8; font-size: 11px; }
  .kv { margin: 6px 0; font-size: 12px; }
  .badge { padding: 2px 8px; border-radius: 999px; background: #1f2937; display: inline-block; }
  .event { border-bottom: 1px dashed #374151; padding: 6px 0; font-size: 11px; }
  .artifact-path { font-size: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px; margin-bottom: 8px; color: #67e8f9; word-break: break-all; }
  iframe { width: 100%; height: 420px; border: 1px solid #334155; border-radius: 8px; background: #020617; }
</style>
</head>
<body>
<div class="wrap">
  <div class="panel">
    <h2>Run Control</h2>
    <div class="muted">Original prompt</div>
    <textarea id="prompt" rows="4" placeholder="Describe what to build..."></textarea>
    <div style="height:8px"></div>
    <button onclick="createRun()">Create Run</button>
    <div style="height:16px"></div>

    <div class="muted">Run ID</div>
    <input id="runId" placeholder="RUN-xxxx" />
    <div style="height:8px"></div>
    <button onclick="refreshRun()">Refresh</button>
    <button onclick="stepRun()" style="margin-left:6px">Step +1</button>

    <div style="height:16px"></div>
    <div class="muted">Step options</div>
    <label style="font-size:12px"><input type="checkbox" id="approved" /> reviewApproved=true</label>

    <div style="height:16px"></div>
    <div class="muted">Shared context patch (JSON)</div>
    <textarea id="contextPatch" rows="5" placeholder='{"branch":"feature/foo"}'></textarea>
    <div style="height:8px"></div>
    <button onclick="updateContext()">POST Context</button>
  </div>

  <div class="panel">
    <h2>Run State (API Observer)</h2>
    <div id="state" class="muted">No run loaded.</div>
    <div style="height:12px"></div>
    <h2>Events</h2>
    <div id="events" class="muted">—</div>
  </div>

  <div class="panel">
    <h2>Latest Artifact</h2>
    <div id="artifactPath" class="artifact-path">—</div>
    <iframe id="artifactFrame"></iframe>
  </div>
</div>

<script>
let currentRun = null;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function createRun() {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return alert('original prompt required');
  const result = await api('POST', '/api/runs', { original_prompt: prompt });
  if (!result.ok) return alert(result.data.error || 'create failed');
  document.getElementById('runId').value = result.data.run.id;
  await refreshRun();
}

async function refreshRun() {
  const id = document.getElementById('runId').value.trim();
  if (!id) return;
  const result = await api('GET', '/api/runs/' + id);
  if (!result.ok) return alert(result.data.error || 'not found');
  currentRun = result.data.run;
  render(result.data.run, result.data.events || []);
  await refreshArtifact(id);
}

async function stepRun() {
  const id = document.getElementById('runId').value.trim();
  if (!id) return;

  let contextPatch = undefined;
  const rawPatch = document.getElementById('contextPatch').value.trim();
  if (rawPatch) {
    try { contextPatch = JSON.parse(rawPatch); }
    catch { return alert('Invalid JSON in context patch'); }
  }

  const body = {
    reviewApproved: document.getElementById('approved').checked,
    contextPatch,
  };

  const result = await api('POST', '/api/runs/' + id + '/step', body);
  if (!result.ok) return alert((result.data.error || 'step failed') + '\n' + JSON.stringify(result.data.gate || {}, null, 2));
  render(result.data.run, result.data.events || []);
  await refreshArtifact(id);
}

async function updateContext() {
  const id = document.getElementById('runId').value.trim();
  if (!id) return;
  const rawPatch = document.getElementById('contextPatch').value.trim();
  if (!rawPatch) return;
  let patch;
  try { patch = JSON.parse(rawPatch); }
  catch { return alert('Invalid JSON'); }

  const result = await api('POST', '/api/runs/' + id + '/context', patch);
  if (!result.ok) return alert(result.data.error || 'context update failed');
  await refreshRun();
}

async function refreshArtifact(id) {
  const result = await api('GET', '/api/runs/' + id + '/artifact');
  if (!result.ok) return;
  document.getElementById('artifactPath').textContent = result.data.artifact_path || '—';
  const frame = document.getElementById('artifactFrame');
  frame.srcdoc = result.data.preview || '<div style="color:#64748b;padding:16px">No artifact yet.</div>';
}

function render(run, events) {
  document.getElementById('state').innerHTML = [
    ['id', run.id],
    ['block', run.current_block],
    ['iteration', run.iteration],
    ['status', run.status],
    ['artifact_path', run.artifact_path || '—'],
  ].map(([k,v]) => '<div class="kv"><span class="muted">' + k + '</span>: <span class="badge">' + v + '</span></div>').join('') +
    '<div class="kv"><span class="muted">context</span><pre style="white-space:pre-wrap;background:#0f172a;padding:8px;border-radius:6px;border:1px solid #334155">' + JSON.stringify(run.context, null, 2) + '</pre></div>';

  document.getElementById('events').innerHTML = events.length ? events.map((e) =>
    '<div class="event"><div><b>' + e.transition + '</b> <span class="muted">' + e.result + '</span></div>' +
    '<div class="muted">' + e.created_at + '</div></div>'
  ).join('') : '<span class="muted">No events.</span>';
}
</script>
</body>
</html>`;
}
