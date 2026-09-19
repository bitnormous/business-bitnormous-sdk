import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CheckoutResult,
  ClientCheckoutSession,
  OpenOptions,
} from '@bitnormous/business-sdk';

import { useBitnormous } from './provider.js';

export interface UseCheckoutResult {
  /** Open the modal. Resolves when it closes, with how it ended. */
  open: (options: OpenOptions) => Promise<CheckoutResult>;
  /** Close it from your own code. */
  close: () => void;
  /** True while the modal is up. */
  isOpen: boolean;
  /** The latest state the checkout reported, or `undefined` before it has reported any. */
  session: ClientCheckoutSession | undefined;
  /** How the last checkout ended. */
  result: CheckoutResult | undefined;
  /** Set when the checkout could not be started or run. */
  error: Error | undefined;
}

/**
 * Open a Bitnormous checkout from a component.
 *
 * ```tsx
 * function PayButton({ order }) {
 *   const { open, isOpen } = useCheckout();
 *
 *   return (
 *     <button
 *       disabled={isOpen}
 *       onClick={() =>
 *         open({
 *           amount: order.total,
 *           currency: order.currency,
 *           reference: order.id,
 *           customer: { email: order.email },
 *         })
 *       }
 *     >
 *       {isOpen ? 'Checkout open…' : 'Pay with crypto'}
 *     </button>
 *   );
 * }
 * ```
 *
 * @remarks
 * Treat `session.status === 'completed'` here as "show the customer their receipt", not as "the
 * order is paid for". The authoritative signal is the `checkout_session.completed` webhook on your
 * server, which arrives whether or not the customer's browser survived the payment.
 */
export function useCheckout(): UseCheckoutResult {
  const checkout = useBitnormous();

  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<ClientCheckoutSession>();
  const [result, setResult] = useState<CheckoutResult>();
  const [error, setError] = useState<Error>();

  // React may unmount the component while the customer still has the modal open (a route change
  // behind it, a suspended parent). Nothing should set state after that.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = useCallback(
    async (options: OpenOptions): Promise<CheckoutResult> => {
      setError(undefined);
      setResult(undefined);
      setIsOpen(true);

      try {
        const outcome = await checkout.open({
          ...options,
          onStatusChange: (next) => {
            if (mounted.current) {
              setSession(next);
            }
            options.onStatusChange?.(next);
          },
          onError: (nextError) => {
            if (mounted.current) {
              setError(nextError);
            }
            options.onError?.(nextError);
          },
        } as OpenOptions);

        if (mounted.current) {
          setResult(outcome);
          if (outcome.session) {
            setSession(outcome.session);
          }
        }

        return outcome;
      } catch (cause) {
        const thrown = cause instanceof Error ? cause : new Error('The checkout could not be opened.');
        if (mounted.current) {
          setError(thrown);
        }
        throw thrown;
      } finally {
        if (mounted.current) {
          setIsOpen(false);
        }
      }
    },
    [checkout],
  );

  const close = useCallback(() => {
    checkout.close();
  }, [checkout]);

  return { open, close, isOpen, session, result, error };
}
