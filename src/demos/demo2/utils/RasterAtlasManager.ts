import * as THREE from 'three'

export interface GeographicExtent {
  west: number
  south: number
  east: number
  north: number
}

interface PixelPoint {
  x: number
  y: number
}

interface PixelBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface RasterAtlas {
  key: string
  texture: THREE.CanvasTexture
  extent: GeographicExtent
  zoom: number
  sourcePixels: PixelBounds
  canvasPixels: PixelBounds
  failedTiles: number
}

interface RasterAtlasManagerOptions {
  urlTemplate: string
  crossOrigin?: string | null
  tileSize: number
  paddingPixels: number
  maxAtlasSize: number
  maxConcurrentRequests: number
  maxAnisotropy: number
  maxCachedAtlases: number
  maxCachedTexturePixels: number
  maxCachedImages: number
}

interface TileImage {
  image: HTMLImageElement
  x: number
  y: number
}

interface AtlasCacheEntry {
  promise: Promise<RasterAtlas>
  atlas?: RasterAtlas
  references: number
  lastUsed: number
}

interface ImageCacheEntry {
  promise: Promise<HTMLImageElement>
  task: TileLoadTask
  settled: boolean
  lastUsed: number
}

interface TileLoadTask {
  priority: number
  order: number
  started: boolean
  run: () => void
}

function lngLatToGlobalPixel(lng: number, lat: number, zoom: number, tileSize: number): PixelPoint {
  const scale = 2 ** zoom * tileSize
  const safeLatitude = Math.max(-85.0511287798, Math.min(85.0511287798, lat))
  const latitudeRadians = safeLatitude * Math.PI / 180
  return {
    x: (lng + 180) / 360 * scale,
    y: (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale,
  }
}

function globalPixelBoundsToExtent(bounds: PixelBounds, zoom: number, tileSize: number): GeographicExtent {
  const scale = 2 ** zoom * tileSize
  const longitude = (x: number) => x / scale * 360 - 180
  const latitude = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI
  return {
    west: longitude(bounds.left),
    south: latitude(bounds.bottom),
    east: longitude(bounds.right),
    north: latitude(bounds.top),
  }
}

function atlasBounds(extent: GeographicExtent, zoom: number, tileSize: number, padding: number) {
  const northWest = lngLatToGlobalPixel(extent.west, extent.north, zoom, tileSize)
  const southEast = lngLatToGlobalPixel(extent.east, extent.south, zoom, tileSize)
  const sourcePixels: PixelBounds = {
    left: northWest.x,
    top: northWest.y,
    right: southEast.x,
    bottom: southEast.y,
  }
  const canvasPixels: PixelBounds = {
    left: Math.floor(sourcePixels.left) - padding,
    top: Math.floor(sourcePixels.top) - padding,
    right: Math.ceil(sourcePixels.right) + padding,
    bottom: Math.ceil(sourcePixels.bottom) + padding,
  }
  return { sourcePixels, canvasPixels }
}

function canvasSize(bounds: PixelBounds) {
  return {
    width: Math.max(1, bounds.right - bounds.left),
    height: Math.max(1, bounds.bottom - bounds.top),
  }
}

export class RasterAtlasManager {
  private readonly atlasCache = new Map<string, AtlasCacheEntry>()
  private readonly imageCache = new Map<string, ImageCacheEntry>()
  private readonly loadQueue: TileLoadTask[] = []
  private readonly options: RasterAtlasManagerOptions
  private activeLoads = 0
  private accessSequence = 0
  private queueSequence = 0
  private revision = 0
  private disposed = false

  constructor(options: RasterAtlasManagerOptions) {
    this.options = options
  }

  canRenderAtZoom(extent: GeographicExtent, zoom: number) {
    const { canvasPixels } = atlasBounds(
      extent,
      zoom,
      this.options.tileSize,
      this.options.paddingPixels,
    )
    const { width, height } = canvasSize(canvasPixels)
    return width <= this.options.maxAtlasSize && height <= this.options.maxAtlasSize
  }

  getAtlas(id: string, extent: GeographicExtent, requestedZoom: number, priority = 0) {
    this.pruneAtlasCache()
    const zoom = this.resolveZoom(extent, requestedZoom)
    const { canvasPixels } = atlasBounds(extent, zoom, this.options.tileSize, this.options.paddingPixels)
    const key = [
      id,
      zoom,
      canvasPixels.left,
      canvasPixels.top,
      canvasPixels.right,
      canvasPixels.bottom,
    ].join(':')
    const cached = this.atlasCache.get(key)
    if (cached) {
      cached.lastUsed = ++this.accessSequence
      return cached.promise
    }

    const entry: AtlasCacheEntry = {
      promise: Promise.resolve(null as unknown as RasterAtlas),
      references: 0,
      lastUsed: ++this.accessSequence,
    }
    const promise = this.createAtlas(key, extent, zoom, priority)
      .then((atlas) => {
        entry.atlas = atlas
        return atlas
      })
      .catch((error) => {
        if (this.atlasCache.get(key) === entry) this.atlasCache.delete(key)
        throw error
      })
    entry.promise = promise
    this.atlasCache.set(key, entry)
    promise.then(
      () => queueMicrotask(() => this.pruneAtlasCache()),
      () => {},
    )
    return promise
  }

  retainAtlas(atlas: RasterAtlas) {
    const entry = this.atlasCache.get(atlas.key)
    if (!entry) return
    entry.references += 1
    entry.lastUsed = ++this.accessSequence
  }

  releaseAtlas(atlas: RasterAtlas) {
    const entry = this.atlasCache.get(atlas.key)
    if (!entry) return
    entry.references = Math.max(0, entry.references - 1)
    entry.lastUsed = ++this.accessSequence
    this.pruneAtlasCache()
  }

  dispose() {
    this.disposed = true
    this.revision += 1
    this.atlasCache.forEach(entry => entry.atlas?.texture.dispose())
    this.atlasCache.clear()
    this.imageCache.clear()
    this.drainQueue()
  }

  private resolveZoom(extent: GeographicExtent, requestedZoom: number) {
    let zoom = requestedZoom
    while (zoom > 0) {
      const { canvasPixels } = atlasBounds(
        extent,
        zoom,
        this.options.tileSize,
        this.options.paddingPixels,
      )
      const { width, height } = canvasSize(canvasPixels)
      if (width <= this.options.maxAtlasSize && height <= this.options.maxAtlasSize) break
      zoom -= 1
    }
    return zoom
  }

  private async createAtlas(
    key: string,
    extent: GeographicExtent,
    zoom: number,
    priority: number,
  ): Promise<RasterAtlas> {
    if (this.disposed) throw new Error('Raster atlas manager has been disposed')
    const revision = this.revision
    const { tileSize, paddingPixels } = this.options
    const { canvasPixels } = atlasBounds(extent, zoom, tileSize, paddingPixels)
    const coverageExtent = globalPixelBoundsToExtent(canvasPixels, zoom, tileSize)
    const { width, height } = canvasSize(canvasPixels)
    const minTileX = Math.floor(canvasPixels.left / tileSize)
    const maxTileX = Math.floor((canvasPixels.right - 1) / tileSize)
    const minTileY = Math.floor(canvasPixels.top / tileSize)
    const maxTileY = Math.floor((canvasPixels.bottom - 1) / tileSize)
    const tileCount = 2 ** zoom
    const tasks: Array<Promise<TileImage>> = []

    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (y < 0 || y >= tileCount) continue
      for (let x = minTileX; x <= maxTileX; x += 1) {
        const normalizedX = ((x % tileCount) + tileCount) % tileCount
        const url = this.tileUrl(normalizedX, y, zoom)
        tasks.push(this.loadImage(url, priority).then(image => ({ image, x, y })))
      }
    }

    const results = await Promise.allSettled(tasks)
    if (this.disposed || revision !== this.revision) {
      throw new Error('Raster atlas request was superseded')
    }

    const loadedTiles = results
      .filter((result): result is PromiseFulfilledResult<TileImage> => result.status === 'fulfilled')
      .map(result => result.value)
    if (loadedTiles.length === 0) throw new Error(`No raster tiles loaded at zoom ${zoom}`)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to create raster atlas canvas')
    context.fillStyle = '#20302b'
    context.fillRect(0, 0, width, height)
    loadedTiles.forEach(({ image, x, y }) => {
      context.drawImage(
        image,
        x * tileSize - canvasPixels.left,
        y * tileSize - canvasPixels.top,
        tileSize,
        tileSize,
      )
    })

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.anisotropy = this.options.maxAnisotropy
    texture.needsUpdate = true

    return {
      key,
      texture,
      extent: coverageExtent,
      zoom,
      sourcePixels: canvasPixels,
      canvasPixels,
      failedTiles: results.length - loadedTiles.length,
    }
  }

  private loadImage(url: string, priority: number) {
    const cached = this.imageCache.get(url)
    if (cached) {
      cached.lastUsed = ++this.accessSequence
      if (!cached.task.started && priority > cached.task.priority) {
        cached.task.priority = priority
        this.sortLoadQueue()
      }
      return cached.promise
    }

    let task!: TileLoadTask
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      task = {
        priority,
        order: this.queueSequence++,
        started: false,
        run: () => {
          task.started = true
          if (this.disposed) {
            this.finishLoad()
            reject(new Error('Raster image request cancelled'))
            return
          }
          const image = new Image()
          if (this.options.crossOrigin !== null && this.options.crossOrigin !== undefined) {
            image.crossOrigin = this.options.crossOrigin
          }
          image.decoding = 'async'
          image.onload = () => {
            image.onload = null
            image.onerror = null
            this.finishLoad()
            resolve(image)
          }
          image.onerror = () => {
            image.onload = null
            image.onerror = null
            this.finishLoad()
            reject(new Error(`Failed to load raster tile: ${url}`))
          }
          image.src = url
        },
      }
      this.loadQueue.push(task)
      this.sortLoadQueue()
      this.drainQueue()
    })
    const entry: ImageCacheEntry = {
      promise,
      task,
      settled: false,
      lastUsed: ++this.accessSequence,
    }
    this.imageCache.set(url, entry)
    promise.then(
      () => {
        entry.settled = true
        this.pruneImageCache()
      },
      () => {
        entry.settled = true
        if (this.imageCache.get(url) === entry) this.imageCache.delete(url)
      },
    )
    return promise
  }

  private sortLoadQueue() {
    this.loadQueue.sort((a, b) => b.priority - a.priority || a.order - b.order)
  }

  private drainQueue() {
    while (this.activeLoads < this.options.maxConcurrentRequests && this.loadQueue.length > 0) {
      const task = this.loadQueue.shift()
      if (!task) return
      this.activeLoads += 1
      task.run()
    }
  }

  private finishLoad() {
    this.activeLoads = Math.max(0, this.activeLoads - 1)
    this.drainQueue()
  }

  private pruneAtlasCache() {
    let texturePixels = 0
    this.atlasCache.forEach(({ atlas }) => {
      if (!atlas) return
      const { width, height } = canvasSize(atlas.canvasPixels)
      texturePixels += width * height
    })

    const candidates = [...this.atlasCache.entries()]
      .filter(([, entry]) => entry.atlas && entry.references === 0)
      .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
    while (
      candidates.length > 0
      && (
        this.atlasCache.size > this.options.maxCachedAtlases
        || texturePixels > this.options.maxCachedTexturePixels
      )
    ) {
      const [key, entry] = candidates.shift()!
      const atlas = entry.atlas!
      const { width, height } = canvasSize(atlas.canvasPixels)
      if (this.atlasCache.get(key) !== entry) continue
      this.atlasCache.delete(key)
      atlas.texture.dispose()
      texturePixels -= width * height
    }
  }

  private pruneImageCache() {
    if (this.imageCache.size <= this.options.maxCachedImages) return
    const candidates = [...this.imageCache.entries()]
      .filter(([, entry]) => entry.settled)
      .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
    while (this.imageCache.size > this.options.maxCachedImages && candidates.length > 0) {
      const [url, entry] = candidates.shift()!
      if (this.imageCache.get(url) === entry) this.imageCache.delete(url)
    }
  }

  private tileUrl(x: number, y: number, z: number) {
    return this.options.urlTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
  }
}
