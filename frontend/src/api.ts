import type {
  Comparison,
  Configuration,
  Document,
  Draft,
  GenerateRequest,
  InvestmentResult,
} from './contracts'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message)
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError('Cannot reach AIN Atlas. Start the backend and retry.', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : detail?.message || body?.message || `Request failed (${response.status}).`
    throw new ApiError(message, response.status, detail?.request_id)
  }
  return body as T
}

const json = (value: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
})
export const api = {
  config: () => request<Configuration>('/config'),
  documents: () => request<Document[]>('/documents'),
  document: (id: string) => request<Document>(`/documents/${encodeURIComponent(id)}`),
  upload: (
    file: File,
    options: {
      source_language: string
      derived_from?: string
      source_page_map?: Record<string, number[]>
    },
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('source_language', options.source_language)
    if (options.derived_from) {
      form.append('derived_from', options.derived_from)
      form.append('source_page_map', JSON.stringify(options.source_page_map || {}))
    }
    return request<Document>('/documents', { method: 'POST', body: form })
  },
  drafts: () => request<Draft[]>('/drafts'),
  draft: (id: string) => request<Draft>(`/drafts/${encodeURIComponent(id)}`),
  versions: (id: string) => request<Draft[]>(`/drafts/${encodeURIComponent(id)}/versions`),
  generate: (input: GenerateRequest) =>
    request<Draft>('/generate', { method: 'POST', ...json(input) }),
  update: (id: string, expected_revision: number, result: InvestmentResult) =>
    request<Draft>(`/drafts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      ...json({ expected_revision, result }),
    }),
  approve: (id: string, expected_revision: number) =>
    request<Draft>(`/drafts/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      ...json({ expected_revision }),
    }),
  comparisons: () => request<Comparison[]>('/comparisons'),
}
