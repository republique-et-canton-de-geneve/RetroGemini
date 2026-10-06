import type en from '../en/healthCheck';

// French messages for the "healthCheck" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const healthCheck: Record<keyof typeof en, string> = {
};

export default healthCheck;
