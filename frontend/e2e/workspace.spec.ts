import { expect, test, type Page, type Route } from '@playwright/test'

// Explicitly synthetic fixtures live only in this browser test. They never enter the app bundle.
const doc = {
  id: 'a'.repeat(64),
  filename: 'Synthetic French plan.pdf',
  content_hash: 'a'.repeat(64),
  version: '1',
  status: 'ready',
  page_count: 2,
  pages: [
    { page: 1, text: 'Synthetic French source page one.' },
    { page: 2, text: 'Synthetic French source page two.' },
  ],
  budget_fields: [],
  warnings: [],
  created_at: '2026-11-13T12:00:00Z',
  source_language: 'French',
  derived_from: null,
  source_page_map: {},
}
const result = {
  map: {
    nodes: [
      {
        id: 'interest',
        kind: 'funding',
        label: 'Infrastructure interest',
        text: 'Investor asks what funding could support.',
        classification: 'founder_provided',
        citations: [],
      },
      {
        id: 'storage',
        kind: 'expenditure',
        label: 'Proposed storage facility',
        text: 'The document proposes storage facilities.',
        classification: 'document_supported',
        citations: [{ document_id: doc.id, page: 1, quote: 'Synthetic French source page one.' }],
      },
      {
        id: 'capability',
        kind: 'capability',
        label: 'Potential storage capacity',
        text: 'Would depend on completed site and staffing.',
        classification: 'assumption',
        citations: [],
      },
    ],
    edges: [
      { id: 'funds', source: 'interest', target: 'storage', relationship: 'funds' },
      { id: 'enables', source: 'storage', target: 'capability', relationship: 'enables' },
    ],
  },
  explanation: {
    title: 'Synthetic infrastructure concept',
    statements: [
      {
        text: 'The source proposes a storage facility.',
        classification: 'document_supported',
        citations: [{ document_id: doc.id, page: 1, quote: 'Synthetic French source page one.' }],
      },
    ],
  },
  gaps: ['Execution team is not documented.'],
  assumptions: [
    {
      text: 'Transport access remains an assumption.',
      classification: 'assumption',
      citations: [],
    },
  ],
  contradictions: [],
  budget_checks: [
    {
      currency: 'FCFA',
      status: 'conflict',
      subtotal_sum: '12',
      printed_total: '10',
      difference: '2',
      description: 'Synthetic phase totals do not match the printed total.',
      fields: [],
    },
  ],
  warnings: [],
}

function fixture() {
  return {
    id: 'draft-1',
    revision: 1,
    status: 'draft',
    origin: 'generated',
    edited_fields: [],
    request: {
      question: 'What could funding support?',
      founder_notes: 'Considering storage.',
      document_ids: [doc.id],
      workflow: 'single',
    },
    result,
    trace_id: 'trace-1',
    created_at: '2026-11-13T12:00:00Z',
    updated_at: '2026-11-13T12:00:00Z',
    approved_at: null,
  } as typeof result & Record<string, any>
}

async function mockApi(
  page: Page,
  options: {
    config?: 'ready' | 'storage-only' | 'missing'
    failGenerate?: boolean
    conflictOnce?: boolean
    slowGenerate?: boolean
  } = {},
) {
  const config = options.config || 'ready'
  let draft = fixture()
  let rejectionPending = !!options.conflictOnce
  const requests: string[] = []
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    requests.push(`${request.method()} ${path}`)
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
    if (path === '/api/config')
      return reply({
        configured: config === 'ready',
        missing:
          config === 'missing'
            ? ['ATLAS_PROJECT_ID', 'ATLAS_GCS_BUCKET', 'ATLAS_LOCATION', 'ATLAS_MODEL']
            : config === 'storage-only'
              ? ['ATLAS_LOCATION', 'ATLAS_MODEL']
              : [],
        message:
          config === 'ready' ? 'Configuration supplied.' : 'Set the listed backend variables.',
        limits: { max_upload_bytes: 20971520 },
      })
    if (path === '/api/documents' && request.method() === 'GET') return reply([doc])
    if (path === `/api/documents/${doc.id}`) return reply(doc)
    if (path === '/api/drafts' && request.method() === 'GET') return reply([])
    if (path === '/api/comparisons') return reply([])
    if (path === '/api/generate') {
      if (options.slowGenerate) await new Promise((resolve) => setTimeout(resolve, 600))
      if (options.failGenerate)
        return reply(
          {
            detail: {
              code: 'workflow_failed',
              message: 'Vertex AI model request failed.',
              request_id: 'req-fail',
            },
          },
          502,
        )
      return reply(draft)
    }
    if (path === `/api/drafts/${draft.id}` && request.method() === 'PUT') {
      if (rejectionPending) {
        rejectionPending = false
        return reply(
          {
            detail: {
              code: 'revision_conflict',
              message: 'Revision changed.',
              request_id: 'req-conflict',
            },
          },
          409,
        )
      }
      const body = request.postDataJSON()
      expect(body.expected_revision).toBe(draft.revision)
      draft = {
        ...draft,
        result: body.result,
        revision: draft.revision + 1,
        status: 'draft',
        origin: 'human_edited',
        edited_fields: ['explanation.title'],
        approved_at: null,
      }
      return reply(draft)
    }
    if (path === `/api/drafts/${draft.id}/approve`) {
      const body = request.postDataJSON()
      expect(body.expected_revision).toBe(draft.revision)
      draft = { ...draft, status: 'approved', approved_at: '2026-11-13T13:00:00Z' }
      return reply(draft)
    }
    if (path === `/api/drafts/${draft.id}` && request.method() === 'GET') return reply(draft)
    if (path === `/api/drafts/${draft.id}/versions`) return reply([draft])
    if (path === '/api/documents' && request.method() === 'POST') {
      const body = request.postData() || ''
      expect(body).toContain('derived_from')
      expect(body).toContain(doc.id)
      expect(body).toContain('{"1":[1]}')
      return reply({
        ...doc,
        id: 'b'.repeat(64),
        filename: 'Synthetic translation.pdf',
        content_hash: 'b'.repeat(64),
        source_language: 'English',
        derived_from: doc.id,
        source_page_map: { '1': [1] },
      })
    }
    return reply({ detail: { message: 'Unexpected test request' } }, 500)
  })
  return requests
}

test('renders a generated graph, source page, edit, save, approve, and invalidation', async ({
  page,
}) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.getByText('Map investment to infrastructure.')).toBeVisible()
  await page.getByLabel('Investor question').fill('What could funding support?')
  await page.getByRole('button', { name: 'Generate investment map' }).click()
  await expect(page.locator('.graph-node')).toHaveCount(3)
  await expect(page.locator('.react-flow__edge-text').filter({ hasText: 'FUNDS' })).toBeVisible()
  await expect(
    page
      .locator('.review-panel')
      .getByText('Synthetic phase totals do not match the printed total.'),
  ).toBeVisible()
  await page.locator('.statement .citation').first().click()
  await expect(page.getByRole('dialog', { name: 'Source document page' })).toContainText(
    'Synthetic French source page one.',
  )
  await page.getByRole('button', { name: 'Close source' }).click()
  await page.getByRole('textbox', { name: 'Explanation title' }).fill('Founder revised title')
  await expect(page.locator('.review-head').getByText('Unsaved edits')).toBeVisible()
  await page.getByRole('button', { name: 'Save edits' }).click()
  await expect(page.locator('.review-version').getByText('Version 2')).toBeVisible()
  await expect(page.locator('.review-panel .human-edit').first()).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.locator('.review-head .status-pill')).toHaveText('Approved')
  await page.emulateMedia({ media: 'print' })
  await expect(
    page.getByRole('article', { name: 'Printable investment review record' }),
  ).toContainText('HUMAN APPROVED')
  await expect(
    page.getByRole('article', { name: 'Printable investment review record' }),
  ).toContainText('Synthetic French plan.pdf, p. 1')
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('textbox', { name: 'Explanation title' }).fill('Another human edit')
  const longExplanation = 'Synthetic founder explanation with complete context. '.repeat(50)
  await page.getByRole('textbox', { name: 'Explanation statement 1' }).fill(longExplanation)
  await expect(page.getByText('Saving edits will invalidate this approval.')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  const report = page.getByRole('article', { name: 'Printable investment review record' })
  await expect(report).toContainText('UNSAVED EDITS — NOT APPROVED FOR SHARING')
  await expect(report).toContainText(longExplanation)
  await expect(page.locator('.workspace-grid')).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('button', { name: 'Save edits' }).click()
  await expect(page.locator('.review-head .status-pill')).toHaveText('Draft')
})

test('shows generation loading and failure without a fabricated result', async ({ page }) => {
  await mockApi(page, { slowGenerate: true, failGenerate: true })
  await page.goto('/')
  await page.getByLabel('Investor question').fill('What supports storage?')
  await page.getByRole('button', { name: 'Generate investment map' }).click()
  await expect(page.getByRole('button', { name: 'Generating grounded draft…' })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('Vertex AI model request failed.')
  await expect(page.locator('.graph-node')).toHaveCount(0)
})

test('preserves local edits on revision conflict and reloads deliberately', async ({ page }) => {
  await mockApi(page, { conflictOnce: true })
  await page.goto('/')
  await page.getByLabel('Investor question').fill('What could funding support?')
  await page.getByRole('button', { name: 'Generate investment map' }).click()
  await page.getByRole('textbox', { name: 'Explanation title' }).fill('Local unsaved edit')
  await page.getByRole('button', { name: 'Save edits' }).click()
  await expect(page.getByRole('alert')).toContainText('Your edits are still local')
  await expect(page.getByRole('textbox', { name: 'Explanation title' })).toHaveValue(
    'Local unsaved edit',
  )
  await page.getByRole('button', { name: 'Reload latest' }).click()
  await expect(page.getByRole('textbox', { name: 'Explanation title' })).toHaveValue(
    'Synthetic infrastructure concept',
  )
})

test('keeps document actions available with only model settings missing and maps a translation', async ({
  page,
}) => {
  const requests = await mockApi(page, { config: 'storage-only' })
  await page.goto('/')
  await expect(page.getByText('Model setup needed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate investment map' })).toBeDisabled()
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page.getByLabel('Document language').fill('English')
  await page.getByLabel('Derived from original PDF').selectOption(doc.id)
  await page.getByRole('textbox', { name: 'Reviewed page map' }).fill('{"1":[1]}')
  await page.locator('input[type=file]').setInputFiles({
    name: 'Synthetic translation.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic browser fixture'),
  })
  await expect(page.getByRole('heading', { name: 'Synthetic translation.pdf' })).toBeVisible()
  expect(requests).toContain('POST /api/documents')
})

test('mobile navigation exposes all views and missing storage makes unknown state clear', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const requests = await mockApi(page, { config: 'missing' })
  await page.goto('/')
  await expect(page.getByText('Map investment to infrastructure.')).toBeVisible()
  await page.getByRole('button', { name: 'Comparison' }).click()
  await expect(page.getByText('Connect storage to load comparisons')).toBeVisible()
  await page.getByRole('button', { name: 'Saved drafts' }).click()
  await expect(page.getByText('Connect storage to load drafts')).toBeVisible()
  expect(requests).not.toContain('GET /api/drafts')
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
})
