/**
 * Extension point for application-specific state that the animation loop shares across frames.
 *
 * @remarks
 * Augment this interface via declaration merging so custom properties flow into {@link SnaprollContext}.
 * Snaproll maintains a single context instance per controller; store long-lived data on user fields
 * and rely on {@link SnaprollActionType | action-specific} payloads for phase details.
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
  type SnaprollResetOptions,
  type SnaprollSubscription,
  type SnaprollSubscriptionControls,
} from './snaproll'

export {
  SnaprollDrawRateAdvisor,
  type SnaprollDrawRateAdvisorOptions,
  type SnaprollDrawRateAdvisorResponse,
  type SnaprollDrawRateAdvisorSubscription,
} from './draw-rate-advisor'
