#!/usr/bin/env node
/**
 * Renders the Convertly mark to PNG icons with headless Chromium (Playwright).
 * Outputs:
 *   public/icons/icon-{16,32,48,128}.png   (manifest / toolbar)
 *   store/icon-128.png                    (Web Store: 96 px artwork + 16 px transparent padding)
 *   store/promo-small-440x280.png         (Web Store small promo tile)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function mark(size, { padding = 0, dot = true } = {}) {
  const inner = size - padding * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fc9b5"/><stop offset="1" stop-color="#0a7a70"/></linearGradient></defs>
  <g transform="translate(${padding} ${padding}) scale(${inner / 32})">
    <rect width="32" height="32" rx="9" fill="url(#g)"/>
    <path d="M22.4 11.6A7.6 7.6 0 1 0 23.3 20" fill="none" stroke="#fff" stroke-width="${size <= 16 ? 3.4 : 2.7}" stroke-linecap="round"/>
    <path d="M18.3 10.3l4.4.9-.9 4.4" fill="none" stroke="#fff" stroke-width="${size <= 16 ? 3.4 : 2.7}" stroke-linecap="round" stroke-linejoin="round"/>
    ${dot ? '<circle cx="16" cy="16" r="2.3" fill="#fff"/>' : ''}
  </g></svg>`;
}

function promo() {
  return `<div style="width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:22px;
    background:radial-gradient(600px 300px at 80% 0%,#c9f5ec,transparent 60%),#f5f7f9;font-family:'Segoe UI',system-ui,sans-serif">
    ${mark(96, { padding: 0 })}
    <div><div style="font-size:40px;font-weight:800;letter-spacing:-0.03em;color:#0e1520">Convertly</div>
    <div style="font-size:17px;color:#4a5466;margin-top:4px">Private file conversion</div>
    <div style="font-size:14px;color:#0b8378;font-weight:700;margin-top:12px">Files never leave your device</div></div></div>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(html, width, height, file) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  const buffer = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buffer);
  console.log('icon:', file.replace(root, '.'));
}

for (const size of [16, 32, 48, 128]) {
  await render(mark(size, { padding: size === 128 ? 8 : 0, dot: size > 16 }), size, size, join(root, 'public/icons', `icon-${size}.png`));
}
await render(mark(128, { padding: 16 }), 128, 128, join(root, 'store/icon-128.png'));
await render(promo(), 440, 280, join(root, 'store/promo-small-440x280.png'));
await browser.close();
