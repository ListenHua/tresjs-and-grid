import type { Map as MapInstance } from 'maptalks'

export function waitForMapArrival(map: MapInstance, rasterReady: () => boolean, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return }
    let baseLayer = map.getBaseLayer()
    let baseReady = !baseLayer
    let timer: ReturnType<typeof setTimeout> | undefined

    function finish() {
      clearTimeout(timer)
      baseLayer?.off('layerload', onBaseReady)
      signal.removeEventListener('abort', finish)
      resolve()
    }

    function onBaseReady() {
      baseReady = true
    }

    function check() {
      if (signal.aborted) { finish(); return }
      const currentLayer = map.getBaseLayer()
      if (currentLayer !== baseLayer) {
        baseLayer?.off('layerload', onBaseReady)
        baseLayer = currentLayer
        baseReady = !baseLayer
        baseLayer?.on('layerload', onBaseReady)
      }
      if (baseReady && rasterReady()) finish()
      else timer = setTimeout(check, 40)
    }

    baseLayer?.on('layerload', onBaseReady)
    signal.addEventListener('abort', finish, { once: true })
    check()
  })
}
