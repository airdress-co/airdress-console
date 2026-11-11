import { expect, test as base } from '@playwright/test';

/**
 * Every end-to-end test fails on an error the page did not handle: an
 * unhandled rejection is a defect even when the screen shows the error
 * (one did, in the people form, until the suite caught it).
 */
export const test = base.extend<{ pageErrors: Error[] }>({
  pageErrors: [
    async ({ page, browserName }, use) => {
      const errors: Error[] = [];
      page.on('pageerror', (error) => errors.push(error));
      // A refusal by the content security policy (a blocked request, a
      // Trusted Types sink) can be swallowed by the app; the browser still
      // says it on the console, and that fails the test too.
      page.on('console', (message) => {
        const text = message.text();
        // WebKit's own <select> asks for an inline stylesheet, and style-src
        // 'self' refuses it: a bare page with one <select> and nothing of
        // ours says the same (measured 2026-11-11, Playwright WebKit). The
        // select still works; it is the browser's, not a defect here.
        const webkitSelect =
          browserName === 'webkit' && text.startsWith('Refused to apply a stylesheet');
        if (
          !webkitSelect &&
          /Content Security Policy|Content-Security-Policy|TrustedHTML|Trusted Type/i.test(text)
        ) {
          const at = message.location();
          errors.push(
            new Error(
              `policy: ${text} (at ${at.url}:${String(at.lineNumber)}; page ${page.url()})`,
            ),
          );
        }
      });
      await use(errors);
      expect(errors.map((e) => e.message)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
