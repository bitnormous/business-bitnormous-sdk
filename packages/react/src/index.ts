/**
 * `@bitnormous/business-react` — React bindings for Bitnormous checkouts.
 *
 * ```tsx
 * import { BitnormousProvider, useCheckout } from '@bitnormous/business-react';
 *
 * function App() {
 *   return (
 *     <BitnormousProvider createSession="/api/bitnormous/checkout">
 *       <Cart />
 *     </BitnormousProvider>
 *   );
 * }
 *
 * function Cart() {
 *   const { open, isOpen } = useCheckout();
 *
 *   return (
 *     <button disabled={isOpen} onClick={() => open({ amount: 125, currency: 'USD', reference: 'ORDER-1' })}>
 *       Pay with crypto
 *     </button>
 *   );
 * }
 * ```
 */

export { BitnormousProvider, useBitnormous, type BitnormousProviderProps } from './provider.js';
export { useCheckout, type UseCheckoutResult } from './use-checkout.js';
export {
  useCheckoutSession,
  type UseCheckoutSessionOptions,
  type UseCheckoutSessionResult,
} from './use-checkout-session.js';
export { BitnormousCheckoutEmbed, type BitnormousCheckoutEmbedProps } from './embed.js';

export {
  BitnormousCheckout,
  BitnormousError,
  ErrorCodes,
  formatAmount,
  formatCrypto,
  formatDuration,
  paymentProgress,
  secondsUntil,
  type CheckoutResult,
  type CheckoutSessionRef,
  type ClientCheckoutSession,
  type CheckoutSession,
  type CheckoutSessionStatus,
  type PaymentLeg,
  type PaymentStatus,
  type AcceptedAsset,
  type AcceptedChain,
  type CreateCheckoutSessionParams,
  type OpenOptions,
} from '@bitnormous/business-sdk';
