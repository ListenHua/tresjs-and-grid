import type { TileLayer } from 'maptalks'

export interface RasterSource {
  id: string
  tileSize: number
  crossOrigin: string
  minZoom: number
  maxZoom: number
  getZoom: () => number | null
  getWorldSize: (zoom: number) => number
  getTileUrl: (tileX: number, tileY: number, zoom: number) => string
}

const MERCATOR_HALF_WORLD = Math.PI * 6378137

export function resolveRasterSource(layer: TileLayer): RasterSource {
  const map = layer.getMap()
  if (!map) throw new Error('底图尚未加入地图')
  const reference = layer.getSpatialReference()
  const extent = reference.getFullExtent()
  const tileSize = layer.getTileSize()
  const options = layer.options
  const zoomOffset = options.zoomOffset ?? 0
  const tileSystem = options.tileSystem
  const expectedTileSystem = [1, -1, -MERCATOR_HALF_WORLD, MERCATOR_HALF_WORLD]
  const offset = options.offset

  if (reference.getProjection().code !== 'EPSG:3857' || !reference.isPyramid()
    || Math.abs(extent.xmin! + MERCATOR_HALF_WORLD) > 0.01
    || Math.abs(extent.xmax! - MERCATOR_HALF_WORLD) > 0.01
    || Math.abs(extent.ymin! + MERCATOR_HALF_WORLD) > 0.01
    || Math.abs(extent.ymax! - MERCATOR_HALF_WORLD) > 0.01) {
    throw new Error('顶面贴图暂仅支持全球 EPSG:3857 栅格瓦片')
  }
  if (tileSystem && tileSystem.some((value, index) => Math.abs(value - expectedTileSystem[index]) > 0.01)) {
    throw new Error('顶面贴图暂不支持此瓦片原点或坐标方向')
  }
  if ((typeof offset === 'function' || offset?.some(value => value !== 0))
    || options.fragmentShader || (options.fetchOptions && Object.keys(options.fetchOptions).length > 0)) {
    throw new Error('顶面贴图暂不支持瓦片偏移、自定义着色器或额外请求参数')
  }
  if (!Number.isInteger(tileSize.width) || tileSize.width <= 0 || tileSize.width !== tileSize.height
    || !Number.isInteger(zoomOffset)) {
    throw new Error('顶面贴图需要正方形瓦片和整数 zoomOffset')
  }

  const maxZoom = Math.floor(Math.min(reference.getMaxZoom(), options.maxAvailableZoom ?? reference.getMaxZoom()))
  let minZoom = Math.ceil(Math.max(0, reference.getMinZoom(), options.minZoom ?? 0, -zoomOffset))
  const getWorldSize = (zoom: number) => MERCATOR_HALF_WORLD * 2 / reference.getResolution(zoom)
  while (minZoom <= maxZoom && getWorldSize(minZoom) < tileSize.width - 0.01) minZoom += 1
  if (minZoom > maxZoom) throw new Error('底图没有可用于顶面贴图的瓦片层级')
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    const tileCount = getWorldSize(zoom) / tileSize.width
    if (!Number.isFinite(tileCount) || Math.abs(tileCount - Math.round(tileCount)) > Math.max(1e-6, tileCount * 1e-12)) {
      throw new Error('顶面贴图暂不支持此瓦片矩阵尺寸')
    }
  }

  return {
    id: String(layer.getId()),
    tileSize: tileSize.width,
    crossOrigin: options.crossOrigin || 'anonymous',
    minZoom,
    maxZoom,
    getWorldSize,
    getTileUrl: (tileX, tileY, zoom) => layer.getTileUrl(tileX, tileY, zoom + zoomOffset),
    getZoom: () => {
      if (!layer.isVisible()) return null
      const mapZoom = map.getZoom()
      const resolutionRatio = reference.getResolution(mapZoom) / map.getResolution()
      const zoom = Math.round(Math.min(maxZoom, mapZoom + Math.log2(resolutionRatio)))
      return Number.isFinite(zoom) && zoom >= minZoom ? zoom : null
    },
  }
}
