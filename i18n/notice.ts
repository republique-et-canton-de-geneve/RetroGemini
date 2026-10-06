import { translateErrorMessage } from './errorMessages';
import type { MessageKey, TranslationParams, Translator } from './translate';

/**
 * A message kept in state while it is on screen — a validation error, a
 * "saved" confirmation. Store *what to say*, never the translated sentence:
 * the header's language switcher stays usable while the message is visible,
 * and a stored sentence would stay in the old language while the rest of the
 * screen changes. `raw` holds a data-layer error, translated on display.
 */
export type Notice = { key: MessageKey; params?: TranslationParams } | { raw: string } | null;

export const noticeText = (notice: Notice, t: Translator): string => {
  if (!notice) return '';
  return 'raw' in notice ? translateErrorMessage(notice.raw, t) : t(notice.key, notice.params);
};
