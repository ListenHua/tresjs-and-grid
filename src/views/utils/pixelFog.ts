export interface FogCell { threshold: number; tone: number }

function hash(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + 19.3) * 43758.5453
  return value - Math.floor(value)
}

function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const top = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx
  const bottom = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx
  return top * (1 - sy) + bottom * sy
}

export function createFogCells(columns: number, rows: number): FogCell[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns, y = Math.floor(index / columns)
    const cloud = noise(x / 13, y / 10) * 0.7 + noise(x / 5, y / 4) * 0.3
    const edgeDistance = Math.min((x + 0.5) / columns, 1 - (x + 0.5) / columns) * 2
    return {
      threshold: Math.max(0.04, Math.min(0.88, 0.08 + edgeDistance * 0.66 + (cloud - 0.5) * 0.26)),
      tone: Math.min(3, Math.floor(cloud * 4)),
    }
  })
}

export function getFogAlpha(threshold: number, coverage: number) {
  // Four opacity steps keep the fringe pixelated; endpoints are exact.
  return Math.ceil(Math.max(0, Math.min(1, (coverage - threshold) / 0.1)) * 4) / 4
}
