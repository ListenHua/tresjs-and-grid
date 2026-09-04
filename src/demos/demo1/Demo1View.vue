<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { Layers3, LocateFixed, Minus, Plus } from '@lucide/vue'
import { Vector3 } from 'three'
import MapTileLayer from './components/MapTileLayer.vue'
import { MAP_CONFIG } from './map/mapConfig'
import type { TileSourceId } from './map/mapConfig'
import type { TileStats } from './map/TileManager'

const source = ref<TileSourceId>('arcgis')
const opacity = ref(1)
const stats = reactive<TileStats>({ loaded: 0, loading: 0, failed: 0, zoom: 15 })
const position = reactive({ lng: 116.3913, lat: 39.9075 })
const command = reactive({ id: 0, type: 'reset' as 'zoom-in' | 'zoom-out' | 'reset' })
const cameraPosition = new Vector3(0, 5200, 5200)
const loadLabel = computed(() => stats.loading > 0
  ? `正在载入 ${stats.loading} 张`
  : stats.failed > 0 ? `${stats.failed} 张失败` : `${stats.loaded} 张已就绪`)

function updateStats(value: TileStats) { Object.assign(stats, value) }
function updatePosition(value: { lng: number; lat: number }) { Object.assign(position, value) }
function navigate(type: typeof command.type) {
  command.type = type
  command.id += 1
}
</script>

<template>
  <main class="map-workspace">
    <TresCanvas clear-color="#151b19" :dpr="[1, 2]" :antialias="true">
      <TresPerspectiveCamera :position="cameraPosition" :fov="50" :near="1" :far="500000" />
      <MapTileLayer
        :source="source"
        :opacity="opacity"
        :command="command"
        @stats="updateStats"
        @position="updatePosition"
      />
    </TresCanvas>

    <header class="topbar">
      <div class="brand-mark" aria-hidden="true"><Layers3 :size="18" :stroke-width="1.8" /></div>
      <div class="brand-copy"><strong>地理场景</strong><span>THREE / WEB MERCATOR</span></div>
      <div class="connection"><i :class="{ busy: stats.loading > 0, error: stats.failed > 0 }"></i>{{ loadLabel }}</div>
    </header>

    <section class="layer-panel" aria-label="底图控制">
      <div class="panel-heading"><span>影像底图</span><span>Z{{ stats.zoom }}</span></div>
      <div class="source-switch" role="group" aria-label="底图来源">
        <button
          v-for="item in Object.values(MAP_CONFIG)"
          :key="item.id"
          type="button"
          :class="{ active: source === item.id }"
          @click="source = item.id"
        >{{ item.id === 'arcgis' ? 'ArcGIS' : '天地图' }}</button>
      </div>
      <label class="opacity-control">
        <span>图层透明度</span><output>{{ Math.round(opacity * 100) }}%</output>
        <input v-model.number="opacity" type="range" min="0.15" max="1" step="0.05" />
      </label>
      <dl class="map-readout">
        <div><dt>经度</dt><dd>{{ position.lng.toFixed(5) }}°</dd></div>
        <div><dt>纬度</dt><dd>{{ position.lat.toFixed(5) }}°</dd></div>
      </dl>
    </section>

    <nav class="map-tools" aria-label="地图导航">
      <button type="button" title="放大" aria-label="放大" @click="navigate('zoom-in')"><Plus :size="19" /></button>
      <button type="button" title="缩小" aria-label="缩小" @click="navigate('zoom-out')"><Minus :size="19" /></button>
      <button type="button" title="回到初始视角" aria-label="回到初始视角" @click="navigate('reset')"><LocateFixed :size="18" /></button>
    </nav>

    <div class="coordinates"><span>EPSG:3857</span><b>{{ position.lng.toFixed(4) }}, {{ position.lat.toFixed(4) }}</b></div>
    <footer class="attribution">{{ MAP_CONFIG[source].attribution }}</footer>
  </main>
</template>

<style>
:root { font-family: "IBM Plex Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif; color: #f4f5ef; background: #151b19; font-synthesis: none; }
* { box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; margin: 0; overflow: hidden; }
button, input { font: inherit; }
button:focus-visible, input:focus-visible { outline: 2px solid #d9ff63; outline-offset: 2px; }
.map-workspace { position: relative; width: 100%; height: 100%; isolation: isolate; background: #151b19; }
.map-workspace::after { position: absolute; inset: 0; z-index: 1; pointer-events: none; content: ""; background: linear-gradient(180deg, rgba(10,14,12,.34), transparent 18%, transparent 72%, rgba(10,14,12,.32)); }
.map-workspace canvas { display: block; width: 100% !important; height: 100% !important; }
.topbar, .layer-panel, .map-tools, .coordinates, .attribution { position: absolute; z-index: 2; }
.topbar { top: 18px; left: 18px; display: flex; align-items: center; height: 48px; padding: 0 13px 0 7px; border: 1px solid rgba(232,238,229,.18); border-radius: 6px; background: rgba(21,27,25,.88); box-shadow: 0 10px 30px rgba(0,0,0,.24); backdrop-filter: blur(14px); }
.brand-mark { display: grid; width: 34px; height: 34px; place-items: center; color: #151b19; background: #d9ff63; }
.brand-copy { display: grid; gap: 2px; margin-left: 10px; }
.brand-copy strong { font-family: "Noto Serif SC", "Songti SC", serif; font-size: 14px; font-weight: 600; }
.brand-copy span, .connection, .panel-heading, .map-readout dt, .coordinates, .attribution { font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace; letter-spacing: 0; }
.brand-copy span { color: #929e98; font-size: 8px; }
.connection { display: flex; align-items: center; gap: 7px; margin-left: 22px; color: #b8c0bb; font-size: 10px; }
.connection i { width: 6px; height: 6px; border-radius: 50%; background: #9bcf82; }
.connection i.busy { background: #d9ff63; animation: pulse 1.2s ease-in-out infinite; }
.connection i.error { background: #ff8d73; }
.layer-panel { top: 82px; left: 18px; width: 238px; padding: 15px; border: 1px solid rgba(232,238,229,.16); border-radius: 6px; background: rgba(21,27,25,.88); box-shadow: 0 12px 34px rgba(0,0,0,.25); backdrop-filter: blur(14px); }
.panel-heading { display: flex; justify-content: space-between; margin-bottom: 13px; color: #d8ddd9; font-size: 10px; text-transform: uppercase; }
.panel-heading span:last-child { color: #d9ff63; }
.source-switch { display: grid; grid-template-columns: 1fr 1fr; height: 34px; padding: 3px; border: 1px solid rgba(232,238,229,.12); background: rgba(3,7,5,.32); }
.source-switch button { border: 0; border-radius: 2px; color: #929e98; background: transparent; cursor: pointer; font-size: 11px; transition: color 160ms ease, background 160ms ease; }
.source-switch button.active { color: #151b19; background: #e9ede5; }
.opacity-control { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-top: 18px; color: #aeb7b1; font-size: 11px; }
.opacity-control output { color: #eef1eb; font-variant-numeric: tabular-nums; }
.opacity-control input { grid-column: 1 / -1; width: 100%; height: 3px; margin: 3px 0 5px; appearance: none; border-radius: 0; background: #46504b; accent-color: #d9ff63; }
.opacity-control input::-webkit-slider-thumb { width: 12px; height: 12px; appearance: none; border: 2px solid #151b19; border-radius: 50%; background: #d9ff63; box-shadow: 0 0 0 1px #d9ff63; cursor: pointer; }
.map-readout { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0 0; padding-top: 13px; border-top: 1px solid rgba(232,238,229,.1); }
.map-readout div { min-width: 0; }
.map-readout dt { color: #717c76; font-size: 8px; }
.map-readout dd { margin: 4px 0 0; color: #dce1dc; font-size: 11px; font-variant-numeric: tabular-nums; }
.map-tools { top: 18px; right: 18px; display: grid; overflow: hidden; border: 1px solid rgba(232,238,229,.18); border-radius: 6px; background: rgba(21,27,25,.9); box-shadow: 0 10px 30px rgba(0,0,0,.24); backdrop-filter: blur(14px); }
.map-tools button { display: grid; width: 40px; height: 40px; padding: 0; place-items: center; border: 0; border-bottom: 1px solid rgba(232,238,229,.12); color: #dbe0dc; background: transparent; cursor: pointer; transition: color 150ms ease, background 150ms ease; }
.map-tools button:last-child { border-bottom: 0; }
.map-tools button:hover { color: #151b19; background: #d9ff63; }
.coordinates { right: 18px; bottom: 30px; display: flex; gap: 12px; align-items: center; min-height: 30px; padding: 0 10px; border-left: 2px solid #d9ff63; color: #89948e; background: rgba(21,27,25,.84); backdrop-filter: blur(12px); font-size: 9px; }
.coordinates b { color: #dfe4df; font-weight: 500; font-variant-numeric: tabular-nums; }
.attribution { right: 18px; bottom: 8px; max-width: min(640px, calc(100vw - 36px)); color: rgba(236,240,235,.68); text-align: right; font-size: 8px; text-shadow: 0 1px 2px #000; }
@keyframes pulse { 50% { opacity: .35; } }
@media (max-width: 620px) {
  .topbar { top: 10px; left: 10px; }
  .connection { margin-left: 13px; }
  .layer-panel { top: 70px; left: 10px; width: 210px; }
  .map-tools { top: 10px; right: 10px; }
  .coordinates { right: 10px; bottom: 34px; }
  .attribution { right: 10px; bottom: 8px; max-width: calc(100vw - 20px); }
}
</style>
