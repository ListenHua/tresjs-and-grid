import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/demo1',
    },
    {
      path: '/demo1',
      name: 'demo1',
      component: () => import('../demos/demo1/Demo1View.vue'),
      meta: { title: 'Demo 1 - 影像地图' },
    },
    {
      path: '/demo2',
      name: 'demo2',
      component: () => import('../demos/demo2/Demo2View.vue'),
      meta: { title: 'Demo 2 - 广西原生境保护区' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/demo1',
    },
  ],
})

router.afterEach((to) => {
  document.title = String(to.meta.title ?? 'TresJS Demos')
})

export default router
