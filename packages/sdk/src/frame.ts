/**
 * The iframe plumbing shared by the modal and the inline embed.
 *
 * Both presentations load the same hosted checkout and speak the same protocol; they differ only
 * in the chrome around it. This keeps the origin checking, the message wiring and the teardown in
 * one place so neither can drift into being the less careful one.
 */

import {
  envelope,
  readMessage,
  type CheckoutInboundMessage,
  type CheckoutOutboundMessage,
} from '@bitnormous/business-core';

export interface FrameHandle {
  element: HTMLIFrameElement;
  /** Send a message into the checkout. Silently ignored once the frame is gone. */
  post: (message: CheckoutInboundMessage) => void;
  /** Detach the listener. Does not remove the element — the caller owns the DOM. */
  destroy: () => void;
}

export interface FrameOptions {
  checkoutUrl: string;
  sessionId: string;
  clientSecret: string;
  embedded: boolean;
  theme?: 'light' | 'dark' | 'auto';
  locale?: string;
  title: string;
  onMessage: (message: CheckoutOutboundMessage) => void;
}

/**
 * Build the URL the iframe loads.
 *
 * The client secret goes in the FRAGMENT, never the query string. A fragment is not sent to the
 * server, does not appear in an access log, and is not forwarded in a `Referer` header — so the
 * credential reaches the checkout's JavaScript and stops there.
 */
export function buildCheckoutUrl(options: {
  checkoutUrl: string;
  sessionId: string;
  clientSecret: string;
  embedded: boolean;
  theme?: 'light' | 'dark' | 'auto';
  locale?: string;
}): string {
  const url = new URL(`/c/${encodeURIComponent(options.sessionId)}`, options.checkoutUrl);

  if (options.embedded) {
    url.searchParams.set('embed', '1');
  }
  if (options.theme && options.theme !== 'auto') {
    url.searchParams.set('theme', options.theme);
  }
  if (options.locale) {
    url.searchParams.set('locale', options.locale);
  }

  url.hash = `s=${options.clientSecret}`;

  return url.toString();
}

/** The origin messages must come from. Anything else is not the checkout and is ignored. */
export function originOf(checkoutUrl: string): string {
  return new URL(checkoutUrl).origin;
}

export function createFrame(options: FrameOptions): FrameHandle {
  const origin = originOf(options.checkoutUrl);

  const element = document.createElement('iframe');
  element.src = buildCheckoutUrl(options);
  element.title = options.title;
  element.className = 'bn-frame';
  // Everything the checkout needs and nothing it does not. `allow-same-origin` is required for it
  // to reach its own API and storage; it is safe here because the frame is a different origin from
  // the merchant's page, so it still cannot touch the embedding document.
  element.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation',
  );
  // Let the customer paste an address out, and pay with a platform wallet where one exists.
  element.setAttribute('allow', `clipboard-write ${origin}; payment ${origin}`);
  element.setAttribute('loading', 'eager');

  const onMessage = (event: MessageEvent) => {
    const payload = readMessage<CheckoutOutboundMessage>(event, { origin, sessionId: options.sessionId });

    if (payload !== null) {
      options.onMessage(payload);
    }
  };

  window.addEventListener('message', onMessage);

  return {
    element,
    post: (message) => {
      element.contentWindow?.postMessage(envelope(options.sessionId, message), origin);
    },
    destroy: () => {
      window.removeEventListener('message', onMessage);
    },
  };
}
