import { ColumnLayer } from '@deck.gl/layers'
import type { Color } from '@deck.gl/core'
import type { ProtectAreaFeature } from '../types/map'
import { PIXEL_REVEAL_CONFIG } from '../config'

export interface PixelCell {
  position: [number, number, number]
  size: number
  start: number
  color: Color
  feature?: ProtectAreaFeature
}

const pixelUniforms = {
  name: 'pixel',
  vs: `layout(std140) uniform pixelUniforms {
    float time;
    float duration;
    float startScale;
  } pixel;`,
  uniformTypes: { time: 'f32', duration: 'f32', startScale: 'f32' },
} as const

/** ColumnLayer owns instancing, picking and elevation transitions; only reveal is custom. */
export class PixelColumnLayer extends ColumnLayer<PixelCell, { revealTime: number }> {
  static layerName = 'PixelColumnLayer'
  static defaultProps = {
    ...ColumnLayer.defaultProps,
    revealTime: PIXEL_REVEAL_CONFIG.duration,
    getCellSize: { type: 'accessor', value: (cell: PixelCell) => cell.size },
    getRevealStart: { type: 'accessor', value: (cell: PixelCell) => cell.start },
  }

  initializeState() {
    super.initializeState()
    this.getAttributeManager()!.addInstanced({
      instanceCellSize: { size: 1, accessor: 'getCellSize' },
      instanceRevealStart: { size: 1, accessor: 'getRevealStart' },
    })
  }

  getShaders() {
    const shaders = super.getShaders()
    return { ...shaders, modules: [...shaders.modules, pixelUniforms], inject: {
      'vs:#decl': 'in float instanceCellSize; in float instanceRevealStart; out float revealAmount;',
      'vs:#main-start': 'revealAmount = smoothstep(instanceRevealStart, instanceRevealStart + pixel.duration, pixel.time);',
      'vs:DECKGL_FILTER_SIZE': 'size.xy *= instanceCellSize * mix(pixel.startScale, 1.0, revealAmount);',
      'fs:#decl': 'in float revealAmount;',
      'fs:DECKGL_FILTER_COLOR': 'if (revealAmount <= 0.001) discard; color.a *= revealAmount;',
    } }
  }

  draw(options: Parameters<ColumnLayer['draw']>[0]) {
    this.state.models?.forEach(model => model.shaderInputs.setProps({ pixel: {
      time: this.props.revealTime, duration: PIXEL_REVEAL_CONFIG.cellDuration, startScale: PIXEL_REVEAL_CONFIG.startScale,
    } }))
    super.draw(options)
  }
}
