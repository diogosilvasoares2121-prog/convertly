import { test, expect, openTool, addFiles, waitForResult } from './fixtures';

/**
 * Memory-leak checks (spec §46): after repeated conversions and clearing results,
 * object URLs are revoked, idle workers are terminated and the JS heap returns
 * close to its baseline.
 */
test.describe.configure({ timeout: 300_000 });

test('no leaked object URLs, workers or heap after repeated conversions', async ({ app, extensionId, context }) => {
  // Instrument object URLs and workers before the app code runs.
  await context.addInitScript(() => {
    const w = window as unknown as { __urls: Set<string>; __workers: number };
    w.__urls = new Set();
    w.__workers = 0;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const u = create(obj);
      w.__urls.add(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      w.__urls.delete(u);
      revoke(u);
    };
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        w.__workers++;
      }
      override terminate() {
        w.__workers--;
        super.terminate();
      }
    } as typeof Worker;
  });
  await app.reload();
  const cdp = await context.newCDPSession(app);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const baseline = await heap();

  for (let i = 0; i < 6; i++) {
    await openTool(app, extensionId, 'image-convert');
    await addFiles(app, ['large.jpg', 'sample.heic', 'sample.png']);
    await app.getByRole('radio', { name: 'WEBP', exact: true }).click();
    await app.getByTestId('run').click();
    expect(await waitForResult(app)).toBe('completed');
    await app.getByRole('button', { name: 'Convert another' }).click();
    await openTool(app, extensionId, 'pdf-organize');
    await addFiles(app, ['sample10.pdf']);
    await expect(app.locator('.page-card img').first()).toBeVisible();
    await app.getByRole('button', { name: 'Clear all' }).click();
    await app.goto(`chrome-extension://${extensionId}/app/index.html#/`);
  }

  // Previews/thumbnails are revoked when their screens unmount.
  const liveUrls = await app.evaluate(() => (window as unknown as { __urls: Set<string> }).__urls.size);
  expect(liveUrls).toBeLessThanOrEqual(2);

  // Idle workers are terminated (image pool idles out after 30 s).
  await expect.poll(() => app.evaluate(() => (window as unknown as { __workers: number }).__workers), { timeout: 60_000, intervals: [2000] }).toBe(0);

  const after = await heap();
  console.log(`heap baseline ${(baseline / 1e6).toFixed(1)} MB → after ${(after / 1e6).toFixed(1)} MB`);
  expect(after - baseline).toBeLessThan(25 * 1024 * 1024);
});
