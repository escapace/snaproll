import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './app.vue'

import Canvas2DBouncingBalls from './canvas-2d-bouncing-balls.vue'
import CSSTransformRectangles from './css-transform-rectangles.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { component: Canvas2DBouncingBalls, path: '/bouncing-balls' },
    { component: CSSTransformRectangles, path: '/rectangles' },
    { path: '/', redirect: '/bouncing-balls' },
  ],
  strict: true,
})

createApp(App).use(router).mount('#app')
