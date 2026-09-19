import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatAmount, formatCrypto, trimTrailingZeros, paymentProgress, secondsUntil, formatDuration } from '../dist/index.js';

describe('money', () => {
  test('formats fiat with the right symbol and two decimals', () => {
    assert.equal(formatAmount('125.00', 'USD', 'en-US'), '$125.00');
    assert.equal(formatAmount('125.5', 'USD', 'en-US'), '$125.50');
  });

  test('renders an unfamiliar but well-formed ISO code rather than failing', () => {
    // Intl handles any 3-letter code by falling back to the code itself as the symbol.
    const rendered = formatAmount('125.00', 'XYZ', 'en-US');
    assert.match(rendered, /XYZ/);
    assert.match(rendered, /125\.00/);
  });

  test('falls back by hand when Intl rejects the code outright', () => {
    // A code that is not three letters makes Intl throw; the customer still sees their money.
    assert.equal(formatAmount('125.00', 'US'), '125 US');
  });

  test('never renders NaN at a customer', () => {
    assert.equal(formatAmount('not-a-number', 'USD'), 'not-a-number USD');
  });

  test('trims chain padding down to the digits that carry value', () => {
    assert.equal(trimTrailingZeros('10.00000000'), '10');
    assert.equal(trimTrailingZeros('0.00042100'), '0.000421');
    assert.equal(trimTrailingZeros('0.00000000'), '0');
    assert.equal(trimTrailingZeros('125'), '125');
    assert.equal(formatCrypto('10.00000000', 'usdt'), '10 USDT');
  });

  test('reports partial payment progress, clamped', () => {
    assert.equal(paymentProgress('0.00000000', '10.00000000'), 0);
    assert.equal(paymentProgress('4.00000000', '10.00000000'), 0.4);
    assert.equal(paymentProgress('12.00000000', '10.00000000'), 1);
    assert.equal(paymentProgress('1', '0'), 0);
  });

  test('counts down to an expiry without going negative', () => {
    const now = Date.parse('2026-09-18T10:30:00Z');
    assert.equal(secondsUntil('2026-09-18T10:45:00Z', now), 900);
    assert.equal(secondsUntil('2026-09-18T10:00:00Z', now), 0);
    assert.equal(secondsUntil('nonsense', now), 0);
  });

  test('formats a countdown the way a clock reads', () => {
    assert.equal(formatDuration(903), '15:03');
    assert.equal(formatDuration(60), '1:00');
    assert.equal(formatDuration(-5), '0:00');
  });
});
