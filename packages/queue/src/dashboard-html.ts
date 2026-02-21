export function buildDashboardHtml(apiKey?: string): string {
  const safeKey = apiKey ? apiKey.replace(/'/g, "\\'").replace(/\\/g, '\\\\') : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenSkelo Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      background: #0f172a; color: #e2e8f0; min-height: 100vh;
    }
    header {
      background: #1e293b; padding: 12px 24px; border-bottom: 1px solid #334155;
      display: flex; justify-content: space-between; align-items: center;
    }
    header h1 { font-size: 16px; font-weight: 600; }
    .header-right { display: flex; align-items: center; gap: 12px; font-size: 12px; }
    .conn-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #475569;
      display: inline-block; transition: background 0.3s;
    }
    .conn-dot.ok { background: #4ade80; }
    .conn-dot.err { background: #ef4444; }
    .health { color: #94a3b8; font-size: 12px; }
    .shortcuts-hint { color: #475569; font-size: 11px; cursor: pointer; }
    #pipeline-filter {
      background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
      border-radius: 4px; padding: 3px 8px; font-size: 11px; font-family: inherit;
    }
    .pipeline-progress { font-size: 11px; color: #94a3b8; margin-left: 6px; }
    .board {
      display: flex; gap: 12px; padding: 16px;
      overflow-x: auto; min-height: calc(100vh - 50px);
    }
    .column {
      flex: 1; min-width: 220px; max-width: 320px;
      background: #1e293b; border-radius: 8px; padding: 10px;
    }
    .column-header {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 6px 4px; margin-bottom: 6px;
      border-bottom: 2px solid #334155; display: flex; justify-content: space-between;
    }
    .column-header .count {
      background: #334155; padding: 1px 7px; border-radius: 10px; font-size: 11px;
    }
    .card {
      background: #0f172a; border: 1px solid #334155; border-radius: 6px;
      padding: 8px 10px; margin-bottom: 6px; font-size: 12px; cursor: pointer;
      transition: border-color 0.15s;
    }
    .card:hover { border-color: #64748b; }
    .card.p0 { border-left: 3px solid #ef4444; }
    .card.p1 { border-left: 3px solid #f59e0b; }
    .card .id { font-size: 10px; color: #64748b; margin-bottom: 3px; }
    .card .summary {
      font-weight: 500; margin-bottom: 3px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; line-height: 1.4;
    }
    .card .meta { font-size: 10px; color: #64748b; display: flex; gap: 6px; flex-wrap: wrap; }
    .badge {
      background: #334155; padding: 1px 5px; border-radius: 3px; font-size: 10px;
    }
    .time-badge { color: #94a3b8; }
    .pipeline-badge { color: #a78bfa; }
    .col-PENDING .column-header { border-color: #f59e0b; }
    .col-IN_PROGRESS .column-header { border-color: #3b82f6; }
    .col-REVIEW .column-header { border-color: #a855f7; }
    .col-DONE .column-header { border-color: #4ade80; }
    .col-BLOCKED .column-header { border-color: #ef4444; }
    .empty-col { font-size: 11px; color: #475569; padding: 10px 4px; text-align: center; }

    /* Loading / Empty / Error states */
    .state-msg {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      text-align: center; font-size: 13px; color: #94a3b8;
    }
    .state-msg.error { color: #ef4444; }
    .state-msg button {
      margin-top: 10px; background: #334155; color: #e2e8f0; border: 1px solid #475569;
      padding: 6px 14px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 12px;
    }
    .state-msg button:hover { background: #475569; }
    .empty-state {
      text-align: center; padding: 60px 20px; color: #64748b; font-size: 13px;
    }
    .empty-state code {
      display: block; margin-top: 10px; background: #1e293b; padding: 8px 12px;
      border-radius: 4px; font-size: 11px; color: #94a3b8;
    }

    /* Detail panel */
    .detail-overlay {
      display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 100;
    }
    .detail-overlay.open { display: block; }
    #detail-panel {
      position: fixed; top: 0; right: 0; width: 480px; max-width: 90vw; height: 100vh;
      background: #1e293b; border-left: 1px solid #334155; z-index: 101;
      overflow-y: auto; transform: translateX(100%); transition: transform 0.2s;
      padding: 16px; display: none;
    }
    #detail-panel.open { display: block; transform: translateX(0); }
    .detail-close {
      position: absolute; top: 10px; right: 14px; background: none; border: none;
      color: #94a3b8; font-size: 20px; cursor: pointer; font-family: inherit;
    }
    .detail-close:hover { color: #e2e8f0; }
    .detail-field { margin-bottom: 10px; }
    .detail-label { font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }
    .detail-value { font-size: 12px; word-break: break-all; }
    .detail-value pre {
      background: #0f172a; padding: 8px; border-radius: 4px; max-height: 200px;
      overflow: auto; white-space: pre-wrap; font-size: 11px; margin: 0;
    }
    .detail-value.error { color: #ef4444; }
    .detail-value .copyable {
      cursor: pointer; border-bottom: 1px dashed #64748b;
    }
    .detail-value .copyable:hover { color: #3b82f6; }

    /* Actions */
    .actions { display: flex; gap: 8px; margin: 14px 0; flex-wrap: wrap; }
    .btn {
      padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer;
      font-size: 12px; font-family: inherit; font-weight: 500;
    }
    .btn-approve { background: #166534; color: #fff; }
    .btn-approve:hover { background: #15803d; }
    .btn-bounce { background: #92400e; color: #fff; }
    .btn-bounce:hover { background: #a16207; }
    .btn-block { background: #7f1d1d; color: #fff; }
    .btn-block:hover { background: #991b1b; }
    .btn-requeue { background: #1e3a5f; color: #fff; }
    .btn-requeue:hover { background: #1e40af; }

    /* Bounce form */
    .bounce-form { display: none; margin: 10px 0; }
    .bounce-form.open { display: block; }
    .bounce-form label { display: block; font-size: 11px; color: #94a3b8; margin: 6px 0 2px; }
    .bounce-form textarea, .bounce-form input {
      width: 100%; background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
      border-radius: 4px; padding: 6px 8px; font-size: 12px; font-family: inherit;
      resize: vertical;
    }
    .bounce-form textarea { min-height: 60px; }
    .bounce-form .form-actions { margin-top: 8px; display: flex; gap: 6px; }

    /* Audit history */
    .audit-section { margin-top: 16px; border-top: 1px solid #334155; padding-top: 10px; }
    .audit-entry {
      font-size: 11px; padding: 4px 0; border-bottom: 1px solid #1e293b;
      color: #94a3b8;
    }
    .audit-entry .ts { color: #64748b; }
    .audit-entry .action { color: #e2e8f0; font-weight: 500; }

    /* Toast */
    #toast-container {
      position: fixed; bottom: 16px; right: 16px; z-index: 200;
      display: flex; flex-direction: column-reverse; gap: 6px;
    }
    .toast {
      padding: 8px 14px; border-radius: 4px; font-size: 12px;
      font-family: inherit; animation: slideIn 0.2s ease-out;
      max-width: 320px;
    }
    .toast.success { background: #166534; color: #fff; }
    .toast.error { background: #7f1d1d; color: #fff; cursor: pointer; }
    @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }

    /* Shortcuts overlay */
    .shortcuts-overlay {
      display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 300; justify-content: center; align-items: center;
    }
    .shortcuts-overlay.open { display: flex; }
    .shortcuts-box {
      background: #1e293b; border: 1px solid #334155; border-radius: 8px;
      padding: 20px; min-width: 240px;
    }
    .shortcuts-box h3 { font-size: 14px; margin-bottom: 12px; }
    .shortcuts-box div { font-size: 12px; margin: 6px 0; display: flex; justify-content: space-between; }
    .shortcuts-box kbd {
      background: #334155; padding: 2px 6px; border-radius: 3px; font-size: 11px;
    }
  </style>
</head>
<body>
  <header>
    <h1>OpenSkelo</h1>
    <div class="header-right">
      <select id="pipeline-filter" onchange="onPipelineFilter()">
        <option value="">All Tasks</option>
      </select>
      <span id="pipeline-progress" class="pipeline-progress"></span>
      <span class="conn-dot" id="conn-dot"></span>
      <span class="health" id="health">Loading...</span>
      <span class="shortcuts-hint" onclick="toggleShortcuts()" title="Keyboard shortcuts">?</span>
    </div>
  </header>
  <div class="board" id="board">
    <div class="state-msg" id="loading-state">Loading...</div>
  </div>

  <div class="detail-overlay" id="detail-overlay" onclick="closePanel()"></div>
  <div id="detail-panel">
    <button class="detail-close" id="detail-close" onclick="closePanel()">&times;</button>
    <div id="detail-content"></div>
  </div>

  <div id="toast-container"></div>

  <div class="shortcuts-overlay" id="shortcuts-overlay" onclick="toggleShortcuts()">
    <div class="shortcuts-box" onclick="event.stopPropagation()">
      <h3>Keyboard Shortcuts</h3>
      <div><span>Close panel</span><kbd>Esc</kbd></div>
      <div><span>Refresh board</span><kbd>R</kbd></div>
      <div><span>Show shortcuts</span><kbd>?</kbd></div>
    </div>
  </div>

  <script>
    var API_KEY = '${safeKey}'
    var STATUSES = ['PENDING', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED']
    var allTasks = []
    var connected = false
    var firstLoad = true
    var currentTaskId = null
    var selectedPipeline = ''

    function escapeHtml(value) {
      return String(value != null ? value : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

    function preview(value, max) {
      max = max || 50
      var text = String(value != null ? value : '')
      return text.length > max ? text.slice(0, max) + '\\u2026' : text
    }

    function apiHeaders(json) {
      var h = {}
      if (API_KEY) h['x-api-key'] = API_KEY
      if (json) h['Content-Type'] = 'application/json'
      return h
    }

    function timeAgo(isoStr) {
      if (!isoStr) return ''
      var diff = Date.now() - new Date(isoStr).getTime()
      if (diff < 0) diff = 0
      var s = Math.floor(diff / 1000)
      if (s < 60) return s + 's'
      var m = Math.floor(s / 60)
      if (m < 60) return m + 'm ' + (s % 60) + 's'
      var h = Math.floor(m / 60)
      return h + 'h ' + (m % 60) + 'm'
    }

    /* --- Toast --- */
    function showToast(msg, type) {
      var c = document.getElementById('toast-container')
      var el = document.createElement('div')
      el.className = 'toast ' + (type || 'success')
      el.textContent = msg
      if (type === 'error') el.onclick = function() { el.remove() }
      c.appendChild(el)
      if (type !== 'error') setTimeout(function() { el.remove() }, 3000)
    }

    /* --- Board rendering --- */
    function renderBoard(tasks, health) {
      if (tasks) allTasks = tasks
      var board = document.getElementById('board')
      var healthEl = document.getElementById('health')
      var dot = document.getElementById('conn-dot')

      connected = true
      dot.className = 'conn-dot ok'
      firstLoad = false

      if (health && health.status === 'ok') {
        var total = 0
        for (var k in health.counts) total += health.counts[k]
        healthEl.textContent = 'OK | ' + total + ' tasks'
      }

      updatePipelineFilter(allTasks)
      updatePipelineProgress()
      var displayTasks = getFilteredTasks()

      if (displayTasks.length === 0 && allTasks.length === 0) {
        board.innerHTML = '<div class="empty-state">No tasks yet.<code>openskelo add --type code --summary &quot;...&quot; --prompt &quot;...&quot; --backend claude-code</code></div>'
        return
      }

      var grouped = {}
      STATUSES.forEach(function(s) { grouped[s] = [] })
      displayTasks.forEach(function(t) { if (grouped[t.status]) grouped[t.status].push(t) })

      board.innerHTML = STATUSES.map(function(status) {
        var items = grouped[status]
        var cards = items.length
          ? items.map(function(t) { return renderCard(t) }).join('')
          : '<div class="empty-col">No tasks</div>'

        return '<div class="column col-' + escapeHtml(status) + '">' +
          '<div class="column-header">' +
            '<span>' + escapeHtml(status.replace(/_/g, ' ')) + '</span>' +
            '<span class="count">' + items.length + '</span>' +
          '</div>' + cards + '</div>'
      }).join('')
    }

    function renderCard(t) {
      var id = escapeHtml(String(t.id || '')).slice(0, 10) + '..'
      var summary = escapeHtml(t.summary)
      var type = escapeHtml(t.type)
      var backend = escapeHtml(t.backend)
      var pClass = t.priority === 0 ? ' p0' : t.priority === 1 ? ' p1' : ''
      var elapsed = timeAgo(t.updated_at)
      var aBadge = 'A:' + (t.attempt_count || 0) + '/' + (t.max_attempts || 5)
      var bBadge = 'B:' + (t.bounce_count || 0) + '/' + (t.max_bounces || 3)
      var pipeline = ''
      if (t.pipeline_id) {
        pipeline = '<span class="badge pipeline-badge">\\u26D3 Step ' + escapeHtml(t.pipeline_step || '?') + '</span>'
      }

      return '<div class="card' + pClass + '" onclick="openDetail(\\'' + escapeHtml(t.id) + '\\')">' +
        '<div class="id">' + id + '</div>' +
        '<div class="summary">' + summary + '</div>' +
        '<div class="meta">' +
          '<span>' + type + '</span>' +
          '<span>' + backend + '</span>' +
          '<span class="badge">' + aBadge + '</span>' +
          '<span class="badge">' + bBadge + '</span>' +
          (elapsed ? '<span class="time-badge">' + elapsed + '</span>' : '') +
          pipeline +
        '</div>' +
      '</div>'
    }

    function renderError() {
      var board = document.getElementById('board')
      var dot = document.getElementById('conn-dot')
      var healthEl = document.getElementById('health')
      connected = false
      dot.className = 'conn-dot err'
      healthEl.textContent = 'Disconnected'
      if (firstLoad) {
        board.innerHTML = '<div class="state-msg error">Could not connect to server<br><button onclick="refresh()">Retry</button></div>'
      }
    }

    /* --- Refresh --- */
    async function refresh() {
      try {
        var r = await Promise.all([
          fetch('/tasks', { headers: apiHeaders() }),
          fetch('/health', { headers: apiHeaders() }),
        ])
        if (!r[0].ok || !r[1].ok) { renderError(); return }
        var tasks = await r[0].json()
        var health = await r[1].json()
        renderBoard(tasks, health)
      } catch (e) {
        renderError()
      }
    }

    refresh()
    setInterval(refresh, 5000)

    /* --- Pipeline filter --- */
    function updatePipelineFilter(tasks) {
      var select = document.getElementById('pipeline-filter')
      var pipelineIds = []
      tasks.forEach(function(t) {
        if (t.pipeline_id && pipelineIds.indexOf(t.pipeline_id) === -1) {
          pipelineIds.push(t.pipeline_id)
        }
      })
      var current = select.value
      var opts = '<option value="">All Tasks</option>'
      pipelineIds.forEach(function(pid) {
        var short = pid.slice(0, 8) + '..'
        opts += '<option value="' + escapeHtml(pid) + '"' + (pid === current ? ' selected' : '') + '>Pipeline: ' + short + '</option>'
      })
      select.innerHTML = opts
    }

    function getFilteredTasks() {
      if (!selectedPipeline) return allTasks
      return allTasks.filter(function(t) { return t.pipeline_id === selectedPipeline })
    }

    function updatePipelineProgress() {
      var el = document.getElementById('pipeline-progress')
      if (!selectedPipeline) { el.textContent = ''; return }
      var filtered = getFilteredTasks()
      var done = filtered.filter(function(t) { return t.status === 'DONE' }).length
      el.textContent = done + '/' + filtered.length + ' complete'
    }

    function onPipelineFilter() {
      selectedPipeline = document.getElementById('pipeline-filter').value
      renderBoard(allTasks, null)
      updatePipelineProgress()
    }

    /* --- Detail panel --- */
    async function openDetail(taskId) {
      currentTaskId = taskId
      var task = allTasks.find(function(t) { return t.id === taskId })
      if (!task) return

      var panel = document.getElementById('detail-panel')
      var overlay = document.getElementById('detail-overlay')
      var content = document.getElementById('detail-content')

      var html = '<h3 style="margin-bottom:14px;font-size:14px">' + escapeHtml(task.summary) + '</h3>'

      html += detailField('ID', '<span class="copyable" onclick="copyText(\\'' + escapeHtml(task.id) + '\\')">' + escapeHtml(task.id) + '</span>')
      html += detailField('Status', escapeHtml(task.status))
      html += detailField('Type', escapeHtml(task.type))
      html += detailField('Backend', escapeHtml(task.backend))
      html += detailField('Priority', String(task.priority != null ? task.priority : 0))
      html += detailField('Summary', escapeHtml(task.summary))
      html += detailField('Prompt', '<pre>' + escapeHtml(task.prompt) + '</pre>')
      if (task.result) html += detailField('Result', '<pre>' + escapeHtml(task.result) + '</pre>')
      if (task.last_error) html += '<div class="detail-field"><div class="detail-label">Last Error</div><div class="detail-value error">' + escapeHtml(task.last_error) + '</div></div>'
      html += detailField('Attempts', (task.attempt_count || 0) + ' / ' + (task.max_attempts || 5))
      html += detailField('Bounces', (task.bounce_count || 0) + ' / ' + (task.max_bounces || 3))
      if (task.lease_owner) html += detailField('Lease Owner', escapeHtml(task.lease_owner))
      if (task.lease_expires_at) html += detailField('Lease Expires', escapeHtml(task.lease_expires_at))
      html += detailField('Created', escapeHtml(task.created_at))
      html += detailField('Updated', escapeHtml(task.updated_at))
      if (task.pipeline_id) {
        html += detailField('Pipeline', escapeHtml(task.pipeline_id) + ' — Step ' + escapeHtml(task.pipeline_step || '?'))
      }

      html += renderActions(task)
      html += '<div class="audit-section" id="audit-log"><div class="detail-label">Audit History</div><div style="color:#64748b;font-size:11px">Loading...</div></div>'

      content.innerHTML = html
      panel.classList.add('open')
      overlay.classList.add('open')

      loadAudit(taskId)
    }

    function detailField(label, value) {
      return '<div class="detail-field"><div class="detail-label">' + label + '</div><div class="detail-value">' + value + '</div></div>'
    }

    function renderActions(task) {
      var s = task.status
      var html = '<div class="actions">'

      if (s === 'REVIEW') {
        html += '<button class="btn btn-approve" onclick="doApprove()">Approve \\u2192 DONE</button>'
        html += '<button class="btn btn-bounce" onclick="toggleBounceForm()">Bounce \\u2192 PENDING</button>'
        html += '<button class="btn btn-block" onclick="doBlock()">Block</button>'
      } else if (s === 'PENDING' || s === 'IN_PROGRESS') {
        html += '<button class="btn btn-block" onclick="doBlock()">Block</button>'
      } else if (s === 'BLOCKED') {
        html += '<button class="btn btn-requeue" onclick="doRequeue()">Requeue \\u2192 PENDING</button>'
      }

      html += '</div>'

      html += '<div class="bounce-form" id="bounce-form">'
      html += '<label>What\\u2019s wrong (required)</label><textarea id="bounce-reason" placeholder="Describe the issue..."></textarea>'
      html += '<label>Where</label><input id="bounce-where" placeholder="e.g. src/auth.ts">'
      html += '<label>How to fix</label><textarea id="bounce-fix" placeholder="Suggested fix..."></textarea>'
      html += '<div class="form-actions">'
      html += '<button class="btn btn-bounce" onclick="submitBounce()">Submit Bounce</button>'
      html += '<button class="btn" style="background:#334155" onclick="toggleBounceForm()">Cancel</button>'
      html += '</div></div>'

      return html
    }

    async function loadAudit(taskId) {
      try {
        var res = await fetch('/audit?task_id=' + encodeURIComponent(taskId), { headers: apiHeaders() })
        if (!res.ok) return
        var entries = await res.json()
        var el = document.getElementById('audit-log')
        if (!entries.length) {
          el.innerHTML = '<div class="detail-label">Audit History</div><div style="color:#64748b;font-size:11px">No entries</div>'
          return
        }
        var html = '<div class="detail-label">Audit History</div>'
        entries.forEach(function(e) {
          html += '<div class="audit-entry">' +
            '<span class="ts">' + escapeHtml(e.timestamp || e.created_at || '') + '</span> ' +
            '<span class="action">' + escapeHtml(e.action) + '</span> ' +
            (e.actor ? '<span>' + escapeHtml(e.actor) + '</span> ' : '') +
            (e.before_status && e.after_status ? '<span>' + escapeHtml(e.before_status) + ' \\u2192 ' + escapeHtml(e.after_status) + '</span>' : '') +
          '</div>'
        })
        el.innerHTML = html
      } catch (e) { /* audit load fail is non-critical */ }
    }

    function closePanel() {
      document.getElementById('detail-panel').classList.remove('open')
      document.getElementById('detail-overlay').classList.remove('open')
      currentTaskId = null
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(function() { showToast('Copied!') })
    }

    function toggleBounceForm() {
      var f = document.getElementById('bounce-form')
      f.classList.toggle('open')
    }

    /* --- Transition actions --- */
    async function doTransition(to, body) {
      if (!currentTaskId) return
      try {
        var res = await fetch('/tasks/' + currentTaskId + '/transition', {
          method: 'POST',
          headers: apiHeaders(true),
          body: JSON.stringify(Object.assign({ to: to }, body || {})),
        })
        if (!res.ok) {
          var err = await res.json()
          showToast(err.error || 'Failed', 'error')
          return
        }
        closePanel()
        showToast('Task updated \\u2192 ' + to)
        refresh()
      } catch (e) {
        showToast('Request failed', 'error')
      }
    }

    function doApprove() { doTransition('DONE') }

    function doBlock() {
      if (!confirm('Block this task?')) return
      doTransition('BLOCKED', { reason: 'Manually blocked from dashboard' })
    }

    function doRequeue() { doTransition('PENDING') }

    function submitBounce() {
      var reason = document.getElementById('bounce-reason').value.trim()
      if (!reason) { showToast('Reason is required', 'error'); return }
      doTransition('PENDING', {
        feedback: {
          what: reason,
          where: document.getElementById('bounce-where').value.trim(),
          fix: document.getElementById('bounce-fix').value.trim(),
        },
      })
    }

    /* --- Keyboard shortcuts --- */
    function toggleShortcuts() {
      document.getElementById('shortcuts-overlay').classList.toggle('open')
    }

    document.addEventListener('keydown', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') {
        if (document.getElementById('shortcuts-overlay').classList.contains('open')) {
          toggleShortcuts()
        } else {
          closePanel()
        }
      }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); refresh() }
      if (e.key === '?') { e.preventDefault(); toggleShortcuts() }
    })
  </script>
</body>
</html>`
}
