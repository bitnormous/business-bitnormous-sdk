/**
 * The inline (embedded) presentation.
 *
 * Same hosted checkout, no modal chrome: it sits in the merchant's own layout, on their own page,
 * and grows and shrinks with its content so there is never an inner scrollbar or a band of dead
 * space beneath it.
 */

import type { CheckoutOutboundMessage } from '@bitnormous/business-core';

import { createFrame } from './frame.js';
import { EMBED_STYLES } from './styles.js';

export interface EmbedHandle {
  /** Remove the checkout and stop listening. Call this on unmount. */
  unmount: () => void;
}

export interface EmbedOptions {
  target: HTMLElement;
  checkoutUrl: string;
  sessionId: string;
  clientSecret: string;
  theme?: 'light' | 'dark' | 'auto';
  locale?: string;
  onMessage: (message: CheckoutOutboundMessage) => void;
}

/** Never let a mis-reported height collapse the checkout or run away down the page. */
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 1200;

export function mountEmbed(options: EmbedOptions): EmbedHandle {
  const host = document.createElement('div');
  host.setAttribute('data-bitnormous-checkout', options.sessionId);
  if (options.theme && options.theme !== 'auto') {
    host.dataset['theme'] = options.theme;
  }

  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = EMBED_STYLES;

  const frame = createFrame({
    checkoutUrl: options.checkoutUrl,
    sessionId: options.sessionId,
    clientSecret: options.clientSecret,
    embedded: true,
    ...(options.theme !== undefined ? { theme: options.theme } : {}),
    ...(options.locale !== undefined ? { locale: options.locale } : {}),
    title: 'Bitnormous secure checkout',
    onMessage: (message) => {
      if (message.type === 'ready') {
        frame.post({
          type: 'init',
          embedded: true,
          ...(options.theme !== undefined ? { theme: options.theme } : {}),
          ...(options.locale !== undefined ? { locale: options.locale } : {}),
        });
      }

      if (message.type === 'resize') {
        frame.element.style.height = `${clamp(message.height)}px`;
      }

      options.onMessage(message);
    },
  });

  root.append(style, frame.element);
  options.target.append(host);

  return {
    unmount: () => {
      frame.destroy();
      host.remove();
    },
  };
}

function clamp(height: number): number {
  if (!Number.isFinite(height)) {
    return MIN_HEIGHT;
  }

  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));
}
