import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createDashboardRouter } from '../src/dashboard.js'

function createTestApp() {
  const app = express()
  app.use(createDashboardRouter())
  return app
}

describe('Dashboard', () => {
  // 1. GET /dashboard returns HTML
  it('GET /dashboard returns HTML', async () => {
    const app = createTestApp()

    const res = await request(app)
      .get('/dashboard')
      .expect(200)

    expect(res.headers['content-type']).toMatch(/html/)
  })

  // 2. Dashboard HTML contains required elements
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

  // 3. Dashboard HTML contains auto-refresh script
  it('Dashboard HTML contains auto-refresh script', async () => {
    const app = createTestApp()

    const res = await request(app)
      .get('/dashboard')
      .expect(200)

    const html = res.text
    expect(html).toMatch(/setInterval|setTimeout/)
  })
})
