export type Classification =
  'document_supported' | 'founder_provided' | 'assumption' | 'calculation' | 'unknown'
export type Workflow = 'single' | 'multi'
export interface Citation {
  document_id: string
  page: number
  quote: string
}
export interface Statement {
  text: string
  classification: Classification
  citations: Citation[]
}
export interface MapNode extends Statement {
  id: string
  kind: 'funding' | 'expenditure' | 'capability' | 'dependency'
  label: string
}
export interface MapEdge {
  id: string
  source: string
  target: string
  relationship: 'funds' | 'enables' | 'depends_on'
  classification?: Classification
  citations?: Citation[]
}
export interface BudgetField {
  label: string
  amount: string
  currency: string
  role: string
  citation: Citation
  raw_text: string
  units: string
  validation_status: string
}
export interface BudgetCheck {
  currency: string
  status: 'reconciled' | 'conflict' | 'incomplete'
  subtotal_sum: string | null
  printed_total: string | null
  difference: string | null
  description: string
  fields: BudgetField[]
}
export interface InvestmentResult {
  map: { nodes: MapNode[]; edges: MapEdge[] }
  explanation: { title: string; statements: Statement[] }
  gaps: string[]
  assumptions: Statement[]
  contradictions: Statement[]
  budget_checks: BudgetCheck[]
  warnings: string[]
}
export interface GenerateRequest {
  question: string
  founder_notes: string
  document_ids: string[]
  workflow: Workflow
}
export interface Draft {
  id: string
  revision: number
  status: 'draft' | 'approved'
  origin: 'generated' | 'human_edited'
  edited_fields: string[]
  request: GenerateRequest
  result: InvestmentResult
  trace_id: string
  created_at: string
  updated_at: string
  approved_at: string | null
}
export interface DocumentPage {
  page: number
  text: string
}
export interface Document {
  id: string
  filename: string
  content_hash: string
  version: string
  status: 'ready' | 'extraction_failed' | 'malformed' | 'unsupported'
  page_count: number
  pages: DocumentPage[]
  budget_fields: BudgetField[]
  warnings: string[]
  created_at: string
  source_language: string
  derived_from: string | null
  source_page_map?: Record<string, number[]>
}
export interface Configuration {
  configured: boolean
  missing: string[]
  message: string
  limits: Record<string, number | string | boolean>
}
export interface ComparisonArm {
  workflow: Workflow
  case_id: string
  status: 'succeeded' | 'failed'
  latency_ms: number
  model_calls: number
  retries: number
  input_tokens: number | null
  output_tokens: number | null
  usage_complete: boolean
  trace_id: string
  validation_passed: boolean
  error: string | null
  estimated_cost_usd: number | null
}
export interface Comparison {
  id: string
  dataset_version: string
  created_at: string
  model: string
  case_count: number
  conditions: string
  arms: ComparisonArm[]
}

export const classificationLabel: Record<Classification, string> = {
  document_supported: 'Document states',
  founder_provided: 'Founder provided',
  assumption: 'Assumption',
  calculation: 'Calculated',
  unknown: 'Unknown',
}

export const kindLabel: Record<MapNode['kind'], string> = {
  funding: 'Investment interest',
  expenditure: 'Proposed use',
  capability: 'Could enable',
  dependency: 'Dependency',
}
