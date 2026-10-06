import type en from '../en/shared';

// French messages for the "shared" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const shared: Record<keyof typeof en, string> = {
};

export default shared;
