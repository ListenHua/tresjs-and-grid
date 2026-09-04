import { describe, expect, it, vi } from 'vitest'

vi.mock('maptalks', () => ({ GeoJSON: {} }))
vi.mock('maptalks.three', () => ({ ThreeLayer: class ThreeLayer {} }))

import { extractBoundaryEdgeIndices } from './useProtectAreaLayer'

function normalizedEdges(indices: number[]) {
  const edges: string[] = []
  for (let index = 0; index < indices.length; index += 2) {
    edges.push([indices[index], indices[index + 1]].sort((a, b) => a - b).join(':'))
  }
  return edges.sort()
}

describe('extractBoundaryEdgeIndices', () => {
  it('removes the shared diagonal from a triangulated surface', () => {
    expect(normalizedEdges(extractBoundaryEdgeIndices([0, 1, 2, 0, 2, 3]))).toEqual([
      '0:1',
      '0:3',
      '1:2',
      '2:3',
    ])
  })

  it('preserves the boundaries of disconnected surface parts', () => {
    expect(normalizedEdges(extractBoundaryEdgeIndices([0, 1, 2, 3, 4, 5]))).toEqual([
      '0:1',
      '0:2',
      '1:2',
      '3:4',
      '3:5',
      '4:5',
    ])
  })
})
