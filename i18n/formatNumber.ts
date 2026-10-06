/**
 * Swaps the decimal mark of a number the caller already formatted the English
 * way ("3.5", from `toFixed` or `String`) for the reader's own ("3,5" in fr-CH).
 * The digits and the rounding stay exactly what the caller produced —
 * `toLocaleString` would not give that guarantee (grouping, rounding mode,
 * minimum fraction digits). Only the mark follows the locale, so a reader whose
 * regional English uses a comma (en-ZA) reads "3,5" too, deliberately: numbers
 * and dates follow the reader's regional settings, see AGENTS.md.
 *
 * One helper for every score on screen (ROTI, action impact, health check
 * averages), so a French reader never sees "3,5" on one screen and "3.5" on
 * the next.
 */
const decimalMarks = new Map<string, string>();

// Building an Intl.NumberFormat costs tens of microseconds and the helper runs
// once per heatmap cell and per rated action on every render; the mark only
// depends on the locale, so it is looked up once per locale.
const decimalMarkFor = (locale: string): string => {
  let mark = decimalMarks.get(locale);
  if (mark === undefined) {
    mark = new Intl.NumberFormat(locale).formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';
    decimalMarks.set(locale, mark);
  }
  return mark;
};

export const localizeDecimal = (formatted: string, locale: string): string =>
  formatted.replace('.', decimalMarkFor(locale));
