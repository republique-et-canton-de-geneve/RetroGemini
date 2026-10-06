import type en from '../en/feedback';

// French messages for the "feedback" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const feedback: Record<keyof typeof en, string> = {
};

export default feedback;
