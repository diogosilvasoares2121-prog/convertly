import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const FIXTURES = resolve('test-fixtures');

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

export function fixtureBlob(name: string, type = ''): Blob {
  return new Blob([fixture(name) as BlobPart], { type });
}
