import type en from '../en/phases';

// French messages for the "phases" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const phases: Record<keyof typeof en, string> = {
};

export default phases;
