import { expect, test as base } from '@playwright/test';

/**
 * Every end-to-end test fails on an error the page did not handle: an
 * unhandled rejection is a defect even when the screen shows the error
 * (one did, in the people form, until the suite caught it).
 */
export const test = base.extend<{ pageErrors: Error[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: Error[] = [];
      page.on('pageerror', (error) => errors.push(error));
      await use(errors);
      expect(errors.map((e) => e.message)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
