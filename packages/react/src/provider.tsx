import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BitnormousCheckout, type BitnormousCheckoutOptions } from '@bitnormous/business-sdk';

const CheckoutContext = createContext<BitnormousCheckout | null>(null);

export interface BitnormousProviderProps extends BitnormousCheckoutOptions {
  children: ReactNode;
}

/**
 * Holds one `BitnormousCheckout` for your whole app.
 *
 * Put it above anything that can start a payment — usually next to your other providers in the
 * root layout. Mounting it does not load the checkout or make a request; nothing happens until
 * something calls `open`.
 *
 * ```tsx
 * <BitnormousProvider createSession="/api/bitnormous/checkout">
 *   <App />
 * </BitnormousProvider>
 * ```
 */
export function BitnormousProvider({ children, ...options }: BitnormousProviderProps) {
  const { createSession, checkoutUrl, theme, locale } = options;

  // Rebuilt only when configuration genuinely changes. An inline `createSession` function would
  // otherwise be a new reference on every render and tear the instance down each time — taking
  // any open modal with it.
  const checkout = useMemo(
    () =>
      new BitnormousCheckout({
        ...(createSession !== undefined ? { createSession } : {}),
        ...(checkoutUrl !== undefined ? { checkoutUrl } : {}),
        ...(theme !== undefined ? { theme } : {}),
        ...(locale !== undefined ? { locale } : {}),
      }),
    [createSession, checkoutUrl, theme, locale],
  );

  const previous = useRef(checkout);

  useEffect(() => {
    // A replaced instance must not leave its modal orphaned over the page.
    if (previous.current !== checkout) {
      previous.current.close();
      previous.current = checkout;
    }

    return () => {
      checkout.close();
    };
  }, [checkout]);

  return <CheckoutContext.Provider value={checkout}>{children}</CheckoutContext.Provider>;
}

/** The shared instance. Throws with a useful message if the provider is missing. */
export function useBitnormous(): BitnormousCheckout {
  const checkout = useContext(CheckoutContext);

  if (!checkout) {
    throw new Error(
      'No <BitnormousProvider> was found above this component. Wrap your app (or the part of it ' +
        'that takes payments) in one.',
    );
  }

  return checkout;
}
