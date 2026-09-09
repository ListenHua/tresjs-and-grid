<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { ChevronDown, EyeOff, List, LocateFixed, Search, X } from '@lucide/vue'
import { AREA_TYPE_COLORS } from '../config'
import { filterProtectAreaSites } from '../data/protectAreas'
import type { ProtectAreaSite } from '../data/protectAreas'
import type { ProtectAreaFeature, ProtectAreaType } from '../types/map'

const props = defineProps<{
  sites: ProtectAreaSite[]
  selectedFeatureId: string | null
  regionsVisible: boolean
  visibleTypes: ProtectAreaType[]
}>()
const emit = defineEmits<{
  'locate-site': [id: string]
  'select-zone': [id: string]
}>()
const panelId = useId()
const query = ref('')
const compact = ref(typeof window !== 'undefined' && window.matchMedia('(max-width:900px)').matches)
const expanded = ref(!compact.value)
const expandedSiteId = ref<string | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
const filteredSites = computed(() => filterProtectAreaSites(props.sites, query.value))
const selectedSite = computed(() => props.sites.find(site => site.zones.some(zone => zone.id === props.selectedFeatureId)))
let mediaQuery: MediaQueryList | null = null

function updateCompact(event: MediaQueryListEvent) {
  compact.value = event.matches
  if (event.matches) expanded.value = false
}

function clearSearch() {
  query.value = ''
  searchInput.value?.focus()
}

function locateSite(site: ProtectAreaSite) {
  expandedSiteId.value = site.id
  if (compact.value) expanded.value = false
  emit('locate-site', site.id)
}

function selectZone(zone: ProtectAreaFeature) {
  if (compact.value) expanded.value = false
  emit('select-zone', zone.id)
}

function isHidden(zone: ProtectAreaFeature) {
  return !props.regionsVisible || !props.visibleTypes.includes(zone.properties.BHDLX)
}

async function revealSelectedRow() {
  await nextTick()
  if (!expanded.value || !scrollContainer.value) return
  const row = Array.from(scrollContainer.value.querySelectorAll<HTMLButtonElement>('[data-feature-id]'))
    .find(element => element.dataset.featureId === props.selectedFeatureId)
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
}

watch(() => props.selectedFeatureId, () => {
  if (!selectedSite.value) return
  expandedSiteId.value = selectedSite.value.id
  void revealSelectedRow()
}, { flush: 'post', immediate: true })
watch(expanded, value => { if (value) void revealSelectedRow() }, { flush: 'post' })

onMounted(() => {
  mediaQuery = window.matchMedia('(max-width:900px)')
  mediaQuery.addEventListener('change', updateCompact)
})
onBeforeUnmount(() => mediaQuery?.removeEventListener('change', updateCompact))
</script>

<template>
  <aside class="area-list" :class="{ collapsed: !expanded }" aria-label="保护区列表">
    <button class="list-heading" type="button" :aria-expanded="expanded" :aria-controls="panelId" @click="expanded = !expanded">
      <List :size="17" /><span>保护区列表</span><small>{{ sites.length }}</small>
      <ChevronDown :size="15" :class="{ collapsed: !expanded }" />
    </button>
    <div v-if="expanded" :id="panelId" class="list-content">
      <div class="list-search">
        <Search :size="15" />
        <input ref="searchInput" v-model="query" type="search" aria-label="搜索保护点名称、物种或地区" placeholder="搜索名称、物种或地区" />
        <button v-if="query" type="button" aria-label="清空搜索" @click="clearSearch"><X :size="14" /></button>
      </div>
      <p v-if="query" class="search-count" role="status">找到 {{ filteredSites.length }} 个保护点</p>
      <div ref="scrollContainer" class="list-scroll">
        <ul v-if="filteredSites.length" class="site-list">
          <li v-for="site in filteredSites" :key="site.id" class="site-item" :class="{ selected: selectedSite?.id === site.id }">
            <div class="site-heading">
              <button class="site-locate" type="button" :title="`定位：${site.name}`" @click="locateSite(site)">
                <span class="site-name">{{ site.name }}</span>
                <span class="site-location">{{ site.city }} · {{ site.district }}</span>
              </button>
              <button class="site-expand" type="button" :aria-label="`${expandedSiteId === site.id ? '收起' : '展开'}${site.name}的分区`"
                :aria-expanded="expandedSiteId === site.id" :aria-controls="`${panelId}-${site.id}`"
                @click="expandedSiteId = expandedSiteId === site.id ? null : site.id">
                <ChevronDown :size="15" :class="{ collapsed: expandedSiteId !== site.id }" />
              </button>
            </div>
            <ul v-if="expandedSiteId === site.id" :id="`${panelId}-${site.id}`" class="zone-list">
              <li v-for="zone in site.zones" :key="zone.id">
                <button type="button" :data-feature-id="zone.id" :aria-pressed="selectedFeatureId === zone.id"
                  :class="{ hidden: isHidden(zone) }" @click="selectZone(zone)">
                  <i :style="{ background: AREA_TYPE_COLORS[zone.properties.BHDLX] }"></i>
                  <span>{{ zone.properties.BHDLX }}</span><small>{{ zone.properties.MJ }} 亩</small>
                  <span v-if="isHidden(zone)" class="hidden-label"><EyeOff :size="11" />已隐藏</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <div v-else class="empty-list">
          <Search :size="22" /><p>{{ query ? '未找到匹配的保护点' : '暂无保护点数据' }}</p>
          <button v-if="query" type="button" @click="clearSearch">清空搜索</button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.area-list { display:flex;flex:0 1 500px;flex-direction:column;min-height:44px;overflow:hidden;border:1px solid rgba(242,240,233,.18);background:rgba(16,27,24,.94);box-shadow:0 10px 30px rgba(0,0,0,.22);backdrop-filter:blur(14px) }
.area-list.collapsed { flex:0 0 44px }
button { color:inherit;cursor:pointer }
.list-heading { display:flex;flex-shrink:0;align-items:center;gap:9px;width:100%;height:43px;padding:0 13px;border:0;text-align:left;background:transparent }
.list-heading > svg:first-child { color:var(--mint) }.list-heading > span { flex:1;font-size:12px;font-weight:600;letter-spacing:1px }.list-heading small { color:#9fab9f;font:11px/1 monospace }
.list-heading > svg:last-child,.site-expand svg { color:#94a49c;transition:transform 150ms ease }.list-heading > svg.collapsed,.site-expand svg.collapsed { transform:rotate(-90deg) }
.list-content { display:flex;flex:1;flex-direction:column;min-height:0;border-top:1px solid rgba(242,240,233,.1) }
.list-search { display:flex;flex-shrink:0;align-items:center;gap:8px;margin:12px;padding:0 9px;min-height:36px;border:1px solid rgba(242,240,233,.15);background:rgba(255,255,255,.035);color:#8b9b95 }
.list-search:focus-within { border-color:var(--mint) }.list-search input { min-width:0;width:100%;height:34px;padding:0;border:0;outline:none;color:var(--paper);background:transparent;font-size:11px }.list-search input::placeholder { color:#8b9b95 }.list-search input::-webkit-search-cancel-button { display:none }
.list-search button { display:grid;place-items:center;flex-shrink:0;width:24px;height:30px;padding:0;border:0;background:transparent }
.search-count { margin:0;padding:0 13px 10px;color:#9fab9f;font-size:10px }
.list-scroll { min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#506458 transparent }
.site-list,.zone-list { margin:0;padding:0;list-style:none }.site-item + .site-item { border-top:1px solid rgba(242,240,233,.08) }.site-item.selected { background:rgba(185,242,124,.045) }
.site-heading { display:flex;align-items:stretch }.site-locate { flex:1;min-width:0;padding:12px 0 12px 13px;border:0;text-align:left;background:transparent }.site-name { display:block;font-size:12px;line-height:1.65;overflow-wrap:anywhere }.site-item.selected .site-name { color:var(--mint) }
.site-location { display:block;margin-top:5px;color:#94a49c;font-size:10px;line-height:1.5 }.site-meta { display:flex;align-items:center;gap:8px;margin-top:9px;color:#b9c8bf;font-size:10px }.site-meta > span { min-width:0;overflow-wrap:anywhere }.site-meta small { margin-left:auto;flex-shrink:0;color:#87978c;font-size:9px }.site-meta svg { color:#87978c;flex-shrink:0 }
.site-expand { display:grid;place-items:center;flex:0 0 32px;padding:0;border:0;background:transparent }
.zone-list { display:grid;gap:4px;padding:0 10px 10px }.zone-list button { display:flex;align-items:center;gap:7px;width:100%;min-height:35px;padding:7px 8px;border:1px solid rgba(242,240,233,.08);border-radius:2px;background:rgba(255,255,255,.025);text-align:left;font-size:11px }.zone-list i { width:7px;height:7px;flex-shrink:0 }.zone-list small { margin-left:auto;color:#9fab9f;font:10px/1.3 monospace }
.zone-list button[aria-pressed="true"] { border-color:rgba(185,242,124,.45);color:var(--mint);background:rgba(185,242,124,.08) }.zone-list button.hidden { color:#95a398 }.hidden-label { display:flex;align-items:center;gap:3px;color:#87978c;font-size:9px }
.empty-list { display:grid;justify-items:center;padding:28px 12px;color:#94a49c }.empty-list p { margin:12px 0;font-size:12px }.empty-list button { min-height:32px;padding:0 12px;border:1px solid rgba(185,242,124,.35);color:var(--mint);background:transparent;font-size:11px }
button:focus-visible { outline:2px solid var(--mint);outline-offset:-3px }
@media (hover:hover) { .list-heading:hover,.site-heading:hover,.zone-list button:hover { background:rgba(185,242,124,.06) } }
@media (prefers-reduced-motion:reduce) { .list-heading > svg:last-child,.site-expand svg { transition:none } }
</style>
