import type { Edge, Node } from '@xyflow/react'
import type { InvestmentResult } from './contracts'

export const edgeLabel = { funds: 'FUNDS', enables: 'ENABLES', depends_on: 'DEPENDS ON' } as const

/** Stable columns make the same structured result render in the same conceptual order. */
export function layoutGraph(result: InvestmentResult): { nodes: Node[]; edges: Edge[] } {
  const order = { funding: 0, expenditure: 1, capability: 2, dependency: 3 }
  const counts = [0, 0, 0, 0]
  const nodes: Node[] = result.map.nodes.map((item) => {
    const column = order[item.kind]
    const row = counts[column]++
    return {
      id: item.id,
      type: 'atlas',
      position: { x: column * 325 + 28, y: row * 178 + 44 },
      data: { item },
    }
  })
  const colors = { funds: '#40a894', enables: '#7393af', depends_on: '#ca9a56' }
  const edges: Edge[] = result.map.edges.map((item) => ({
    id: item.id,
    source: item.source,
    target: item.target,
    type: 'smoothstep',
    label: edgeLabel[item.relationship],
    animated: false,
    style: {
      stroke: colors[item.relationship],
      strokeWidth: 2,
      strokeDasharray: item.classification === 'document_supported' ? undefined : '5 4',
    },
    labelStyle: { fill: '#476170', fontSize: 10, fontWeight: 700, letterSpacing: 1 },
    labelBgStyle: { fill: '#f8faf9' },
    labelBgPadding: [7, 4],
  }))
  return { nodes, edges }
}
