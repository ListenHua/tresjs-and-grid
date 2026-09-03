import {
  Color,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import type { PerspectiveCamera, Vector3 } from 'three'
import {
  mercatorToLngLat,
  lngLatToTile,
  normalizeTileX,
  tileBounds,
  WORLD_SIZE,
} from './coordinates'
import type { MercatorCoordinate } from './coordinates'
import type { TileSource } from './mapConfig'
import type { MapLogger } from '../hooks/useMapLogger'

export interface TileStats {
  loaded: number
  loading: number
  failed: number
  zoom: number
}

interface TileEntry {
  key: string
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  texture?: Texture
  status: 'loading' | 'loaded' | 'failed'
  lastUsed: number
}

interface TileManagerOptions {
  group: Group
  camera: PerspectiveCamera
  origin: MercatorCoordinate
  source: TileSource
  opacity: number
  logger: MapLogger
  onStats: (stats: TileStats) => void
}

const MAX_CACHE_SIZE = 150

export class TileManager {
  private readonly group: Group
  private readonly camera: PerspectiveCamera
  private readonly origin: MercatorCoordinate
  private readonly loader = new TextureLoader()
  private readonly entries = new Map<string, TileEntry>()
  private readonly onStats: (stats: TileStats) => void
  private readonly logger: MapLogger
  private source: TileSource
  private opacity: number
  private revision = 0
  private currentZoom = 15

  constructor(options: TileManagerOptions) {
    this.group = options.group
    this.camera = options.camera
    this.origin = options.origin
    this.source = options.source
    this.opacity = options.opacity
    this.logger = options.logger
    this.onStats = options.onStats
  }

  get zoom() {
    return this.currentZoom
  }

  update(target: Vector3, force = false) {
    const distance = this.camera.position.distanceTo(target)
    const nextZoom = Math.max(
      this.source.minZoom,
      Math.min(this.source.maxZoom, Math.round(18 - Math.log2(Math.max(distance, 200) / 500))),
    )
    const centerMercator = {
      x: this.origin.x + target.x,
      y: this.origin.y - target.z,
    }
    const center = mercatorToLngLat(centerMercator)
    const centerTile = lngLatToTile(center, nextZoom)
    const tileWorldSize = WORLD_SIZE / 2 ** nextZoom
    const visibleHalfWidth = distance * Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect
    const radius = Math.max(2, Math.min(4, Math.ceil(visibleHalfWidth / tileWorldSize) + 1))
    const signature = `${this.source.id}:${nextZoom}:${centerTile.x}:${centerTile.y}:${radius}`

    if (!force && this.group.userData.tileSignature === signature) return
    this.group.userData.tileSignature = signature
    const previousZoom = this.currentZoom
    this.currentZoom = nextZoom

    const required = new Set<string>()
    const tileCount = 2 ** nextZoom
    for (let row = centerTile.y - radius; row <= centerTile.y + radius; row += 1) {
      if (row < 0 || row >= tileCount) continue
      for (let column = centerTile.x - radius; column <= centerTile.x + radius; column += 1) {
        const x = normalizeTileX(column, nextZoom)
        const key = `${this.source.id}:${nextZoom}:${x}:${row}`
        required.add(key)
        const existing = this.entries.get(key)
        if (existing) {
          existing.lastUsed = performance.now()
          existing.mesh.visible = true
        } else {
          this.loadTile(key, x, row, nextZoom)
        }
      }
    }

    for (const entry of this.entries.values()) {
      if (!required.has(entry.key)) entry.mesh.visible = false
    }
    if (previousZoom !== nextZoom) {
      this.logger.info('map.zoom.change', '瓦片层级发生变化', {
        previousZoom,
        zoom: nextZoom,
        cameraDistance: Math.round(distance),
      })
    }
    this.logger.info('tile.range.change', '更新可见瓦片范围', {
      source: this.source.id,
      zoom: nextZoom,
      centerTile: { x: centerTile.x, y: centerTile.y },
      radius,
      required: required.size,
    })
    this.trimCache()
    this.emitStats()
  }

  setSource(source: TileSource, target: Vector3) {
    if (source.id === this.source.id) return
    const previous = this.source.id
    this.source = source
    this.logger.info('source.change', '切换底图数据源', {
      previous,
      current: source.id,
    })
    this.group.userData.tileSignature = ''
    this.update(target, true)
  }

  setOpacity(opacity: number) {
    const previous = this.opacity
    this.opacity = opacity
    for (const entry of this.entries.values()) {
      entry.mesh.material.opacity = opacity
      entry.mesh.material.transparent = opacity < 1
    }
    this.logger.info('map.opacity.change', '调整底图透明度', { previous, current: opacity })
  }

  dispose() {
    const tileCount = this.entries.size
    this.revision += 1
    for (const entry of this.entries.values()) this.disposeEntry(entry)
    this.entries.clear()
    this.logger.info('map.dispose', '释放瓦片管理器资源', { tileCount })
  }

  private loadTile(key: string, x: number, y: number, z: number) {
    const bounds = tileBounds(x, y, z)
    const width = bounds.east - bounds.west
    const height = bounds.north - bounds.south
    const geometry = new PlaneGeometry(width + 0.35, height + 0.35)
    const material = new MeshBasicMaterial({
      color: new Color('#1a211f'),
      opacity: this.opacity,
      transparent: this.opacity < 1,
      toneMapped: false,
      depthWrite: true,
    })
    const mesh = new Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(
      (bounds.west + bounds.east) / 2 - this.origin.x,
      0,
      this.origin.y - (bounds.north + bounds.south) / 2,
    )
    mesh.renderOrder = -10
    const entry: TileEntry = {
      key,
      mesh,
      status: 'loading',
      lastUsed: performance.now(),
    }
    this.entries.set(key, entry)
    this.group.add(mesh)
    const revision = this.revision
    const startedAt = performance.now()
    const url = this.getTileUrl(x, y, z)

    this.logger.debug('tile.load.start', '开始加载瓦片', { key, x, y, z })

    this.loader.load(
      url,
      (texture) => {
        if (revision !== this.revision || !this.entries.has(key)) {
          texture.dispose()
          return
        }
        texture.colorSpace = SRGBColorSpace
        texture.minFilter = LinearMipmapLinearFilter
        entry.texture = texture
        entry.mesh.material.map = texture
        entry.mesh.material.color.set('#ffffff')
        entry.mesh.material.needsUpdate = true
        entry.status = 'loaded'
        this.logger.debug('tile.load.success', '瓦片加载成功', {
          key,
          duration: Math.round(performance.now() - startedAt),
        })
        this.emitStats()
      },
      undefined,
      () => {
        if (revision !== this.revision || !this.entries.has(key)) return
        entry.status = 'failed'
        entry.mesh.material.color.set('#232a27')
        this.logger.error('tile.load.error', '瓦片加载失败', {
          key,
          url,
          duration: Math.round(performance.now() - startedAt),
        })
        this.emitStats()
      },
    )
  }

  private getTileUrl(x: number, y: number, z: number) {
    const subdomains = this.source.subdomains
    const subdomain = subdomains?.[(x + y) % subdomains.length] ?? ''
    return this.source.url
      .replace('{s}', subdomain)
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
  }

  private trimCache() {
    if (this.entries.size <= MAX_CACHE_SIZE) return
    const hidden = [...this.entries.values()]
      .filter(entry => !entry.mesh.visible)
      .sort((a, b) => a.lastUsed - b.lastUsed)
    const removeCount = this.entries.size - MAX_CACHE_SIZE
    const removed = hidden.slice(0, removeCount)
    for (const entry of removed) {
      this.entries.delete(entry.key)
      this.disposeEntry(entry)
    }
    if (removed.length > 0) {
      this.logger.debug('tile.cache.remove', '清理瓦片缓存', {
        removed: removed.length,
        remaining: this.entries.size,
      })
    }
  }

  private disposeEntry(entry: TileEntry) {
    this.group.remove(entry.mesh)
    entry.texture?.dispose()
    entry.mesh.geometry.dispose()
    entry.mesh.material.dispose()
  }

  private emitStats() {
    let loaded = 0
    let loading = 0
    let failed = 0
    for (const entry of this.entries.values()) {
      if (!entry.mesh.visible) continue
      if (entry.status === 'loaded') loaded += 1
      if (entry.status === 'loading') loading += 1
      if (entry.status === 'failed') failed += 1
    }
    this.onStats({ loaded, loading, failed, zoom: this.currentZoom })
  }
}
