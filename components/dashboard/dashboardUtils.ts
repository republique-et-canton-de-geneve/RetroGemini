export const isDateLike = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/(\d{1,4})([-./\s])(\d{1,4})\2(\d{2,4})$/);
  if (!match) return false;

  const parts = [match[1], match[3], match[4]];
  const hasYearLikePart = parts.some((part) => part.length === 4 || parseInt(part, 10) > 31);

  return hasYearLikePart;
};

export const getSuggestedName = (lastName: string | undefined, fallback: string) => {
  if (lastName && !isDateLike(lastName)) {
    const match = lastName.match(/^(.*?)(\d+)$/);
    if (match) {
      return `${match[1]}${parseInt(match[2]) + 1}`;
    }
  }

  return fallback;
};

/**
 * Swaps the decimal mark of a number the caller already formatted the English
 * way ("3.5", from `toFixed` or `String`) for the reader's own ("3,5" in fr-CH).
 * The digits and the rounding stay exactly what the caller produced, so the
 * English output is unchanged byte for byte — `toLocaleString` would not give
 * that guarantee (grouping, rounding mode, minimum fraction digits).
 */
export const localizeDecimal = (formatted: string, locale: string): string => {
  const decimal = new Intl.NumberFormat(locale)
    .formatToParts(1.5)
    .find((part) => part.type === 'decimal')?.value ?? '.';
  return formatted.replace('.', decimal);
};
