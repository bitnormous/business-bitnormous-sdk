/**
 * The modal presentation.
 *
 * Built on the native `<dialog>` element, which is not a stylistic choice: it gives the customer a
 * real focus trap, `Escape` to dismiss, inert background content and top-layer stacking that no
 * `z-index` on the merchant's page can get above — all behaviours a hand-rolled overlay gets
 * subtly wrong, on a screen where "subtly wrong" means a customer cannot reach the Pay button.
 *
 * The whole thing lives in a shadow root so the merchant's CSS reset cannot reach in and the
 * modal's styles cannot leak out.
 */

import type { CheckoutOutboundMessage, ClientCheckoutSession } from '@bitnormous/business-core';

import { createFrame, type FrameHandle } from './frame.js';
import { MODAL_STYLES } from './styles.js';

export interface ModalOptions {
  checkoutUrl: string;
  sessionId: string;
  clientSecret: string;
  theme?: 'light' | 'dark' | 'auto';
  locale?: string;
  /** Called for every protocol message; the caller decides what is worth acting on. */
  onMessage: (message: CheckoutOutboundMessage) => void;
  /** Called when the customer dismisses the modal themselves. */
  onDismiss: () => void;
}

export interface ModalHandle {
  close: () => void;
  /** The last session state the checkout reported, if any. */
  session: () => ClientCheckoutSession | undefined;
}

/**
 * A checkout is never usefully shorter than this. The upper bound is deliberately generous because
 * the real ceiling is CSS `max-height: calc(100vh - 48px)` on the panel, which knows the viewport;
 * clamping tighter here would crop the address step on a screen with room to show it, and the
 * frame scrolls internally on the rare occasion neither is enough.
 */
const MIN_PANEL_HEIGHT = 340;
const MAX_PANEL_HEIGHT = 920;

function clampHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return MIN_PANEL_HEIGHT;
  }

  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(height)));
}

const CLOSE_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;

export function openModal(options: ModalOptions): ModalHandle {
  const host = document.createElement('div');
  host.setAttribute('data-bitnormous-checkout', options.sessionId);
  if (options.theme && options.theme !== 'auto') {
    host.dataset['theme'] = options.theme;
  }

  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = MODAL_STYLES;

  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Secure checkout');

  const stage = document.createElement('div');
  stage.className = 'bn-stage';

  const panel = document.createElement('div');
  panel.className = 'bn-panel';

  const skeleton = document.createElement('div');
  skeleton.className = 'bn-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.innerHTML = `
    <div class="bn-bone bn-bone--brand"></div>
    <div class="bn-bone bn-bone--amount"></div>
    <div class="bn-bone bn-bone--row"></div>
    <div class="bn-bone bn-bone--row"></div>
    <div class="bn-bone bn-bone--row"></div>
  `;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bn-close';
  close.setAttribute('aria-label', 'Close checkout');
  close.innerHTML = CLOSE_ICON;

  let latest: ClientCheckoutSession | undefined;
  let destroyed = false;
  let frame: FrameHandle | undefined;

  const teardown = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;

    frame?.destroy();
    dialog.removeEventListener('cancel', onCancel);
    close.removeEventListener('click', onCloseClick);

    if (dialog.open) {
      dialog.close();
    }

    unlockScroll();
    host.remove();
  };

  const onCloseClick = () => {
    teardown();
    options.onDismiss();
  };

  const onCancel = (event: Event) => {
    // `<dialog>` closes itself on Escape; intercept so teardown runs exactly once, through the
    // same path as the close button.
    event.preventDefault();
    onCloseClick();
  };

  frame = createFrame({
    checkoutUrl: options.checkoutUrl,
    sessionId: options.sessionId,
    clientSecret: options.clientSecret,
    embedded: false,
    ...(options.theme !== undefined ? { theme: options.theme } : {}),
    ...(options.locale !== undefined ? { locale: options.locale } : {}),
    title: 'Bitnormous secure checkout',
    onMessage: (message) => {
      switch (message.type) {
        case 'ready':
          // The iframe's own `load` fires before the app paints; this is the moment the customer
          // actually has something to look at.
          skeleton.hidden = true;
          frame?.element.setAttribute('data-ready', 'true');
          frame?.post({
            type: 'init',
            embedded: false,
            ...(options.theme !== undefined ? { theme: options.theme } : {}),
            ...(options.locale !== undefined ? { locale: options.locale } : {}),
          });
          break;

        case 'resize':
          // Follow the content. Clamped so a mis-reported height can neither collapse the modal
          // nor grow it past the viewport.
          panel.style.setProperty('--bn-panel-height', `${clampHeight(message.height)}px`);
          break;

        case 'status':
        case 'success':
          latest = message.session;
          break;

        case 'close':
          latest = message.session ?? latest;
          teardown();
          break;
      }

      options.onMessage(message);
    },
  });

  panel.append(frame.element, skeleton, close);
  stage.append(panel);
  dialog.append(stage);
  root.append(style, dialog);
  document.body.append(host);

  dialog.addEventListener('cancel', onCancel);
  close.addEventListener('click', onCloseClick);

  lockScroll();
  dialog.showModal();

  return {
    close: teardown,
    session: () => latest,
  };
}

/**
 * Hold the page still behind the modal.
 *
 * Padding the body by the scrollbar's width stops the content behind from jumping sideways the
 * instant the overlay appears — a small thing that reads as "cheap" when it is missing.
 */
let scrollLocks = 0;
let previousOverflow = '';
let previousPadding = '';

function lockScroll(): void {
  if (scrollLocks++ > 0) {
    return;
  }

  const { body } = document;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;

  previousOverflow = body.style.overflow;
  previousPadding = body.style.paddingRight;

  body.style.overflow = 'hidden';
  if (scrollbar > 0) {
    const current = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + scrollbar}px`;
  }
}

function unlockScroll(): void {
  if (scrollLocks === 0 || --scrollLocks > 0) {
    return;
  }

  document.body.style.overflow = previousOverflow;
  document.body.style.paddingRight = previousPadding;
}
