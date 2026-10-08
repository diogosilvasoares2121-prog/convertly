import { test, expect } from './fixtures';

test('app loads offline with no console errors and no external requests', async ({ app, audit, extensionId }) => {
  await expect(app.getByText('Your private file toolbox.').first()).toBeVisible();
  await app.screenshot({ path: 'test-results/home.png', fullPage: true });
  await app.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(app.getByTestId('open-toolbox')).toBeVisible();
  expect(audit.consoleErrors).toEqual([]);
  expect(audit.external).toEqual([]);
});
