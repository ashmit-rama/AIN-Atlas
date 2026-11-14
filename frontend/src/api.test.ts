import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('backend API client', () => {
  it('sends the exact revision and complete edited result on save', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'd1', revision: 3 }) })
    vi.stubGlobal('fetch', fetchMock)
    const result = {
      map: { nodes: [], edges: [] },
      explanation: { title: 'Edited', statements: [] },
      gaps: [],
      assumptions: [],
      contradictions: [],
      budget_checks: [],
      warnings: [],
    }
    await api.update('d1', 2, result)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/d1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ expected_revision: 2, result }),
      }),
    )
  })

  it('surfaces actionable backend configuration errors and request IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          detail: {
            code: 'not_configured',
            message: 'Set GOOGLE_CLOUD_PROJECT',
            request_id: 'req-123',
          },
        }),
      }),
    )
    await expect(api.documents()).rejects.toMatchObject({
      message: 'Set GOOGLE_CLOUD_PROJECT',
      status: 503,
      requestId: 'req-123',
    } satisfies Partial<ApiError>)
  })

  it('reports an unreachable backend without pretending success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')))
    await expect(api.config()).rejects.toThrow('Cannot reach AIN Atlas')
  })
})
