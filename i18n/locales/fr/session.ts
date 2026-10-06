import type en from '../en/session';

// French messages for the "session" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const session: Record<keyof typeof en, string> = {
};

export default session;
