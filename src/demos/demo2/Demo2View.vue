<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Box, ChevronDown, Eye, EyeOff, Layers3, LocateFixed, Minus, Plus } from '@lucide/vue'
import MapScene from './components/MapScene.vue'
import type { MapViewState, RegionDatum, SceneCommand } from './types/map'

const status = ref<'loading' | 'ready' | 'error'>('loading')
const statusMessage = ref('正在构建空间场景')
const selected = ref<RegionDatum | null>(null)
const hovered = ref<RegionDatum | null>(null)
const regionsVisible = ref(true)
const heightScale = ref(1)
const command = reactive({ id: 0, type: 'reset' as SceneCommand })
const view = reactive<MapViewState>({ zoom: 12.25, pitch: 57, bearing: -18 })
const activeRegion = computed(() => hovered.value ?? selected.value)
const dimensionLabel = computed(() => view.pitch > 10 ? '3D' : '2D')

function runCommand(type: SceneCommand) { command.type = type; command.id += 1 }
function setReady() { status.value = 'ready'; statusMessage.value = '9 个规划单元已载入' }
function setError(message: string) { status.value = 'error'; statusMessage.value = message }
</script>

<template>
  <main class="planning-workspace">
    <MapScene :command="command" :regions-visible="regionsVisible" :height-scale="heightScale"
      @ready="setReady" @error="setError" @hover="hovered = $event" @select="selected = $event" @view="Object.assign(view, $event)" />
    <div class="map-shade" aria-hidden="true"></div>

    <header class="workspace-header">
      <div class="project-code"><Box :size="18" /><span>URBAN / 042</span></div>
      <div class="project-title"><p>城市更新推演</p><h1>中央活力区规划沙盘</h1></div>
      <div class="scene-state"><i :class="status"></i><span>{{ statusMessage }}</span></div>
    </header>

    <aside class="control-panel" aria-label="场景图层控制">
      <div class="panel-title"><span>场景构成</span><Layers3 :size="16" /></div>
      <button class="layer-row" type="button" @click="regionsVisible = !regionsVisible">
        <span class="layer-swatch"></span><span><b>规划区域</b><small>拉伸体块 / 9</small></span>
        <Eye v-if="regionsVisible" :size="16" /><EyeOff v-else :size="16" />
      </button>
      <div class="base-row"><span class="base-swatch"></span><span><b>卫星影像</b><small>Esri World Imagery</small></span><ChevronDown :size="15" /></div>
      <label class="height-control"><span>高度倍率</span><output>{{ heightScale.toFixed(1) }}x</output>
        <input v-model.number="heightScale" type="range" min="0.35" max="1.8" step="0.05" />
      </label>
    </aside>

    <section class="region-card" :class="{ empty: !activeRegion }" aria-live="polite">
      <template v-if="activeRegion">
        <div class="region-heading"><span>{{ activeRegion.id }}</span><em>{{ activeRegion.category }}</em></div>
        <h2>{{ activeRegion.name }}</h2>
        <dl><div><dt>开发强度</dt><dd>{{ activeRegion.value }}<small>%</small></dd></div><div><dt>基准高度</dt><dd>{{ activeRegion.height }}<small>m</small></dd></div></dl>
        <p>{{ selected?.id === activeRegion.id ? '已锁定规划单元' : '点击区域锁定详情' }}</p>
      </template>
      <template v-else><span class="empty-index">00 / 09</span><h2>选择规划单元</h2><p>移动指针以读取区域指标</p></template>
    </section>

    <nav class="map-tools" aria-label="地图导航工具">
      <button type="button" title="放大" aria-label="放大" @click="runCommand('zoom-in')"><Plus :size="19" /></button>
      <button type="button" title="缩小" aria-label="缩小" @click="runCommand('zoom-out')"><Minus :size="19" /></button>
      <button type="button" title="复位视角" aria-label="复位视角" @click="runCommand('reset')"><LocateFixed :size="18" /></button>
    </nav>
    <button class="dimension-toggle" type="button" title="切换二维或三维视角" @click="runCommand('toggle-dimension')">
      <span :class="{ active: dimensionLabel === '2D' }">2D</span><span :class="{ active: dimensionLabel === '3D' }">3D</span>
    </button>
    <footer class="map-footer"><span>EPSG:3857</span><b>Z{{ view.zoom.toFixed(1) }}</b><span>PITCH {{ Math.round(view.pitch) }}°</span><span>BEARING {{ Math.round(view.bearing) }}°</span></footer>
  </main>
</template>

<style scoped>
.planning-workspace { --ink:#14201d;--paper:#f2f0e9;--coral:#e35d3f;--mint:#b9f27c;position:relative;width:100%;height:100%;overflow:hidden;color:var(--paper);background:var(--ink) }
.map-shade { position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(10,18,16,.72) 0,rgba(10,18,16,.1) 30%,transparent 68%),linear-gradient(0deg,rgba(9,16,14,.6),transparent 20%) }
.workspace-header,.control-panel,.region-card,.map-tools,.dimension-toggle,.map-footer { position:absolute;z-index:2 }
.workspace-header { top:20px;left:20px;display:flex;align-items:stretch;height:58px;border:1px solid rgba(242,240,233,.18);background:rgba(16,27,24,.9);box-shadow:0 14px 34px rgba(0,0,0,.25);backdrop-filter:blur(14px) }
.project-code { display:grid;width:72px;place-items:center;border-right:1px solid rgba(242,240,233,.14);color:var(--mint) }.project-code span { font:700 7px/1 monospace }
.project-title { display:flex;flex-direction:column;justify-content:center;min-width:236px;padding:0 16px }.project-title p,.project-title h1 { margin:0 }.project-title p { color:#8b9b95;font-size:8px }.project-title h1 { margin-top:4px;font-family:"Noto Serif SC","Songti SC",serif;font-size:17px;font-weight:600;letter-spacing:0 }
.scene-state { display:flex;align-items:center;gap:8px;padding:0 14px;border-left:1px solid rgba(242,240,233,.14);color:#a9b3af;font-size:9px }.scene-state i { width:6px;height:6px;border-radius:50%;background:#f1b35d;animation:pulse 1.2s infinite }.scene-state i.ready { background:var(--mint);animation:none }.scene-state i.error { background:#ff6f5b;animation:none }
.control-panel { top:94px;left:20px;width:256px;border:1px solid rgba(242,240,233,.17);background:rgba(16,27,24,.9);box-shadow:0 14px 34px rgba(0,0,0,.24);backdrop-filter:blur(14px) }
.panel-title { display:flex;align-items:center;justify-content:space-between;height:42px;padding:0 14px;border-bottom:1px solid rgba(242,240,233,.11);color:#d8dedb;font:600 10px/1 monospace }
.layer-row,.base-row { display:grid;grid-template-columns:28px 1fr 18px;gap:9px;align-items:center;width:100%;min-height:57px;padding:9px 13px;border:0;border-bottom:1px solid rgba(242,240,233,.09);color:inherit;text-align:left;background:transparent }.layer-row { cursor:pointer }.layer-row:hover { background:rgba(185,242,124,.06) }
.layer-row span:nth-child(2),.base-row span:nth-child(2) { display:grid;gap:4px }.layer-row b,.base-row b { font-size:11px;font-weight:550 }.layer-row small,.base-row small { color:#74837d;font:8px/1 monospace }
.layer-swatch,.base-swatch { width:25px;height:25px;border:1px solid rgba(255,255,255,.25);background:var(--coral);box-shadow:inset 0 -7px 0 rgba(0,0,0,.18) }.base-swatch { background:#45665b }
.height-control { display:grid;grid-template-columns:1fr auto;gap:9px;padding:14px;color:#aeb9b4;font-size:10px }.height-control output { color:var(--mint);font:600 10px/1 monospace }.height-control input { grid-column:1/-1;width:100%;height:3px;margin:8px 0 2px;appearance:none;background:#46544f;accent-color:var(--mint) }
.region-card { left:20px;bottom:56px;width:256px;min-height:170px;padding:16px;color:var(--ink);background:rgba(242,240,233,.95);box-shadow:8px 8px 0 rgba(227,93,63,.75);backdrop-filter:blur(12px);transition:transform 180ms ease }.region-heading { display:flex;justify-content:space-between;align-items:center;color:var(--coral);font:700 9px/1 monospace }.region-heading em { padding:4px 6px;color:#38584d;background:#d9e3dc;font-style:normal }
.region-card h2 { margin:12px 0 15px;font-family:"Noto Serif SC","Songti SC",serif;font-size:21px;letter-spacing:0 }.region-card dl { display:grid;grid-template-columns:1fr 1fr;margin:0;border-top:1px solid #c6ccc8 }.region-card dl div { padding-top:11px }.region-card dt { color:#75807b;font-size:8px }.region-card dd { margin:4px 0 0;font:600 18px/1 monospace }.region-card dd small { margin-left:3px;font-size:8px }.region-card p { margin:14px 0 0;color:#77817d;font-size:9px }.region-card.empty { min-height:116px;box-shadow:6px 6px 0 rgba(185,242,124,.55) }.region-card.empty h2 { margin:14px 0 5px;font-size:17px }.empty-index { color:var(--coral);font:700 9px/1 monospace }
.map-tools { top:20px;right:20px;display:grid;overflow:hidden;border:1px solid rgba(242,240,233,.2);background:rgba(16,27,24,.9);backdrop-filter:blur(14px) }.map-tools button { display:grid;width:40px;height:40px;padding:0;place-items:center;border:0;border-bottom:1px solid rgba(242,240,233,.13);color:#eef2ef;background:transparent;cursor:pointer }.map-tools button:last-child { border:0 }.map-tools button:hover { color:var(--ink);background:var(--mint) }
.dimension-toggle { right:20px;bottom:108px;display:grid;grid-template-columns:1fr 1fr;width:92px;height:36px;padding:3px;border:1px solid rgba(242,240,233,.2);color:#84918c;background:rgba(16,27,24,.92);cursor:pointer }.dimension-toggle span { display:grid;place-items:center;font:700 9px/1 monospace }.dimension-toggle span.active { color:var(--ink);background:var(--mint) }
.map-footer { right:20px;bottom:24px;display:flex;gap:17px;align-items:center;height:29px;padding:0 10px;border-left:2px solid var(--coral);color:#94a09b;background:rgba(16,27,24,.88);font:9px/1 monospace }.map-footer b { color:var(--mint);font-weight:600 }button:focus-visible,input:focus-visible { outline:2px solid var(--mint);outline-offset:2px }@keyframes pulse { 50% { opacity:.3 } }
@media (max-width:700px) { .workspace-header { top:10px;left:10px;right:60px }.project-code { width:48px }.project-code span,.scene-state { display:none }.project-title { min-width:0;padding:0 11px }.project-title h1 { font-size:14px }.control-panel { top:80px;left:10px;width:210px }.region-card { right:10px;bottom:100px;left:10px;width:auto;min-height:108px }.region-card dl { position:absolute;right:15px;bottom:37px;width:45% }.region-card h2 { font-size:17px }.map-tools { top:10px;right:10px }.dimension-toggle { right:10px;bottom:58px }.map-footer { right:10px;bottom:18px }.map-footer span:nth-last-child(-n+2) { display:none } }
</style>
