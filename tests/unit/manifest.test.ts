import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8')) as Record<string, unknown> & {
  permissions: string[];
  content_security_policy: { extension_pages: string };
};

describe('manifest policy', () => {
  it('is Manifest V3 with minimal permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(['downloads', 'storage']);
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('externally_connectable');
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|webRequest|"tabs"|nativeMessaging/);
  });

  it('CSP allows only local code and blocks network connections', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("connect-src 'self' blob: data:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:|\*/);
    const tokens = csp.split(/[\s;]+/);
    expect(tokens).not.toContain("'unsafe-eval'");
    expect(tokens).not.toContain("'unsafe-inline'");
  });

  it('has localized name/description within Web Store limits', () => {
    for (const locale of readdirSync('public/_locales')) {
      const m = JSON.parse(readFileSync(join('public/_locales', locale, 'messages.json'), 'utf8')) as Record<string, { message: string }>;
      expect(m.extName!.message.length, locale).toBeLessThanOrEqual(75);
      expect(m.extDescription!.message.length, locale).toBeLessThanOrEqual(132);
    }
  });
});
