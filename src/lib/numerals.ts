/**
 * Reading numbers out of text inputs.
 *
 * Egyptian Android keyboards emit Arabic-Indic (٠-٩) or extended Arabic-Indic (۰-۹)
 * digits, and an Arabic layout has its own decimal and grouping marks. JS `\d`,
 * `Number()` and `parseFloat()` are all ASCII-only, so an amount typed that way does not
 * fail loudly — it parses as NaN or truncates at the first foreign character, and the
 * field goes in empty or wrong. Every number read from a text input goes through here.
 */

/**
 * Bidi controls and zero-width marks. An Arabic keyboard leaves these around digits when
 * a field mixes scripts, and they are invisible in the input, so a value that looks
 * clean would otherwise fail to parse with nothing on screen to explain why.
 */
const MARKS = /[\u200B-\u200F\u061C\u2066-\u2069]/g;

/** Both Arabic-Indic blocks end in 0-9 in the low nibble, so one mask covers them. */
export const toAsciiDigits = (s: string) =>
  s.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));

/** No grouping: `12`, `12.5`, `12.`, `.5`. */
const PLAIN = /^(?:\d+\.?\d*|\.\d+)$/;
/** Grouped in threes: `1,250`, `1,250.50`. Deliberately strict — see `parseAmount`. */
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

/**
 * A money amount, or null if the text is not one.
 *
 * Null rather than a salvaged number: `parseFloat('12abc')` returns 12, which is how a
 * mistyped amount used to reach the database as a plausible wrong number. Callers already
 * have an «اكتب مبلغ صحيح» branch — null routes to it.
 *
 * A group separator is only dropped when the digits are actually grouped in threes, so
 * `1,250` is 1250 while `1,5` is rejected instead of silently becoming 15. Unsigned:
 * every amount in the system is a positive figure.
 */
export function parseAmount(raw: string): number | null {
  const s = toAsciiDigits(raw.replace(MARKS, '').trim())
    .replace(/\u066B/g, '.') // ٫ ARABIC DECIMAL SEPARATOR
    .replace(/\u066C/g, ',') // ٬ ARABIC THOUSANDS SEPARATOR
    .replace(/\u060C/g, ','); // ، ARABIC COMMA — grouping on some layouts
  if (!PLAIN.test(s) && !GROUPED.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * A whole count, or null if the text holds no digits.
 *
 * Lenient where `parseAmount` is strict: this backs the Stepper, whose field is a numeric
 * keypad that can pick up a stray separator or space between digits. Keeping the digits
 * is what the user meant; rejecting would blank a quantity mid-entry.
 */
export function parseCount(raw: string): number | null {
  const digits = toAsciiDigits(raw.replace(MARKS, '')).replace(/\D/g, '');
  return digits === '' ? null : Number(digits);
}
