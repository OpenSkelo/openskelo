import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createDashboardRouter, escapeDashboardHtml } from '../src/dashboard.js'

function createTestApp(apiKey?: string) {
  const app = express()
  app.use(createDashboardRouter(apiKey))
  return app
}

describe('Dashboard', () => {
  it('GET /dashboard returns HTML', async () => {
    const app = createTestApp()

    const res = await request(app)
      .get('/dashboard')
      .expect(200)

    expect(res.headers['content-type']).toMatch(/html/)
  })

  it('Dashboard HTML contains status columns', async () => {
    const app = createTestApp()

    const res = await request(app)
      .get('/dashboard')
      .expect(200)

    const html = res.text
    expect(html).toContain('PENDING')
    expect(html).toContain('IN_PROGRESS')
    expect(html).toContain('REVIEW')
    expect(html).toContain('DONE')
    expect(html).toContain('BLOCKED')
  })

  it('Dashboard HTML contains auto-refresh script', async () => {
    const app = createTestApp()

    const res = await request(app)
      .get('/dashboard')
      .expect(200)

    const html = res.text
    expect(html).toMatch(/setInterval|setTimeout/)
  })

  it('escapes task type values that contain script tags', () => {
    const payload = '<script>alert(1)</script>'
    const escaped = escapeDashboardHtml(payload)
    expect(escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escaped).not.toContain('<script>')
  })

  it('Dashboard script escapes task type before HTML injection', async () => {
    const app = createTestApp()
    const res = await request(app)
      .get('/dashboard')
      .expect(200)

    const html = res.text
    expect(html).toContain('escapeHtml')
  })

  it('Dashboard HTML contains approve button markup', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('Approve')
    expect(res.text).toContain('DONE')
  })

  it('Dashboard HTML contains bounce form markup', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('Bounce')
    expect(res.text).toContain('bounce-reason')
  })

  it('Dashboard HTML contains detail panel markup', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('detail-panel')
    expect(res.text).toContain('detail-close')
  })

  it('Dashboard HTML contains toast container', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('toast-container')
  })

  it('Dashboard HTML contains keyboard shortcut handler', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('keydown')
    expect(res.text).toContain('Escape')
  })

  it('Dashboard serves with correct content-type', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('API key injection: when key provided, HTML contains key variable', async () => {
    const app = createTestApp('my-secret-key')
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('my-secret-key')
    expect(res.text).toContain('API_KEY')
  })

  it('API key injection: when no key, HTML does not contain key reference value', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain("API_KEY = ''")
  })

  it('Dashboard HTML contains connection indicator', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('conn-dot')
  })

  it('Dashboard HTML contains empty state message', async () => {
    const app = createTestApp()
    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('No tasks yet')
  })
})
