import china from '../data/china-boundary.json'
import { PROTECT_AREAS } from '../data/protectAreas'
import { AREA_TYPE_FILL_ORDER, PIXEL_MAP_CONFIG } from '../config'
import { intersectsPixelBounds, MERCATOR_WORLD_SIZE, pixelRowSpans, preparePixelPolygons } from '../utils/pixelGrid'
import type { PixelBounds, PixelGridRequest, PixelGridResult, PixelPolygon } from '../utils/pixelGrid'

const land = china.features.flatMap(feature => preparePixelPolygons(feature.geometry.coordinates))
const zones = PROTECT_AREAS.features.map((feature, index) => ({
  index,
  type: feature.properties.BHDLX,
  polygons: preparePixelPolygons(feature.geometry.coordinates),
})).sort((first, second) => AREA_TYPE_FILL_ORDER[first.type] - AREA_TYPE_FILL_ORDER[second.type])
const tileCache = new Map<string, Int16Array>()
const tileSize = PIXEL_MAP_CONFIG.tileSize

function getTile(request: PixelGridRequest, column: number, row: number, size: number) {
  const key = `${request.level}/${column}/${row}/${request.detail ? [...request.visibleTypes].sort().join(',') : ''}`
  const cached = tileCache.get(key)
  if (cached) {
    tileCache.delete(key)
    tileCache.set(key, cached)
    return cached
  }
  const firstColumn = column * tileSize
  const firstRow = row * tileSize
  const bounds: PixelBounds = [firstColumn * size, firstRow * size, (firstColumn + tileSize) * size, (firstRow + tileSize) * size]
  const owners = new Int16Array(tileSize * tileSize).fill(-2)
  function fill(polygons: PixelPolygon[], owner: number) {
    polygons.filter(polygon => intersectsPixelBounds(polygon.bounds, bounds)).forEach(polygon => {
      for (let offset = 0; offset < tileSize; offset += 1) {
        const vertical = (firstRow + offset + 0.5) * size
        pixelRowSpans(polygon, vertical).forEach(([start, end]) => {
          const from = Math.max(firstColumn, Math.ceil(start / size - 0.5))
          const to = Math.min(firstColumn + tileSize, Math.ceil(end / size - 0.5))
          for (let cellColumn = from; cellColumn < to; cellColumn += 1) {
            owners[offset * tileSize + cellColumn - firstColumn] = owner
          }
        })
      }
    })
  }
  fill(land, -1)
  if (request.detail) zones.filter(zone => request.visibleTypes.includes(zone.type)).forEach(zone => fill(zone.polygons, zone.index))
  tileCache.set(key, owners)
  while (tileCache.size > PIXEL_MAP_CONFIG.maxCachedTiles) tileCache.delete(tileCache.keys().next().value!)
  return owners
}

function buildGrid(request: PixelGridRequest): PixelGridResult {
  const size = MERCATOR_WORLD_SIZE / 2 ** request.level
  const [west, south, east, north] = request.bounds
  if (west >= east || south >= north) return { id: request.id, size, cells: new Float64Array(), owners: new Int16Array() }
  const firstColumn = Math.floor(west / size)
  const lastColumn = Math.ceil(east / size)
  const firstRow = Math.floor(south / size)
  const lastRow = Math.ceil(north / size)
  if ((lastColumn - firstColumn) * (lastRow - firstRow) > PIXEL_MAP_CONFIG.maxCells) throw new Error('像素网格超出数量上限')
  const cells: number[] = []
  const owners: number[] = []
  for (let tileRow = Math.floor(firstRow / tileSize); tileRow <= Math.floor((lastRow - 1) / tileSize); tileRow += 1) {
    for (let tileColumn = Math.floor(firstColumn / tileSize); tileColumn <= Math.floor((lastColumn - 1) / tileSize); tileColumn += 1) {
      const tile = getTile(request, tileColumn, tileRow, size)
      for (let row = Math.max(firstRow, tileRow * tileSize); row < Math.min(lastRow, (tileRow + 1) * tileSize); row += 1) {
        for (let column = Math.max(firstColumn, tileColumn * tileSize); column < Math.min(lastColumn, (tileColumn + 1) * tileSize); column += 1) {
          const owner = tile[(row - tileRow * tileSize) * tileSize + column - tileColumn * tileSize]!
          if (owner === -2) continue
          cells.push((column + 0.5) * size, (row + 0.5) * size)
          owners.push(owner)
        }
      }
    }
  }
  return { id: request.id, size, cells: new Float64Array(cells), owners: new Int16Array(owners) }
}

self.onmessage = (event: MessageEvent<PixelGridRequest>) => {
  try {
    const result = buildGrid(event.data)
    self.postMessage(result, { transfer: [result.cells.buffer, result.owners.buffer] })
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : '像素网格生成失败' })
  }
}
