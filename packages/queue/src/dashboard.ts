import { Router } from 'express'
import type { Request, Response } from 'express'

export function escapeDashboardHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenSkelo Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    header {
      background: #1e293b;
      padding: 16px 24px;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    header h1 { font-size: 20px; font-weight: 600; }
    .health {
      font-size: 13px;
      color: #94a3b8;
    }
    .board {
      display: flex;
      gap: 16px;
      padding: 24px;
      overflow-x: auto;
      min-height: calc(100vh - 65px);
    }
    .column {
      flex: 1;
      min-width: 220px;
      max-width: 320px;
      background: #1e293b;
      border-radius: 8px;
      padding: 12px;
    }
    .column-header {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 8px 4px;
      margin-bottom: 8px;
      border-bottom: 2px solid #334155;
      display: flex;
      justify-content: space-between;
    }
    .column-header .count {
      background: #334155;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 12px;
    }
    .card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .card .id {
      font-family: monospace;
      font-size: 11px;
      color: #64748b;
      margin-bottom: 4px;
    }
    .card .summary {
      font-weight: 500;
      margin-bottom: 4px;
    }
    .card .meta {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }
    .col-PENDING .column-header { border-color: #f59e0b; }
    .col-IN_PROGRESS .column-header { border-color: #3b82f6; }
    .col-REVIEW .column-header { border-color: #a855f7; }
    .col-DONE .column-header { border-color: #4ade80; }
    .col-BLOCKED .column-header { border-color: #ef4444; }
    .empty {
      font-size: 12px;
      color: #475569;
      padding: 12px 4px;
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <h1>OpenSkelo Task Board</h1>
    <div class="health" id="health">Loading...</div>
  </header>
  <div class="board" id="board"></div>

  <script>
    const STATUSES = ['PENDING', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED']

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

    function preview(value, max = 50) {
      const text = String(value ?? '')
      return text.length > max ? text.slice(0, max) + '…' : text
    }

    function renderBoard(tasks, health) {
      const board = document.getElementById('board')
      const healthEl = document.getElementById('health')

      if (health && health.status === 'ok') {
        const total = Object.values(health.counts).reduce((a, b) => a + b, 0)
        healthEl.textContent = 'Status: OK | Total: ' + total
      }

      const grouped = {}
      STATUSES.forEach(s => { grouped[s] = [] })
      tasks.forEach(t => {
        if (grouped[t.status]) grouped[t.status].push(t)
      })

      board.innerHTML = STATUSES.map(status => {
        const safeStatus = escapeHtml(status)
        const items = grouped[status]
        const cards = items.length
          ? items.map(t => {
              const id = escapeHtml(String(t.id ?? '')).slice(0, 10) + '...'
              const summary = escapeHtml(t.summary)
              const type = escapeHtml(t.type)
              const taskStatus = escapeHtml(t.status)
              const backend = escapeHtml(t.backend)
              const leaseOwner = escapeHtml(t.lease_owner)
              const prompt = escapeHtml(preview(t.prompt))
              const result = escapeHtml(preview(t.result))
              const metadata = escapeHtml(preview(JSON.stringify(t.metadata ?? {}), 80))

              return '<div class="card">' +
                '<div class="id">' + id + '</div>' +
                '<div class="summary">' + summary + '</div>' +
                '<div class="meta">' +
                  type + ' | ' + taskStatus + ' | ' + backend +
                  (leaseOwner ? ' | ' + leaseOwner : '') +
                '</div>' +
                '<div class="meta">Prompt: ' + prompt + '</div>' +
                '<div class="meta">Result: ' + result + '</div>' +
                '<div class="meta">Metadata: ' + metadata + '</div>' +
              '</div>'
            }).join('')
          : '<div class="empty">No tasks</div>'

        return '<div class="column col-' + safeStatus + '">' +
          '<div class="column-header">' +
            '<span>' + escapeHtml(status.replace('_', ' ')) + '</span>' +
            '<span class="count">' + items.length + '</span>' +
          '</div>' +
          cards +
        '</div>'
      }).join('')
    }

    async function refresh() {
      try {
        const [tasksRes, healthRes] = await Promise.all([
          fetch('/tasks'),
          fetch('/health'),
        ])
        const tasks = await tasksRes.json()
        const health = await healthRes.json()
        renderBoard(tasks, health)
      } catch (err) {
        console.error('Failed to refresh:', err)
      }
    }

    refresh()
    setInterval(refresh, 5000)
  </script>
</body>
</html>`

export function createDashboardRouter(): Router {
  const router = Router()

  router.get('/dashboard', (_req: Request, res: Response) => {
    res.type('html').send(DASHBOARD_HTML)
  })

  return router
}
