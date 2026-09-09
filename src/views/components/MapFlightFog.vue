<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import fogTexture from '../../assets/images/flight-fog.png'
import leftFogMask from '../../assets/images/flight-fog-mask-left.png'
import rightFogMask from '../../assets/images/flight-fog-mask-right.png'

const container = ref<HTMLElement | null>(null)
const leftBank = ref<HTMLElement | null>(null)
const rightBank = ref<HTMLElement | null>(null)
const ready = ref(false)
let disposed = false

onMounted(async () => {
  try {
    await Promise.all([fogTexture, leftFogMask, rightFogMask].map(source => {
      const image = new Image()
      image.src = source
      return image.decode()
    }))
    if (!disposed) ready.value = true
  } catch {
    ready.value = false
  }
})
onBeforeUnmount(() => { disposed = true; ready.value = false })

function setCoverage(value: number) {
  const coverage = Math.max(0, Math.min(1, value))
  const offset = (1 - coverage) * 105
  container.value?.classList.toggle('is-active', coverage > 0)
  if (leftBank.value) leftBank.value.style.transform = `translate3d(${-offset}%,0,0)`
  if (rightBank.value) rightBank.value.style.transform = `translate3d(${offset}%,0,0)`
}

defineExpose({ setCoverage, isReady: () => ready.value })
</script>

<template>
  <div ref="container" class="map-flight-fog" aria-hidden="true">
    <div ref="leftBank" class="fog-bank fog-left">
      <div class="fog-body" :style="{ '--fog-mask': `url(${leftFogMask})` }">
        <img :src="fogTexture" alt="" draggable="false" @error="ready = false" />
      </div>
    </div>
    <div ref="rightBank" class="fog-bank fog-right">
      <div class="fog-body" :style="{ '--fog-mask': `url(${rightFogMask})` }">
        <img :src="fogTexture" alt="" draggable="false" @error="ready = false" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-flight-fog { position:absolute;inset:0;z-index:2;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict }
.map-flight-fog.is-active { visibility:visible }
.fog-bank { position:absolute;top:-20%;width:76%;height:140%;pointer-events:none }
.fog-body { position:absolute;inset:0;background:#dce0df;mask-image:var(--fog-mask);mask-size:100% 100%;mask-repeat:no-repeat;mask-mode:alpha }
.is-active .fog-bank { will-change:transform }
.is-active .fog-left .fog-body { animation:fog-drift-left 9s ease-in-out infinite alternate }
.is-active .fog-right .fog-body { animation:fog-drift-right 11s ease-in-out -4s infinite alternate }
.fog-bank img { display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;user-select:none }
.fog-left { left:0;transform:translate3d(-105%,0,0) }
.fog-right { right:0;transform:translate3d(105%,0,0) }
.fog-right img { transform:scaleX(-1);object-position:70% center }
@keyframes fog-drift-left { from { transform:translate3d(0,-1.5%,0) } to { transform:translate3d(0,1.5%,0) } }
@keyframes fog-drift-right { from { transform:translate3d(0,1%,0) } to { transform:translate3d(0,-1.5%,0) } }
@media (prefers-reduced-motion:reduce) { .is-active .fog-body { animation:none } }
</style>
