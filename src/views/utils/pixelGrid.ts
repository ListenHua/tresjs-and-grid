import type { ProtectAreaType } from '../types/map'

export const MERCATOR_WORLD_SIZE = 40075016.68557849
export type PixelPoint = [number, number]
export type PixelBounds = [number, number, number, number]
export interface PixelPolygon {
  rings: PixelPoint[][]
  bounds: PixelBounds
}
export interface PixelGridRequest {
  id: number
  bounds: PixelBounds
  level: number
  detail: boolean
  visibleTypes: ProtectAreaType[]
  reveal?: { origin: PixelPoint; focusBounds: PixelBounds; focusLevel: number; nearRadius: number }
}
export interface PixelRevealSchedule {
  origin: PixelPoint
  nearRadius: number
  minDistance: number
  maxDistance: number
}
export interface PixelGridResult {
  id: number
  size: number
  cells: Float64Array
  sizes: Float64Array
  starts: Float32Array
  owners: Int16Array
  reveal?: PixelRevealSchedule
  error?: string
}

export function projectPixelPoint(longitude: number, latitude: number): PixelPoint {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude))
  return [longitude / 360 * MERCATOR_WORLD_SIZE,
    Math.log(Math.tan(Math.PI / 4 + clampedLatitude * Math.PI / 360)) * MERCATOR_WORLD_SIZE / (2 * Math.PI)]
}

export function unprojectPixelPoint(horizontal: number, vertical: number): PixelPoint {
  return [horizontal / MERCATOR_WORLD_SIZE * 360,
    (2 * Math.atan(Math.exp(vertical / MERCATOR_WORLD_SIZE * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI]
}

export function preparePixelPolygons(coordinates: number[][][][]): PixelPolygon[] {
  return coordinates.map(polygon => {
    const bounds: PixelBounds = [Infinity, Infinity, -Infinity, -Infinity]
    const rings = polygon.map(ring => ring.map(coordinate => {
      const point = projectPixelPoint(coordinate[0], coordinate[1])
      bounds[0] = Math.min(bounds[0], point[0])
      bounds[1] = Math.min(bounds[1], point[1])
      bounds[2] = Math.max(bounds[2], point[0])
      bounds[3] = Math.max(bounds[3], point[1])
      return point
    }))
    return { rings, bounds }
  })
}

export function intersectsPixelBounds(first: PixelBounds, second: PixelBounds) {
  return first[0] <= second[2] && first[2] >= second[0] && first[1] <= second[3] && first[3] >= second[1]
}

export function pixelRowSpans(polygon: PixelPolygon, vertical: number): PixelPoint[] {
  if (vertical < polygon.bounds[1] || vertical >= polygon.bounds[3]) return []
  const intersections: number[] = []
  polygon.rings.forEach(ring => {
    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
      const start = ring[previous]!
      const end = ring[current]!
      if ((start[1] > vertical) === (end[1] > vertical)) continue
      intersections.push(start[0] + (vertical - start[1]) * (end[0] - start[0]) / (end[1] - start[1]))
    }
  })
  intersections.sort((first, second) => first - second)
  const spans: PixelPoint[] = []
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    spans.push([intersections[index]!, intersections[index + 1]!])
  }
  return spans
}

export function resolvePixelLevel(bounds: PixelBounds, desiredLevel: number, maxCells: number) {
  let level = desiredLevel
  while (level > 0) {
    const size = MERCATOR_WORLD_SIZE / 2 ** level
    const columns = Math.max(0, Math.ceil(bounds[2] / size) - Math.floor(bounds[0] / size))
    const rows = Math.max(0, Math.ceil(bounds[3] / size) - Math.floor(bounds[1] / size))
    if (columns * rows <= maxCells) break
    level -= 1
  }
  return level
}
