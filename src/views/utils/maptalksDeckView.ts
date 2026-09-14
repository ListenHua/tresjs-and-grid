import { MapController, View, Viewport } from '@deck.gl/core'
import type { Map } from 'maptalks'

/** Use maptalks' actual camera, including its FOV, pitch and bearing. */
export class MaptalksView extends View<{
  viewMatrix?: number[]
  projectionMatrix?: number[]
  transitionDuration?: number
}> {
  getViewportType() { return Viewport }
  get ControllerType() { return MapController }
}

export function createMaptalksDeckView(map: Map, origin: [number, number]) {
  // maptalks exposes these renderer matrices at runtime (also used by maptalks.three).
  const camera = map as Map & { viewMatrix: number[]; projMatrix: number[] }
  const viewMatrix = Array.from(camera.viewMatrix)
  // Grid positions are relative to a nearby origin to preserve float precision.
  for (let row = 0; row < 4; row += 1) {
    viewMatrix[12 + row] += viewMatrix[row]! * origin[0] + viewMatrix[4 + row]! * origin[1]
  }
  return new MaptalksView({
    id: 'pixel-map', controller: false,
    viewState: { viewMatrix, projectionMatrix: Array.from(camera.projMatrix) },
  })
}
