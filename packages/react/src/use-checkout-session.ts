import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BitnormousError,
  CheckoutClient,
  type ClientCheckoutSession,
} from '@bitnormous/business-core';

export interface UseCheckoutSessionOptions {
  /** The `cs_…` id from your server. */
  sessionId: string | undefined;
  /** That session's client secret, also from your server. */
  clientSecret: string | undefined;
  /** Override the API origin. */
  baseUrl?: string;
  /** Called once when the order is paid in full. */
  onSuccess?: (session: ClientCheckoutSession) => void;
  /** Called once when it can no longer be paid. */
  onExpired?: (session: ClientCheckoutSession) => void;
}

export interface UseCheckoutSessionResult {
  session: ClientCheckoutSession | undefined;
  /** True only on the very first load — never during the background polls. */
  isLoading: boolean;
  /** Set when a read failed. Polling continues regardless; show a quiet hint, not an error page. */
  error: BitnormousError | undefined;
  /** True while a `selectAsset` call is in flight, for disabling the picker. */
  isSelecting: boolean;
  /** Pick what to pay in. Pass an `ecurrency.id` from `session.accepted`. */
  selectAsset: (ecurrencyId: number) => Promise<void>;
  /** True once nothing more can happen. */
  isTerminal: boolean;
}

/**
 * Drive a checkout yourself, with your own UI.
 *
 * This is the headless escape hatch: the same state machine the hosted checkout runs on, with no
 * markup attached. Reach for it when you want the payment inside your own design system rather
 * than in Bitnormous's modal — a native-feeling flow in a React Native app, or a checkout step that
 * has to match a very particular brand.
 *
 * It handles the polling cadence, the wake-on-focus behaviour and the terminal transitions for
 * you; you render.
 *
 * ```tsx
 * const { session, isLoading, selectAsset } = useCheckoutSession({ sessionId, clientSecret });
 *
 * if (isLoading) return <Skeleton />;
 * if (!session?.payment) return <AssetPicker accepted={session?.accepted} onPick={selectAsset} />;
 *
 * return <PayScreen payment={session.payment} />;
 * ```
 */
export function useCheckoutSession(options: UseCheckoutSessionOptions): UseCheckoutSessionResult {
  const { sessionId, clientSecret, baseUrl, onSuccess, onExpired } = options;

  const [session, setSession] = useState<ClientCheckoutSession>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<BitnormousError>();
  const [isSelecting, setIsSelecting] = useState(false);

  // Kept in refs so a caller passing inline arrows does not restart the watch on every render —
  // which would re-poll the API several times a second.
  const successRef = useRef(onSuccess);
  const expiredRef = useRef(onExpired);
  successRef.current = onSuccess;
  expiredRef.current = onExpired;

  const client = useMemo(
    () =>
      sessionId && clientSecret
        ? new CheckoutClient({ sessionId, clientSecret, ...(baseUrl !== undefined ? { baseUrl } : {}) })
        : undefined,
    [sessionId, clientSecret, baseUrl],
  );

  useEffect(() => {
    if (!client) {
      return;
    }

    setIsLoading(true);

    const stop = client.watch({
      onUpdate: (next) => {
        setSession(next);
        setIsLoading(false);
        setError(undefined);
      },
      onSuccess: (next) => successRef.current?.(next),
      onExpired: (next) => expiredRef.current?.(next),
      onError: (nextError) => {
        setError(nextError);
        setIsLoading(false);
      },
    });

    return stop;
  }, [client]);

  const selectAsset = useCallback(
    async (ecurrencyId: number) => {
      if (!client) {
        throw new BitnormousError('The checkout session is not ready yet.', { code: 'checkout_not_ready' });
      }

      setIsSelecting(true);
      try {
        // The response is the full checkout, so the address and amount land in one render rather
        // than after the next poll — the picker feels instant.
        setSession(await client.selectAsset(ecurrencyId));
        setError(undefined);
      } catch (cause) {
        const thrown =
          cause instanceof BitnormousError
            ? cause
            : new BitnormousError('Could not select that asset.', { cause });
        setError(thrown);
        throw thrown;
      } finally {
        setIsSelecting(false);
      }
    },
    [client],
  );

  const isTerminal =
    session?.status === 'completed' || session?.status === 'expired' || session?.status === 'cancelled';

  return { session, isLoading, error, isSelecting, selectAsset, isTerminal };
}
