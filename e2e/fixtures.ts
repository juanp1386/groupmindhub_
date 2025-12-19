import { expect, test as base } from '@playwright/test';

import { ensureLoggedIn } from './utils';

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    await ensureLoggedIn(page);
    await use(page);
  },
});
