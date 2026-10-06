import type en from '../en/dashboard';

// French messages for the "dashboard" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const dashboard: Record<keyof typeof en, string> = {
};

export default dashboard;
