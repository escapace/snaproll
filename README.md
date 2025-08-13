# snaproll

Fixed‑timestep update loop with independent draw rate and quantized interpolation.

## Installation

```bash
pnpm add snaproll
```

## Getting Started

```js
import { Snaproll, SnaprollActionType } from 'snaproll'

// Create with custom rates and context
const snaproll = new Snaproll({
  updateRate: 60, // Fixed timestep updates at 60 Hz
  drawRate: 60, // Draw calls at 60 Hz
  context: { score: 0 },
})

// Subscribe to the animation loop
const subscription = snaproll.subscribe((context) => {
  switch (context.action) {
    case SnaprollActionType.Begin:
      // Frame initialization - check if ready to proceed
      const skipFrame = !document.hasFocus()

      // Return true to skip this entire frame
      return skipFrame
    case SnaprollActionType.Update:
      // Fixed timestep animation logic
      const coalesce = context.updateStep >= 100
      const totalTime = coalesce ? context.updateStep * context.timestep : context.timestep

      // Update animation state
      context.score += coalesce ? context.updateStep : 1

      // Return true to skip remaining updates this frame
      return coalesce
    case SnaprollActionType.Draw:
      // Interpolated drawing with quantized alpha
      draw(context.alpha)
      break
  }
})

// Start the animation loop
snaproll.resume()

// Dynamic rate adjustment
snaproll.updateRate = 30 // Reduce to 30 Hz updates

// Manual control
subscription.pause() // Pause this subscription
subscription.resume() // Resume after delay

// Reset with new configuration
snaproll.reset({
  updateRate: 120,
  drawRate: 60,
  context: { score: 0 },
  keepSubscriptions: true,
})
```

### Two independent rates

- **updateRate** — how often animation logic runs (defaults to 60 Hz).
- **drawRate** — how often frames draw to screen (defaults to 60 Hz).

### Quantized interpolation

During the Draw phase, snaproll provides an `alpha` value [0, 1) representing fractional progress toward the next update. The alpha value is quantized to a power-of-two grid based on the draw rate. The quantization grid is calculated as `2^⌈log₂(drawRate)⌉`. For example, a 60 Hz draw rate uses a 64-step quantization grid, creating ~1.5625% steps instead of perfect 1.667% (1/60). This controlled aliasing improves visual consistency at the cost of temporal precision.

### Configuration

Both rates accept any positive number and can be changed while running:

```js
const snaproll = new Snaproll({
  updateRate: 60, // animation logic frequency
  drawRate: 30, // drawing frequency
})

// Change rates dynamically
snaproll.updateRate = 120 // higher precision
snaproll.drawRate = 60 // smoother drawing
```

## API Reference

### Constructor

```js
const snaproll = new Snaproll(options?)
```

**Options:**

- `updateRate?: number` — Animation logic frequency (default: 60)
- `drawRate?: number` — Rendering frequency (default: 60)
- `context?: object` — Context object

### Instance Properties

```js
snaproll.updateRate: number     // Get/set update frequency
snaproll.drawRate: number       // Get/set draw frequency
snaproll.state: string          // Current state: 'active' | 'idle' | 'paused'
```

### Instance Methods

```js
snaproll.subscribe(callback, options?) → SubscriptionControls
snaproll.pause() → void
snaproll.resume() → void
snaproll.reset(options?) → void
```

**subscribe() options:**

- `immediate?: boolean` — Start active (default: true)

**reset() options:**

- `updateRate?: number` — New update frequency
- `drawRate?: number` — New draw frequency
- `context?: object` — Context object
- `keepSubscriptions?: boolean` — Preserve subscriptions (default: true)
- `keepContext?: boolean` — Preserve context (default: true)

### Subscription Controls

```js
const subscription = snaproll.subscribe(callback)

subscription.pause() → void        // Pause this subscription
subscription.resume() → void       // Resume this subscription
subscription.unsubscribe() → void  // Remove this subscription
```

### Context Object

The callback receives a context object with phase-specific fields:

| Field        | Available during    | Purpose                      |
| ------------ | ------------------- | ---------------------------- |
| `action`     | Begin, Update, Draw | Current phase type           |
| `timestamp`  | Begin               | Current frame time           |
| `timestep`   | Update              | Time to advance per update   |
| `updateStep` | Update              | Remaining updates this frame |
| `alpha`      | Draw                | Interpolation factor [0, 1)  |

> **Important**: The context object is phase-discriminated (different fields are valid for different phases). Only read the fields listed for the active phase. Other fields from previous phases may be present but should not be relied upon.

**Begin phase:**

```js
{
  action: SnaprollActionType.Begin,
  timestamp: number  // Current frame time
}
```

**Update phase:**

```js
{
  action: SnaprollActionType.Update,
  timestep: number,     // Time to advance per update
  updateStep: number    // Remaining updates this frame
}
```

**Draw phase:**

```js
{
  action: SnaprollActionType.Draw,
  alpha: number         // Interpolation factor [0, 1)
}
```

## Animation loop structure

The subscription function receives the same context object during each phase of the animation loop. Each phase populates different fields within this shared context object.

### Phase sequence

Each frame follows this order:

1. **Begin** — Frame initialization with current timestamp
2. **Update** — Animation calculations (may repeat)
3. **Draw** — Render using interpolated values

### Multiple updates per frame

Multiple Update phases may run before Draw. The `updateStep` field counts down the remaining updates in the current frame, starting from the total number needed and decrementing to 1 on the final update. For example, if 5 updates are needed in a frame, `updateStep` will be 5, then 4, then 3, then 2, then 1 across the five Update calls. This allows subscription functions to make optimization decisions based on update backlog.

```js
case SnaprollActionType.Update:
  console.log(`${context.updateStep} updates remaining this frame`)
  updateAnimation(context.timestep)
  break
```

## Configuration

### Initial setup

```js
const snaproll = new Snaproll({
  updateRate: 120, // Higher precision updates
  drawRate: 60, // Standard display refresh
  context: { score: 0 }, // Initial application state
})
```

### Runtime rate changes

Update rates while the animation runs. The accumulator is preserved during rate changes:

```js
// Rates take effect immediately, accumulator unchanged
snaproll.updateRate = 30 // Slower animation calculations
snaproll.drawRate = 120 // Higher refresh rate
```

### Resetting the loop

Use `reset()` to clear accumulator state and optionally reconfigure:

```js
// Reset with new configuration
snaproll.reset({
  updateRate: 60,
  drawRate: 30,
  keepSubscriptions: true, // Keep existing subscriptions (default)
  keepContext: true, // Preserve context object (default)
})

// Reset accumulator only
snaproll.reset()
```

Reset behavior:

- Clears internal accumulator state
- Preserves subscriptions and context by default
- Resumes automatically if the loop was running
- Keeps current rates unless new ones provided

### Context management

Control what happens to the context when calling `reset()`:

```js
// Use provided context object, merge existing context into it
snaproll.reset({
  context: { newField: 'value' },
  keepContext: true,
})
// Result: { newField: 'value', ...existingContextProperties }
// Note: existing properties overwrite conflicting new ones

// Use provided context object
snaproll.reset({
  context: { onlyField: 'value' },
  keepContext: false,
})
// Result: { onlyField: 'value' }

// Keep existing context unchanged
snaproll.reset({ keepContext: true })

// Start with empty context
snaproll.reset({ keepContext: false })
```

## Advanced Usage

Return `true` from a subscription to control when expensive operations run.

### Skip frames when needed

Return `true` from Begin to skip the entire frame. The accumulator remains untouched when skipping frames:

```js
case SnaprollActionType.Begin:
  if (!assetsLoaded) {
    return true  // Skip this frame entirely, accumulator unchanged
  }
  break
```

### Handle update backlog

Use `updateStep` to detect multiple queued updates and optimize accordingly. Zeroing the accumulator prevents spiral of death scenarios where update costs exceed frame budget:

```js
case SnaprollActionType.Update: {
  const coalesce = context.updateStep >= 100
  // Physics substep merge: combine multiple fixed timesteps into one larger step
  const totalTime = coalesce ? context.updateStep * context.timestep : context.timestep

  updateAnimation(totalTime)

  // Returning true zeros the accumulator and skips remaining updates and Draw phase for all subscribers
  return coalesce
}
```

### Execution order

- Subscriptions run in the order they were added
- All subscriptions process each phase before moving to the next
- Returning `true` from Update affects the current frame for all subscribers

### Subscription management

```js
const subscription = snaproll.subscribe((context) => {
  // Handle animation phases
})

// Control individual subscriptions
subscription.pause()
subscription.resume()
subscription.unsubscribe()

snaproll.pause() // Stop animation, keep subscriptions
snaproll.resume() // Resume animation
```

Loop states:

- **active** — Running animation frames (has active subscriptions)
- **idle** — Not running (no active subscriptions)
- **paused** — Stopped by `snaproll.pause()` (subscriptions remain)

Unless paused, snaproll starts automatically when subscriptions are added and becomes idle when all subscriptions are paused or removed.

### Shared context

Use TypeScript declaration merging to add type safety for shared state:

```ts
declare module 'snaproll' {
  interface SnaprollUserContext {
    score?: number
  }
}

// Now available in all context handlers
snaproll.subscribe((context) => {
  if (context.action === SnaprollActionType.Update) {
    context.score += 10
  }
})
```

## Examples

See the `example/` directory for complete working examples:

- **Bouncing Balls** (`canvas-2d-bouncing-balls.vue`) — Canvas animation with interpolated movement
- **Moving Rectangles** (`css-transform-rectangles.vue`) — CSS transform animation with smooth transitions

Each example demonstrates different aspects of snaproll:

- Frame rate independence
- Smooth interpolation using alpha values
- Performance optimization techniques
- Multiple subscription management

## Acknowledgments

- [Godot](https://github.com/godotengine/godot/blob/master/scene/main/scene_tree.cpp)
- [PixiJS Ticker](https://github.com/pixijs/pixijs/blob/dev/src/ticker/Ticker.ts)
- [Babylon.js](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Engines/abstractEngine.ts)
- [three.js Timer](https://github.com/mrdoob/three.js/blob/dev/src/core/Timer.js)
- [MainLoop.js](https://github.com/IceCreamYou/MainLoop.js)
