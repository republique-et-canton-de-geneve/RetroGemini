import { translateErrorMessage } from './errorMessages';
import { enT } from './translate';
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

/**
 * An error that carries what to say instead of a sentence, for code written as
 * `try { … throw … } catch { show it }`: the `throw` names the message, the
 * `catch` stores it as a `Notice`. Its `message` is the English text, so a log
 * line or a test reading `err.message` still gets a sentence.
 */
export class NoticeError extends Error {
  readonly notice: Exclude<Notice, null>;

  constructor(notice: Exclude<Notice, null>) {
    super('raw' in notice ? notice.raw : enT(notice.key, notice.params));
    this.name = 'NoticeError';
    this.notice = notice;
  }
}

/**
 * The notice for a caught error: the one a `NoticeError` names, else the
 * error's own message as raw text (a browser network error, say), else the
 * caller's fallback.
 */
export const noticeFromError = (err: unknown, fallback: Exclude<Notice, null>): Exclude<Notice, null> => {
  if (err instanceof NoticeError) return err.notice;
  if (err instanceof Error && err.message) return { raw: err.message };
  return fallback;
};
