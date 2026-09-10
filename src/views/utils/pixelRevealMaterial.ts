import * as THREE from 'three'
import { PIXEL_REVEAL_CONFIG } from '../config'

export function createPixelRevealMaterial(color: string, time: { value: number }) {
  const material = new THREE.MeshLambertMaterial({ color, transparent: time.value < PIXEL_REVEAL_CONFIG.duration })
  material.onBeforeCompile = shader => {
    shader.uniforms.pixelRevealTime = time
    shader.uniforms.pixelCellDuration = { value: PIXEL_REVEAL_CONFIG.cellDuration }
    shader.uniforms.pixelStartScale = { value: PIXEL_REVEAL_CONFIG.startScale }
    shader.vertexShader = `
      attribute float pixelRevealStart;
      uniform float pixelRevealTime;
      uniform float pixelCellDuration;
      uniform float pixelStartScale;
      varying float pixelRevealAmount;
    ${shader.vertexShader}`.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      pixelRevealAmount = smoothstep(pixelRevealStart, pixelRevealStart + pixelCellDuration, pixelRevealTime);
      transformed.xy *= mix(pixelStartScale, 1.0, pixelRevealAmount);
    `)
    shader.fragmentShader = `varying float pixelRevealAmount;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `
      #include <color_fragment>
      if (pixelRevealAmount <= 0.001) discard;
      diffuseColor.a *= pixelRevealAmount;
    `)
  }
  material.customProgramCacheKey = () => 'pixel-cell-reveal-v1'
  return material
}
