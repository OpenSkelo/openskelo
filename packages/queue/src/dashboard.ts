import { Router } from 'express'
import type { Request, Response } from 'express'
import { buildDashboardHtml } from './dashboard-html.js'

export function escapeDashboardHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function createDashboardRouter(apiKey?: string): Router {
  const router = Router()
  const html = buildDashboardHtml(apiKey)

  router.get('/dashboard', (_req: Request, res: Response) => {
    res.type('html').send(html)
  })

  return router
}
