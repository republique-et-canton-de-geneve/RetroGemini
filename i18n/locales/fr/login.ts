import type en from '../en/login';

// French messages for the "login" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const login: Record<keyof typeof en, string> = {
};

export default login;
