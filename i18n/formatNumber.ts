/**
 * Swaps the decimal mark of a number the caller already formatted the English
 * way ("3.5", from `toFixed` or `String`) for the reader's own ("3,5" in fr-CH).
 * The digits and the rounding stay exactly what the caller produced, so the
 * English output is unchanged byte for byte — `toLocaleString` would not give
 * that guarantee (grouping, rounding mode, minimum fraction digits).
 *
 * One helper for every score on screen (ROTI, action impact, health check
 * averages), so a French reader never sees "3,5" on one screen and "3.5" on
 * the next.
 */
export const localizeDecimal = (formatted: string, locale: string): string => {
  const decimal = new Intl.NumberFormat(locale)
    .formatToParts(1.5)
    .find(part => part.type === 'decimal')?.value ?? '.';
  return formatted.replace('.', decimal);
};
