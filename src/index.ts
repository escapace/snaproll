/**
 * Context interface for application-specific state.
 *
 * @remarks
 * Uses TypeScript declaration merging to allow augmentation with custom properties.
 * Extended properties become available in all subscription callbacks.
 *
 * @example
 * ```ts
 * declare module 'snaproll' {
 *   interface SnaprollUserContext {
 *     score: number
 *   }
 * }
 * ```
 */
// eslint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface
export interface SnaprollUserContext {}

export {
  Snaproll,
  SnaprollActionType,
  type SnaprollActionBegin,
  type SnaprollActionDraw,
  type SnaprollActionUpdate,
  type SnaprollContext,
  type SnaprollOptions,
  type SnaprollSubscription,
  type SnaprollSubscriptionControls,
} from './snaproll'

export {
  SnaprollDrawRateAdvisor,
  type SnaprollDrawRateAdvisorOptions,
  type SnaprollDrawRateAdvisorResponse,
  type SnaprollDrawRateAdvisorSubscription,
} from './draw-rate-advisor'
