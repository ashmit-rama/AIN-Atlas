import { describe, expect, it } from 'vitest'
import { layoutGraph } from './graph'
import type { InvestmentResult } from './contracts'

const fixture: InvestmentResult = {
  map: {
    nodes: [
      {
        id: 'fund',
        kind: 'funding',
        label: 'Interest',
        text: '',
        classification: 'unknown',
        citations: [],
      },
      {
        id: 'site',
        kind: 'expenditure',
        label: 'Proposed site',
        text: '',
        classification: 'assumption',
        citations: [],
      },
      {
        id: 'capacity',
        kind: 'capability',
        label: 'Capacity',
        text: '',
        classification: 'assumption',
        citations: [],
      },
    ],
    edges: [
      { id: 'f1', source: 'fund', target: 'site', relationship: 'funds' },
      { id: 'e1', source: 'site', target: 'capacity', relationship: 'enables' },
    ],
  },
  explanation: { title: '', statements: [] },
  gaps: [],
  assumptions: [],
  contradictions: [],
  budget_checks: [],
  warnings: [],
}

describe('deterministic conceptual map layout', () => {
  it('places spending before enabled capabilities and labels typed relationships', () => {
    const first = layoutGraph(fixture)
    expect(first.nodes.map((n) => n.position.x)).toEqual([28, 353, 678])
    expect(first.edges.map((e) => e.label)).toEqual(['FUNDS', 'ENABLES'])
    expect(layoutGraph(fixture)).toEqual(first)
  })
})
