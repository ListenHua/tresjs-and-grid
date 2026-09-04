<script setup lang="ts">
import { Box, Map } from '@lucide/vue'
</script>

<template>
  <nav class="demo-switcher" aria-label="示例导航">
    <RouterLink to="/demo1" title="查看影像地图 Demo">
      <Map :size="15" aria-hidden="true" />
      <span>Demo 1</span>
    </RouterLink>
    <RouterLink to="/demo2" title="查看网格实验 Demo">
      <Box :size="15" aria-hidden="true" />
      <span>Demo 2</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.demo-switcher {
  position: fixed;
  z-index: 20;
  right: 18px;
  bottom: 58px;
  display: flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid rgba(232, 238, 229, 0.18);
  border-radius: 6px;
  background: rgba(21, 27, 25, 0.9);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(14px);
}

.demo-switcher a {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 3px;
  color: #9da8a1;
  font: 500 10px/1 "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
  text-decoration: none;
  transition: color 150ms ease, background 150ms ease;
}

.demo-switcher a:hover { color: #f2f4ef; background: rgba(255, 255, 255, 0.08); }
.demo-switcher a.router-link-active { color: #151b19; background: #d9ff63; }
.demo-switcher a:focus-visible { outline: 2px solid #d9ff63; outline-offset: 2px; }

@media (max-width: 620px) {
  .demo-switcher { right: 10px; bottom: 58px; }
}
</style>
