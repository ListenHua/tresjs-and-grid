import type { RegionDatum } from '../types/map'

const CENTER = [116.3913, 39.9075]
const CELL_WIDTH = 0.035
const CELL_HEIGHT = 0.026
const GAP = 0.0038

const metadata = [
  ['A01', '中枢商务区', '核心区', 92, 2100],
  ['A02', '文化交流区', '更新区', 64, 1380],
  ['A03', '滨水活力区', '生态区', 48, 820],
  ['B01', '数字产业区', '更新区', 78, 1740],
  ['B02', '城市会客厅', '核心区', 100, 2520],
  ['B03', '公共服务区', '更新区', 71, 1510],
  ['C01', '科创孵化区', '更新区', 83, 1920],
  ['C02', '中央绿谷', '生态区', 36, 620],
  ['C03', '复合居住区', '核心区', 57, 1160],
] as const

function polygonFor(index: number): number[][] {
  const row = Math.floor(index / 3) - 1
  const column = (index % 3) - 1
  const centerLng = CENTER[0] + column * CELL_WIDTH
  const centerLat = CENTER[1] - row * CELL_HEIGHT
  const halfWidth = (CELL_WIDTH - GAP) / 2
  const halfHeight = (CELL_HEIGHT - GAP) / 2
  const cut = 0.003 + (index % 2) * 0.0015

  return [
    [centerLng - halfWidth + cut, centerLat - halfHeight],
    [centerLng + halfWidth, centerLat - halfHeight],
    [centerLng + halfWidth, centerLat + halfHeight - cut],
    [centerLng + halfWidth - cut, centerLat + halfHeight],
    [centerLng - halfWidth, centerLat + halfHeight],
    [centerLng - halfWidth, centerLat - halfHeight + cut],
    [centerLng - halfWidth + cut, centerLat - halfHeight],
  ]
}

export const REGIONS: RegionDatum[] = metadata.map((item, index) => ({
  id: item[0], name: item[1], category: item[2], value: item[3], height: item[4], coordinates: polygonFor(index),
}))

export const INITIAL_VIEW = {
  center: CENTER as [number, number], zoom: 12.25, pitch: 57, bearing: -18,
}
