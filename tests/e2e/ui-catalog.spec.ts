import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { TOOLS } from '../../src/registry/tools';
import { CATEGORIES } from '../../src/registry/formats';

test.describe.configure({ timeout: 600_000 });

test.afterEach(({ audit }) => {
  expect(audit.external).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
});

async function setLanguage(app: Page, language: 'en' | 'pt'): Promise<void> {
  await app.evaluate(async (lang) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings as object), language: lang } });
  }, language);
  await app.reload();
}

/** Opens every tool (generic, pair and search-only shortcut) and checks it renders cleanly. */
async function visitAll(app: Page, extensionId: string): Promise<string[]> {
  const problems: string[] = [];
  for (const tool of TOOLS) {
    await app.goto(`chrome-extension://${extensionId}/app/index.html#/tool/${tool.id}`);
    const h1 = app.locator('.tool-header h1');
    await expect(h1, tool.id).toBeVisible();
    try {
      await app.locator('main [data-testid=dropzone], main [data-testid=data-input], main .tool-layout, main .notice').first().waitFor({ timeout: 15_000 });
    } catch {
      problems.push(`${tool.id}: tool UI did not render`);
      continue;
    }
    const text = await app.locator('main').innerText();
    // A missing translation would show its raw key (e.g. "tool.foo.title" or "svg.runN_one").
    const raw = text.match(/\b(tool|pair|svg|ico|watermark|adjust|combine|split|motion|pdf[A-Za-z]*|pageNum|frames|speed|merge|addAudio|volume|fade|archive|xlsx|hash|data|zip|nav|group)\.[a-zA-Z_.-]+\b/g);
    if (raw) problems.push(`${tool.id}: ${raw.join(', ')}`);
    if (/\{[a-z]+\}/.test(text)) problems.push(`${tool.id}: unreplaced placeholder`);
  }
  return problems;
}

test('every tool renders in English without errors or missing strings', async ({ app, extensionId }) => {
  expect(TOOLS.length).toBeGreaterThan(140);
  expect(await visitAll(app, extensionId)).toEqual([]);
});

test('every tool renders in Portuguese without errors or missing strings', async ({ app, extensionId }) => {
  await setLanguage(app, 'pt');
  await expect(app.getByRole('heading', { level: 1 })).toContainText('Convertly');
  expect(await visitAll(app, extensionId)).toEqual([]);
  await app.goto(`chrome-extension://${extensionId}/app/index.html#/tool/pdf-watermark`);
  await expect(app.locator('.tool-header h1')).toHaveText("Marca d'água em PDF");
});

test('"All tools" page: grouped sections, counts and instant filter', async ({ app, extensionId }) => {
  await app.getByTestId('browse-all').click();
  await expect(app).toHaveURL(/#\/tools$/);
  for (const c of CATEGORIES) await expect(app.getByTestId(`all-${c}`)).toBeVisible();
  const listed = TOOLS.filter((t) => !t.pair && !t.hidden).length;
  await expect(app.locator('.category-block .tool-card')).toHaveCount(listed);
  await expect(app.getByTestId('nav-all-tools')).toContainText(String(listed));
  await app.getByTestId('tools-filter').fill('rar');
  await expect(app.getByTestId('tools-results')).toContainText('Extract RAR');
  await app.getByTestId('tools-filter').fill('watermark');
  await expect(app.getByTestId('tools-results').locator('.tool-card').first()).toBeVisible();
  await app.getByTestId('tools-filter').fill('zzqqxx');
  await expect(app.getByText('No tools match')).toBeVisible();

  await app.goto(`chrome-extension://${extensionId}/app/index.html#/category/pdf`);
  await expect(app.locator('.tool-section__title')).toContainText(['Convert', 'Optimize', 'Edit', 'Organize']);
});

const A11Y_PAGES = ['#/', '#/tools', '#/category/image', '#/tool/image-watermark', '#/tool/pdf-page-numbers', '#/tool/archive-extract', '#/tool/xlsx-convert', '#/tool/file-hash', '#/settings', '#/privacy'];

test('accessibility (axe): no serious or critical violations', async ({ app, extensionId }) => {
  const report: string[] = [];
  for (const hash of A11Y_PAGES) {
    await app.goto(`chrome-extension://${extensionId}/app/index.html${hash}`);
    await app.locator('main').first().waitFor();
    await app.waitForTimeout(300);
    const result = await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of result.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
      report.push(`${hash} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
    }
  }
  expect(report).toEqual([]);
});
