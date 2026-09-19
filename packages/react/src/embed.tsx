import { useEffect, useRef } from 'react';
import type { CheckoutResult, CheckoutSessionRef, ClientCheckoutSession } from '@bitnormous/business-sdk';
import { BitnormousError } from '@bitnormous/business-core';

import { useBitnormous } from './provider.js';

export interface BitnormousCheckoutEmbedProps {
  /** The session your server created. */
  session: CheckoutSessionRef;
  onSuccess?: (session: ClientCheckoutSession) => void;
  onStatusChange?: (session: ClientCheckoutSession) => void;
  onClose?: (result: CheckoutResult) => void;
  onError?: (error: BitnormousError) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The checkout, inline in your page instead of over it.
 *
 * It sizes itself to its content as the customer moves through the steps, so it behaves like a
 * block in your layout rather than a fixed-height frame with its own scrollbar.
 *
 * ```tsx
 * <BitnormousCheckoutEmbed
 *   session={{ id, clientSecret }}
 *   onSuccess={(session) => router.push(`/orders/${session.reference}`)}
 * />
 * ```
 */
export function BitnormousCheckoutEmbed({
  session,
  onSuccess,
  onStatusChange,
  onClose,
  onError,
  className,
  style,
}: BitnormousCheckoutEmbedProps) {
  const checkout = useBitnormous();
  const container = useRef<HTMLDivElement>(null);

  // Held in refs so inline handlers do not remount the iframe — which would restart the checkout
  // and, mid-payment, blank the address the customer is copying.
  const handlers = useRef({ onSuccess, onStatusChange, onClose, onError });
  handlers.current = { onSuccess, onStatusChange, onClose, onError };

  useEffect(() => {
    const target = container.current;
    if (!target) {
      return;
    }

    const handle = checkout.mount(target, {
      session,
      onSuccess: (next) => handlers.current.onSuccess?.(next),
      onStatusChange: (next) => handlers.current.onStatusChange?.(next),
      onClose: (result) => handlers.current.onClose?.(result),
      onError: (error) => handlers.current.onError?.(error),
    });

    return handle.unmount;
  }, [checkout, session.id, session.clientSecret]);

  return <div ref={container} className={className} style={style} />;
}
