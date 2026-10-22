import type { Page } from '@playwright/test';

/** Collects CSP violations the browser reports, from both channels. */
export const watchForViolations = (page: Page) => {
  const violations: string[] = [];

  // The DOM event fires for every blocked resource, with the directive.
  page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${event.violatedDirective} blocked ${event.blockedURI || '(inline)'}`,
      );
    });
  });

  // Console errors catch anything reported before the listener attaches.
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|connect|execute|apply)/i.test(text)) {
      violations.push(text);
    }
  });

  return async () => {
    const fromDom = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    );
    return [...violations, ...fromDom];
  };
};
