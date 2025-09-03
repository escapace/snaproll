<template>
  <div class="container">
    <canvas ref="canvasRef" class="canvas" />
  </div>
</template>

<script setup lang="ts">
import { useWindowSize } from '@vueuse/core'
import { range } from 'es-toolkit'
import { inject, onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import { SnaprollActionType, type Snaproll, type SnaprollSubscription } from '../src'
import { decomposeVelocityMagnitude, lerp } from './utilities'

const snaproll = inject<Snaproll>('snaproll')!
const canvasRef = shallowRef<HTMLCanvasElement>()

interface BallState {
  index: number
  id: string
  x: number // 0-100 viewport units
  y: number // 0-100 viewport units
  lastX: number // 0-100 viewport units
  lastY: number // 0-100 viewport units
  xSpeed: number // viewport units per millisecond
  ySpeed: number // viewport units per millisecond
  radius: number // viewport units
  color: string
}

const { width: windowWidth, height: windowHeight } = useWindowSize()

const drawRate = inject<Ref<number>>('drawRate')!
const perceptualAngle = inject<Ref<number>>('perceptualAngle')!

const balls = range(16).map((_, index) => {
  const x = Math.random() * 100
  const y = Math.random() * 100
  const ball: Omit<BallState, 'ySpeed' | 'xSpeed'> = {
    index,
    id: `ball${index}`,
    x,
    y,
    lastX: x,
    lastY: y,
    radius: 1 + Math.random() * 3, // radius between 1-4 viewport units
    color: `hsl(${Math.random() * 360}, 70%, 70%)`,
  }

  const weight = Math.random()

  watch(
    [windowWidth, windowHeight, drawRate, perceptualAngle],
    ([windowWidth, windowHeight, drawRate, perceptualAngle]) => {
      Object.assign(
        ball,
        decomposeVelocityMagnitude(
          { drawRate, windowHeight, windowWidth, perceptualAngle: perceptualAngle * weight },
          ball as BallState,
        ),
      )
    },
    { immediate: true, flush: 'sync' },
  )

  return ball as BallState
})

let ctx: CanvasRenderingContext2D | null = null
const setupCanvas = (): void => {
  const canvas = canvasRef.value
  if (!canvas) return

  ctx = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: false
  })
  if (!ctx) return

  const devicePixelRatio = window.devicePixelRatio || 1
  const displayWidth = window.innerWidth
  const displayHeight = window.innerHeight

  canvas.width = displayWidth * devicePixelRatio
  canvas.height = displayHeight * devicePixelRatio

  canvas.style.width = `${displayWidth}px`
  canvas.style.height = `${displayHeight}px`

  ctx.scale(devicePixelRatio, devicePixelRatio)
}

const updateBall = (ball: BallState, deltaTime: number): void => {
  ball.lastX = ball.x
  ball.lastY = ball.y

  ball.x += ball.xSpeed * deltaTime
  ball.y += ball.ySpeed * deltaTime

  if (ball.x > 100 - ball.radius || ball.x < ball.radius) {
    ball.xSpeed = -ball.xSpeed
    ball.x = Math.max(ball.radius, Math.min(100 - ball.radius, ball.x))
  }

  if (ball.y > 100 - ball.radius || ball.y < ball.radius) {
    ball.ySpeed = -ball.ySpeed
    ball.y = Math.max(ball.radius, Math.min(100 - ball.radius, ball.y))
  }
}

const drawBalls = (alpha: number): void => {
  if (!ctx) return

  const canvas = canvasRef.value
  if (!canvas) return

  const canvasWidth = canvas.clientWidth
  const canvasHeight = canvas.clientHeight

  // Clear background
  // ctx.fillStyle = 'black'
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // Draw all balls
  for (const ball of balls) {
    const interpolatedX = lerp(ball.lastX, ball.x, alpha)
    const interpolatedY = lerp(ball.lastY, ball.y, alpha)

    const pixelX = (interpolatedX / 100) * canvasWidth
    const pixelY = (interpolatedY / 100) * canvasHeight
    const pixelRadius = (ball.radius / 100) * Math.min(canvasWidth, canvasHeight)

    ctx.fillStyle = ball.color
    ctx.beginPath()
    ctx.arc(pixelX, pixelY, pixelRadius, 0, Math.PI * 2)
    ctx.fill()
  }
}

for (const ball of balls) {
  const subscription: SnaprollSubscription = (context) => {
    switch (context.action) {
      case SnaprollActionType.Begin:
        break
      case SnaprollActionType.Update:
        const coalesce = context.updateStep >= 100
        const timestep = coalesce ? context.updateStep * context.timestep : context.timestep

        updateBall(ball, timestep)

        return coalesce
      case SnaprollActionType.Draw:
        drawBalls(context.alpha)
        break
    }

    return
  }

  const { unsubscribe } = snaproll.subscribe(subscription)
  onBeforeUnmount(() => unsubscribe())
}

const handleResize = (): void => {
  setupCanvas()
}

onMounted(() => {
  setupCanvas()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.canvas {
  display: block;
  position: absolute;
  top: 0;
  left: 0;
}
</style>
