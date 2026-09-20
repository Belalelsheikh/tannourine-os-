import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseCount, toAsciiDigits } from '../src/lib/numerals.ts';

test('toAsciiDigits converts both Arabic-Indic blocks', () => {
  assert.equal(toAsciiDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789'); // U+0660-0669
  assert.equal(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789'); // U+06F0-06F9
  assert.equal(toAsciiDigits('12'), '12');
  assert.equal(toAsciiDigits('مبلغ ٥٠'), 'مبلغ 50');
});

test('parseAmount reads ASCII amounts', () => {
  assert.equal(parseAmount('1250'), 1250);
  assert.equal(parseAmount('1250.5'), 1250.5);
  assert.equal(parseAmount(' 1250.50 '), 1250.5);
});

test('parseAmount reads Arabic-Indic amounts', () => {
  assert.equal(parseAmount('١٢٥٠'), 1250);
  assert.equal(parseAmount('۱۲۵۰'), 1250);
  assert.equal(parseAmount('١٢٥٠٫٥'), 1250.5); // ٫ decimal separator
  assert.equal(parseAmount('١٬٢٥٠٫٥٠'), 1250.5); // ٬ thousands + ٫ decimal
});

test('parseAmount drops a group separator only when the digits are grouped in threes', () => {
  assert.equal(parseAmount('1,250'), 1250);
  assert.equal(parseAmount('1,250.50'), 1250.5);
  assert.equal(parseAmount('12,345,678'), 12345678);
  assert.equal(parseAmount('١٬٢٥٠'), 1250);
  assert.equal(parseAmount('١،٢٥٠'), 1250); // ، Arabic comma
  // Ambiguous: a decimal comma on some layouts, so 1,5 must not become 15.
  assert.equal(parseAmount('1,5'), null);
  assert.equal(parseAmount('1,25'), null);
  assert.equal(parseAmount('1,2500'), null);
});

test('parseAmount rejects rather than salvaging', () => {
  assert.equal(parseAmount('12abc'), null); // parseFloat would have said 12
  assert.equal(parseAmount('١٢ ج'), null);
  assert.equal(parseAmount('1.2.3'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('   '), null);
  assert.equal(parseAmount('.'), null);
  assert.equal(parseAmount('abc'), null);
});

test('parseAmount keeps the loose forms parseFloat accepted', () => {
  assert.equal(parseAmount('1250.'), 1250);
  assert.equal(parseAmount('.5'), 0.5);
  assert.equal(parseAmount('٫٥'), 0.5);
});

test('parseAmount ignores bidi and zero-width marks', () => {
  assert.equal(parseAmount('‏1250‎'), 1250);
  assert.equal(parseAmount('⁦١٢٥٠⁩'), 1250);
  assert.equal(parseAmount('؜1250'), 1250);
});

test('parseCount keeps the digits a numeric keypad produced', () => {
  assert.equal(parseCount('12'), 12);
  assert.equal(parseCount('١٢'), 12);
  assert.equal(parseCount('۱۲'), 12);
  assert.equal(parseCount('1 2'), 12); // lenient where parseAmount is strict
  assert.equal(parseCount('12.5'), 125);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount('abc'), null);
  assert.equal(parseCount('0'), 0);
});
