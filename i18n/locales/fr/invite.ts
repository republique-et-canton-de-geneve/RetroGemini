import type en from '../en/invite';

// French messages for the "invite" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const invite: Record<keyof typeof en, string> = {
};

export default invite;
