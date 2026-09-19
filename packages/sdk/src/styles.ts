/**
 * The modal chrome, as a single stylesheet injected into a shadow root.
 *
 * Everything here styles the frame AROUND the checkout — backdrop, panel, close button, the
 * skeleton shown before the iframe paints. The checkout itself lives on its own origin and brings
 * its own styles; nothing in this file can reach it, and nothing in the merchant's stylesheet can
 * reach this.
 *
 * The palette comes straight off the Bitnormous mark — the amber of its upper lobe, the violet of
 * its lower one, and the near-black of the whale tail as ink. Nothing else is introduced: a modal
 * frame that invents its own colours is a modal frame that looks bolted on.
 */

export const MODAL_STYLES = /* css */ `
  :host {
    --bn-violet: #9e72ce;
    --bn-violet-deep: #532880;
    --bn-violet-shadow: 38, 16, 60;
    --bn-amber: #ea8e26;

    --bn-surface: #ffffff;
    --bn-surface-sunken: #f7f4fc;
    --bn-border: #e9e4f2;
    --bn-text: #242424;
    --bn-text-muted: #6d6579;

    --bn-radius: 20px;
    --bn-shadow: 0 32px 64px -12px rgba(38, 16, 60, 0.4), 0 0 0 1px rgba(38, 16, 60, 0.06);
    --bn-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --bn-duration: 260ms;

    all: initial;
    font-family: 'Instrument Sans', 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :host(:not([data-theme='light'])) {
      --bn-surface: #1d1629;
      --bn-surface-sunken: #261d36;
      --bn-border: #352a49;
      --bn-text: #f5f1fa;
      --bn-text-muted: #a79dba;
    }
  }

  :host([data-theme='dark']) {
    --bn-surface: #1d1629;
    --bn-surface-sunken: #261d36;
    --bn-border: #352a49;
    --bn-text: #f5f1fa;
    --bn-text-muted: #a79dba;
  }

  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--bn-text);
  }

  dialog::backdrop {
    /* The brand's deep violet rather than neutral black: the customer should feel they stepped
       into Bitnormous, not that the page dimmed. */
    /* Deep enough that the panel is unambiguously the foreground. At 0.64 over a light page this
       read as a flat lavender wash rather than a dimmed page. */
    background: rgba(24, 10, 38, 0.78);
    backdrop-filter: blur(8px) saturate(115%);
    -webkit-backdrop-filter: blur(8px) saturate(115%);
    animation: bn-fade var(--bn-duration) var(--bn-ease) both;
  }

  .bn-stage {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  }

  .bn-panel {
    position: relative;
    width: 100%;
    max-width: 440px;
    /* The checkout reports its own height and the panel follows, so a three-option picker does not
       sit in a column of empty white and the tall address step is never cut off. This is the
       starting height, held until the first resize message arrives. */
    height: var(--bn-panel-height, 560px);
    max-height: calc(100vh - 48px);
    transition: height 260ms var(--bn-ease);
    background: var(--bn-surface);
    border-radius: var(--bn-radius);
    box-shadow: var(--bn-shadow);
    overflow: hidden;
    animation: bn-rise var(--bn-duration) var(--bn-ease) both;
  }

  .bn-frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    opacity: 0;
    transition: opacity 200ms var(--bn-ease);
  }

  .bn-frame[data-ready='true'] { opacity: 1; }

  .bn-close {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 2;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 999px;
    background: var(--bn-surface-sunken);
    color: var(--bn-text-muted);
    cursor: pointer;
    transition: background 160ms var(--bn-ease), color 160ms var(--bn-ease), transform 160ms var(--bn-ease);
  }

  .bn-close:hover { background: var(--bn-border); color: var(--bn-text); }
  .bn-close:active { transform: scale(0.94); }
  .bn-close:focus-visible {
    outline: 2px solid var(--bn-amber);
    outline-offset: 2px;
  }

  .bn-close svg { width: 15px; height: 15px; }

  /* Shown until the frame reports ready. A shaped skeleton rather than a spinner: it tells the
     customer what is about to appear, so the checkout feels like it is loading, not hanging. */
  .bn-skeleton {
    position: absolute;
    inset: 0;
    padding: 32px 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--bn-surface);
  }

  .bn-skeleton[hidden] { display: none; }

  .bn-bone {
    border-radius: 10px;
    background: linear-gradient(
      100deg,
      var(--bn-surface-sunken) 30%,
      color-mix(in srgb, var(--bn-surface-sunken) 60%, var(--bn-border)) 50%,
      var(--bn-surface-sunken) 70%
    );
    background-size: 220% 100%;
    animation: bn-shimmer 1.4s linear infinite;
  }

  .bn-bone--brand { height: 28px; width: 42%; }
  .bn-bone--amount { height: 46px; width: 62%; margin-top: 6px; }
  .bn-bone--row { height: 62px; }
  .bn-bone--row:nth-of-type(4) { opacity: 0.72; }
  .bn-bone--row:nth-of-type(5) { opacity: 0.44; }

  @keyframes bn-fade { from { opacity: 0; } to { opacity: 1; } }

  @keyframes bn-rise {
    from { opacity: 0; transform: translateY(14px) scale(0.985); }
    to { opacity: 1; transform: none; }
  }

  @keyframes bn-shimmer {
    from { background-position: 180% 0; }
    to { background-position: -20% 0; }
  }

  /* Phones get a sheet, not a shrunken dialog: it starts at the thumb and the customer's hand is
     already where the primary action will be. */
  @media (max-width: 560px) {
    .bn-stage { padding: 0; align-items: flex-end; }

    .bn-panel {
      max-width: none;
      /* A sheet sizes to its content too, but never past the viewport, and never so short that it
         stops reading as a sheet. */
      height: clamp(340px, var(--bn-panel-height, 560px), calc(100vh - env(safe-area-inset-top) - 24px));
      border-radius: 22px 22px 0 0;
      animation-name: bn-sheet;
    }
  }

  @keyframes bn-sheet {
    from { transform: translateY(100%); }
    to { transform: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    dialog::backdrop,
    .bn-panel,
    .bn-bone {
      animation: none;
    }
    .bn-frame,
    .bn-panel {
      transition: none;
    }
  }
`;

/** The frame around an embedded (inline) checkout. No backdrop, no panel — the host page owns those. */
export const EMBED_STYLES = /* css */ `
  :host {
    display: block;
    width: 100%;
  }

  iframe {
    display: block;
    width: 100%;
    border: 0;
    /* Until the checkout reports its real height, reserve a plausible one so the host page does
       not visibly reflow the moment it loads. */
    height: 560px;
    transition: height 220ms cubic-bezier(0.22, 1, 0.36, 1);
    color-scheme: normal;
  }

  @media (prefers-reduced-motion: reduce) {
    iframe { transition: none; }
  }
`;
