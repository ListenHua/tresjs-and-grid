<script setup lang="ts">
import DemoSwitcher from './components/DemoSwitcher.vue'
</script>

<template>
  <RouterView />
  <DemoSwitcher />
</template>

<style>
:root {
  font-family: "IBM Plex Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  color: #f4f5ef;
  background: #151b19;
  font-synthesis: none;
}

* { box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; margin: 0; overflow: hidden; }
button, input { font: inherit; }
</style>
