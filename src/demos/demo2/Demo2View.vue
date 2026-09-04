<script setup lang="ts">
import { ref } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { Pause, Play, RotateCcw } from '@lucide/vue'
import { Vector3 } from 'three'
import RotatingStructure from './components/RotatingStructure.vue'

const speed = ref(0.45)
const paused = ref(false)
const sceneKey = ref(0)
const cameraPosition = new Vector3(0, 4.6, 9)
const keyLightPosition = new Vector3(4, 7, 4)
const fillLightPosition = new Vector3(-5, 2, -3)
const gridPosition = new Vector3(0, -1.25, 0)

function resetScene() {
  speed.value = 0.45
  paused.value = false
  sceneKey.value += 1
}
</script>

<template>
  <main class="grid-lab">
    <TresCanvas clear-color="#e8e5dc" :dpr="[1, 2]" :antialias="true" shadows>
      <TresPerspectiveCamera :position="cameraPosition" :fov="42" :near="0.1" :far="100" />
      <TresAmbientLight :intensity="1.7" />
      <TresDirectionalLight :position="keyLightPosition" :intensity="3.2" cast-shadow />
      <TresDirectionalLight :position="fillLightPosition" :intensity="1.4" color="#76a8ff" />
      <RotatingStructure :key="sceneKey" :speed="speed" :paused="paused" />
      <TresGridHelper :args="[22, 22, '#9d9a91', '#c9c5ba']" :position="gridPosition" />
    </TresCanvas>

    <header class="lab-header">
      <span>DEMO 02</span>
      <h1>网格构成实验</h1>
    </header>

    <section class="lab-controls" aria-label="动画控制">
      <div class="control-heading">
        <span>旋转速率</span>
        <output>{{ speed.toFixed(2) }}</output>
      </div>
      <input v-model.number="speed" type="range" min="0.05" max="1.4" step="0.05" aria-label="旋转速率" />
      <div class="control-actions">
        <button type="button" :title="paused ? '继续动画' : '暂停动画'" @click="paused = !paused">
          <Play v-if="paused" :size="17" />
          <Pause v-else :size="17" />
          <span>{{ paused ? '继续' : '暂停' }}</span>
        </button>
        <button type="button" title="重置场景" @click="resetScene">
          <RotateCcw :size="16" />
          <span>重置</span>
        </button>
      </div>
    </section>

    <p class="lab-index">TRESJS / ISOLATED SCENE / 2026</p>
  </main>
</template>

<style scoped>
.grid-lab { position: relative; width: 100%; height: 100%; overflow: hidden; color: #191d1b; background: #e8e5dc; }
.grid-lab::after { position: absolute; inset: 0; z-index: 1; pointer-events: none; content: ""; background: linear-gradient(90deg, rgba(244,91,56,.08), transparent 28%, transparent 76%, rgba(39,85,120,.08)); }
.grid-lab canvas { display: block; width: 100% !important; height: 100% !important; }
.lab-header, .lab-controls, .lab-index { position: absolute; z-index: 2; }
.lab-header { top: 28px; left: 30px; }
.lab-header span, .control-heading, .lab-index { font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; letter-spacing: 0; }
.lab-header span { display: block; margin-bottom: 8px; color: #e14e2e; font-size: 10px; font-weight: 700; }
.lab-header h1 { margin: 0; font-family: "Noto Serif SC", "Songti SC", serif; font-size: clamp(24px, 4vw, 48px); font-weight: 600; letter-spacing: 0; }
.lab-controls { top: 28px; right: 28px; width: 224px; padding: 14px; border: 1px solid rgba(25,29,27,.22); border-radius: 6px; background: rgba(242,240,233,.86); box-shadow: 8px 8px 0 rgba(25,29,27,.1); backdrop-filter: blur(12px); }
.control-heading { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 10px; font-weight: 600; }
.control-heading output { color: #e14e2e; font-variant-numeric: tabular-nums; }
.lab-controls input { width: 100%; height: 3px; margin: 0 0 18px; appearance: none; border-radius: 0; background: #aaa79f; accent-color: #e14e2e; }
.lab-controls input::-webkit-slider-thumb { width: 13px; height: 13px; appearance: none; border: 2px solid #f2f0e9; border-radius: 50%; background: #e14e2e; box-shadow: 0 0 0 1px #e14e2e; cursor: pointer; }
.control-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.control-actions button { display: flex; align-items: center; justify-content: center; gap: 6px; height: 34px; border: 1px solid #292d2b; border-radius: 3px; color: #f5f3ec; background: #292d2b; cursor: pointer; font-size: 11px; transition: transform 140ms ease, box-shadow 140ms ease; }
.control-actions button:last-child { color: #292d2b; background: transparent; }
.control-actions button:hover { transform: translateY(-2px); box-shadow: 0 3px 0 rgba(25,29,27,.18); }
.control-actions button:focus-visible, .lab-controls input:focus-visible { outline: 2px solid #e14e2e; outline-offset: 2px; }
.lab-index { left: 30px; bottom: 27px; margin: 0; color: #555b57; font-size: 9px; }
@media (max-width: 620px) {
  .lab-header { top: 18px; left: 18px; }
  .lab-controls { top: auto; right: 14px; bottom: 108px; left: 14px; width: auto; }
  .lab-index { left: 18px; bottom: 24px; }
}
</style>
