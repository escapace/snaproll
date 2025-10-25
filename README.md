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
subscription.resume() // Resume after

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

### Timing system

Snaproll uses a bang-bang digital PLL (phase-locked loop) that captures requestAnimationFrame edges nearest to the target cadence. The PLL uses `performance.now()` for high-precision timing and computes phase error in target-frame units with a symmetric dead-zone (epsilon = 3e-3 ≈ 50µs at 60Hz) to determine when to advance the target timestamp. This keeps timing error bounded to within ±0.5 target frame periods while decimating 120→60 Hz, 144→48 Hz, 60→30 Hz cleanly without drift.

### Quantized interpolation

During the Draw phase, snaproll provides an `alpha` value \[0, 1) representing fractional progress toward the next update. The alpha value is quantized to a power-of-two grid based on the draw rate. The quantization grid is calculated as `2^⌈log₂(drawRate * 2)⌉`. For example, a 60 Hz draw rate uses a 128-step quantization grid. The alpha is calculated as `((alpha * grid + 0.5) | 0) / grid` clamped to `(grid-1)/grid`, which rounds to the nearest grid step. This controlled quantization improves visual consistency at the cost of temporal precision.

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

## SnaprollDrawRateAdvisor

Measures frame timing to detect display's refresh rate and recommend compatible draw rates.

```js
import { SnaprollDrawRateAdvisor } from 'snaproll'

// Create advisor with optional configuration
const advisor = new SnaprollDrawRateAdvisor({
  samples: 90, // Collect 90 frame intervals
  warmup: 10, // Skip first 10 frames
  minDraw: 10, // Minimum recommended rate
})

// Subscribe to recommendations
const unsubscribe = advisor.subscribe((response) => {
  console.log(`Quality score: ${response.score.toFixed(3)}`)
  console.log(`Recommended rates: ${response.values.join(', ')} Hz`)
})

// Start analysis
advisor.trigger()
```

The advisor provides quality scores \[0-1] using RF (Robustness × Fit) formula and recommended draw rates sorted descending. Scores ≥0.85 indicate healthy timing with mild jitter; scores <0.60 show strong evidence of blocking/jitter or regime split and recommend re-running.

## Examples

View examples at <https://escapace.github.io/snaproll/> or see the `examples/` directory:

- **Bouncing Balls** (`canvas-2d-bouncing-balls.vue`) — Canvas animation with interpolated movement
- **Moving Rectangles** (`css-transform-rectangles.vue`) — CSS transform animation with smooth transitions

Each example demonstrates different aspects of snaproll:

- Frame rate independence
- Smooth interpolation using alpha values
- Performance optimization techniques
- Multiple subscription management

## API

### class Snaproll [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L459-L699 'Snaproll')

Fixed-timestep animation loop with independent draw and update rates.

```typescript
export declare class Snaproll
```

#### new Snaproll

Creates animation loop instance with specified configuration.

```typescript
constructor(options?: Partial<SnaprollOptions>);
```

##### Parameters

| Parameter | Type                                                                                           | Description                            |
| --------- | ---------------------------------------------------------------------------------------------- | -------------------------------------- |
| `options` | <pre>Partial<[SnaprollOptions](#interface-snaprolloptions- 'interface SnaprollOptions')></pre> | Options applied during initialization. |

##### Remarks

Uses the default [updateRate](#snaprolloptionsupdaterate) of 60 Hz, [drawRate](#snaprolloptionsdrawrate) of 60 Hz, and a new shared context object when those entries are not provided.

#### Snaproll.pause

Stops animation while keeping subscriptions.

```typescript
pause(): void;
```

#### Snaproll.reset

Resets the animation loop with optional configuration updates.

```typescript
reset(options?: SnaprollResetOptions): void;
```

##### Parameters

| Parameter | Type                                                                                                 | Description                                                               |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `options` | <pre>[SnaprollResetOptions](#interface-snaprollresetoptions- 'interface SnaprollResetOptions')</pre> | Reset options controlling configuration overrides and retention behavior. |

##### Remarks

Retains the current [updateRate](#snaprolloptionsupdaterate) and [drawRate](#snaprolloptionsdrawrate) when those fields are omitted.

- `keepSubscriptions` defaults to `true`, preserving existing subscriptions unless explicitly disabled.
- `keepContext` defaults to `true`, reusing the current context. Providing [context](#interface-snaprollusercontext-) copies existing entries when `keepContext` stays `true`, or replaces the context when `keepContext` is `false`.

#### Snaproll.resume

Resumes animation.

```typescript
resume(): void;
```

#### Snaproll.subscribe

Registers subscription callback for animation frame processing.

```typescript
subscribe(value: SnaprollSubscription, options?: {
  immediate?: boolean;
}): SnaprollSubscriptionControls;
```

##### Parameters

| Parameter | Type                                                                                       | Description                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `value`   | <pre>[SnaprollSubscription](#type-snaprollsubscription- 'type SnaprollSubscription')</pre> | Callback function to execute during frame processing.                                                               |
| `options` | <pre>{<br> immediate?: boolean;<br>}</pre>                                                 | Subscription configuration. The `immediate` flag defaults to `true` and activates the subscription on registration. |

##### Returns

[Control object](#interface-snaprollsubscriptioncontrols-) for pausing, resuming, and removing the subscription.

##### Remarks

Subscriptions run in insertion order. New subscriptions start immediately unless `options.immediate` is set to `false`.

#### Snaproll.drawRate

Getter and setter for the current draw rate in Hz.

```typescript
get drawRate(): number;
set drawRate(value: number);
```

#### Snaproll.state

Current animation loop state.

Returns 'active' when running animation frames, 'idle' when no active subscriptions, or 'paused' when stopped by pause().

```typescript
get state(): "active" | "idle" | "paused";
```

#### Snaproll.updateRate

Getter and setter for the current update rate in Hz.

```typescript
get updateRate(): number;
set updateRate(value: number);
```

### class SnaprollDrawRateAdvisor [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/draw-rate-advisor.ts#L241-L311 'SnaprollDrawRateAdvisor')

Provides draw rates inferred from observed frame periods.

The recommendation logic is stateless and deterministic: identical period inputs produce identical outputs. Concurrent class instances do not interfere with each other.

```typescript
export declare class SnaprollDrawRateAdvisor
```

#### new SnaprollDrawRateAdvisor

Creates a new draw rate advisor instance.

```typescript
constructor(options?: SnaprollDrawRateAdvisorOptions);
```

##### Parameters

| Parameter | Type                                                                                                                               | Description                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `options` | <pre>[SnaprollDrawRateAdvisorOptions](#interface-snaprolldrawrateadvisoroptions- 'interface SnaprollDrawRateAdvisorOptions')</pre> | Configuration options for the advisor |

##### Throws

Assertion error if any option values are invalid

#### SnaprollDrawRateAdvisor.dispose

Cancels ongoing operations and releases resources.

```typescript
dispose(): void;
```

#### SnaprollDrawRateAdvisor.subscribe

Registers callback for recommendation results.

Callbacks receive SnaprollDrawRateAdvisorResponse when recommendation completes successfully. Callbacks are not invoked if the operation is canceled or produces no recommendations.

```typescript
subscribe(subscription: SnaprollDrawRateAdvisorSubscription): () => void;
```

##### Parameters

| Parameter      | Type                                                                                                                                    | Description                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `subscription` | <pre>[SnaprollDrawRateAdvisorSubscription](#type-snaprolldrawrateadvisorsubscription- 'type SnaprollDrawRateAdvisorSubscription')</pre> | Callback function to invoke with results |

##### Returns

Function that unregisters the subscription when called

#### SnaprollDrawRateAdvisor.trigger

Cancels any previous ongoing operation before starting a new one. Results are delivered to registered subscriptions when the operation completes. If the operation is canceled or produces no recommendations, subscriptions are not invoked.

```typescript
trigger(): void;
```

### enum SnaprollActionType [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L7-L11 'SnaprollActionType')

Animation frame phases.

```typescript
export declare enum SnaprollActionType
```

#### Members

| Member   | Value        |
| -------- | ------------ |
| `Begin`  | <pre>0</pre> |
| `Update` | <pre>1</pre> |
| `Draw`   | <pre>2</pre> |

### interface SnaprollActionBegin [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L16-L20 'SnaprollActionBegin')

Frame initialization action.

```typescript
export interface SnaprollActionBegin
```

#### SnaprollActionBegin.timestamp

Current frame time

```typescript
timestamp: number
```

### interface SnaprollActionDraw [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L37-L41 'SnaprollActionDraw')

Interpolated drawing action.

```typescript
export interface SnaprollActionDraw extends Omit<SnaprollActionUpdate, 'action'>
```

#### SnaprollActionDraw\.alpha

Interpolation factor \[0, 1)

```typescript
alpha: number
```

### interface SnaprollActionUpdate [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L26-L32 'SnaprollActionUpdate')

Fixed timestep animation logic action. The updateStep counts down remaining updates in the current frame.

```typescript
export interface SnaprollActionUpdate extends Omit<SnaprollActionBegin, 'action'>
```

#### SnaprollActionUpdate.timestep

Time to advance per update

```typescript
timestep: number
```

#### SnaprollActionUpdate.updateStep

Remaining updates this frame, counts down to 1

```typescript
updateStep: number
```

### interface SnaprollDrawRateAdvisorOptions [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/draw-rate-advisor.ts#L165-L196 'SnaprollDrawRateAdvisorOptions')

#### SnaprollDrawRateAdvisorOptions.canonicalBases

Array of canonical refresh rates to consider for snapping. Must be non-empty array of positive integers.

```typescript
canonicalBases?: readonly number[];
```

#### SnaprollDrawRateAdvisorOptions.maxDivisor

Maximum count of divisors to consider for candidate generation and output. Must be positive integer ≥ 1.

```typescript
maxDivisor?: number;
```

#### SnaprollDrawRateAdvisorOptions.minDraw

Minimum draw rate to include in results. Must be positive integer ≥ 5.

```typescript
minDraw?: number;
```

#### SnaprollDrawRateAdvisorOptions.samples

Number of frame intervals to collect after warmup. Must be positive integer ≥ 30.

```typescript
samples?: number;
```

#### SnaprollDrawRateAdvisorOptions.warmup

Number of frames to ignore before sampling. Must be non-negative integer ≥ 0.

```typescript
warmup?: number;
```

### interface SnaprollDrawRateAdvisorResponse [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/draw-rate-advisor.ts#L130-L154 'SnaprollDrawRateAdvisorResponse')

#### SnaprollDrawRateAdvisorResponse.score

Quality score in range \[0,1] using RF (Robustness × Fit) formula. Higher scores indicate better data consistency and more reliable recommendations.

Score interpretation:

- `0.95–1.00`: Rock-solid. Extremely stable capture, fits a canonical/divisor cleanly
- `0.85–0.95`: Healthy. Mild jitter only; values are trustworthy
- `0.75–0.85`: Borderline steady. Noticeable instability or light regime mixing; fine for most uses, re-run if chasing perfection
- `0.60–0.75`: Shaky. Significant jitter or likely mid-phase change; consider re-running
- `< 0.60` : Unstable. Strong evidence of blocking/jitter or regime split; re-run recommended

```typescript
score: number
```

#### SnaprollDrawRateAdvisorResponse.values

Array of recommended draw rates (Hz), sorted descending and de-duplicated. All values are integers and ≥ minDraw.

```typescript
values: number[];
```

### interface SnaprollOptions [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L94-L110 'SnaprollOptions')

Configuration interface for animation loop.

```typescript
export interface SnaprollOptions
```

#### Remarks

drawRate and updateRate operate independently, allowing different frequencies for draw and update rates.

#### SnaprollOptions.context

Optional shared state object passed to all subscription callbacks.

```typescript
context?: SnaprollUserContext;
```

#### SnaprollOptions.drawRate

Draw rate in Hz, controls visual frame timing.

```typescript
drawRate: number
```

#### SnaprollOptions.updateRate

Update rate in Hz, determines fixed timestep size.

```typescript
updateRate: number
```

### interface SnaprollResetOptions [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L118-L145 'SnaprollResetOptions')

Options accepted by [Snaproll.reset](#snaprollreset).

```typescript
export interface SnaprollResetOptions extends Partial<SnaprollOptions>
```

#### Remarks

Extends [SnaprollOptions](#interface-snaprolloptions-) and controls how subscriptions and context objects are preserved.

#### SnaprollResetOptions.context

Determines the [context](#interface-snaprollusercontext-) to use after reset completes.

```typescript
context?: SnaprollUserContext;
```

##### Remarks

The context resolution follows these rules:

- If `keepContext=true` and `context` is provided: applies the provided object and copies existing context into it.
- If `keepContext=false` and `context` is provided: uses the provided object as-is.
- If `keepContext=true` and `context` is omitted: reuses the existing context object.
- If `keepContext=false` and `context` is omitted: creates a new empty context object.

#### SnaprollResetOptions.keepContext

Preserve the existing context object during reset.

```typescript
keepContext?: boolean;
```

#### SnaprollResetOptions.keepSubscriptions

Preserve existing subscription callbacks during reset.

```typescript
keepSubscriptions?: boolean;
```

### interface SnaprollSubscriptionControls [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L62-L69 'SnaprollSubscriptionControls')

Control interface for managing individual animation subscriptions.

```typescript
export interface SnaprollSubscriptionControls
```

#### Remarks

Each subscription operates independently. Pausing one subscription does not affect others. The animation loop continues running as long as any subscription remains active.

#### SnaprollSubscriptionControls.pause

Pauses this subscription

```typescript
pause: () => void;
```

#### SnaprollSubscriptionControls.resume

Resumes this subscription

```typescript
resume: () => void;
```

#### SnaprollSubscriptionControls.unsubscribe

Removes this subscription

```typescript
unsubscribe: () => void;
```

### interface SnaprollUserContext [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/index.ts#L19 'SnaprollUserContext')

Extension point for application-specific state that the animation loop shares across frames.

```typescript
export interface SnaprollUserContext
```

#### Remarks

Augment this interface via declaration merging so custom properties flow into [SnaprollContext](#type-snaprollcontext-). Snaproll maintains a single context instance per controller; store long-lived data on user fields and rely on [action-specific](#enum-snaprollactiontype-) payloads for phase details.

#### Examples

```ts
declare module 'snaproll' {
  interface SnaprollUserContext {
    score: number
  }
}
```

### type SnaprollContext [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L52-L53 'SnaprollContext')

Context object passed to subscription callbacks during animation frames.

```typescript
export type SnaprollContext = (SnaprollActionBegin | SnaprollActionDraw | SnaprollActionUpdate) &
  SnaprollUserContext
```

#### Remarks

Intersects the action-specific payload with [SnaprollUserContext](#interface-snaprollusercontext-), so that custom state persists across [loop phases](#enum-snaprollactiontype-). Inspect the `action` discriminant to determine which `SnaprollAction*` view is valid while treating application-specific fields as shared state.

### type SnaprollDrawRateAdvisorSubscription [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/draw-rate-advisor.ts#L161-L163 'SnaprollDrawRateAdvisorSubscription')

Callback function invoked when draw rate estimation completes.

```typescript
export type SnaprollDrawRateAdvisorSubscription = (
  response: SnaprollDrawRateAdvisorResponse,
) => void
```

### type SnaprollSubscription [↗](https://github.com/escapace/snaproll/blob/5969894c4230eb5f1505be14840b80655ca1a52b/src/snaproll.ts#L83 'SnaprollSubscription')

Subscription callback function.

```typescript
export type SnaprollSubscription = (context: SnaprollContext) => boolean | undefined
```

#### Remarks

Return value controls frame execution flow:

- `true` from Begin phase skips the entire frame
- `true` from Update phase skips remaining updates and draw for current frame
- `undefined` or `false` continues normal execution

## Acknowledgments

- [Godot](https://github.com/godotengine/godot/blob/master/scene/main/scene_tree.cpp)
- [PixiJS Ticker](https://github.com/pixijs/pixijs/blob/dev/src/ticker/Ticker.ts)
- [Babylon.js](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Engines/abstractEngine.ts)
- [three.js Timer](https://github.com/mrdoob/three.js/blob/dev/src/core/Timer.js)
- [MainLoop.js](https://github.com/IceCreamYou/MainLoop.js)
