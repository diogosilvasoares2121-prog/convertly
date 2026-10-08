/**
 * Streaming MD5, SHA-1 and SHA-256 (pure TypeScript) so files of any size can be
 * hashed chunk by chunk without loading them fully into memory.
 */
export type HashAlgorithm = 'md5' | 'sha1' | 'sha256';

interface Hasher {
  update(data: Uint8Array): void;
  digest(): string;
}

const hex = (words: number[], littleEndian: boolean) =>
  words
    .map((w) => {
      const v = littleEndian ? ((w & 0xff) << 24) | ((w & 0xff00) << 8) | ((w >>> 8) & 0xff00) | ((w >>> 24) & 0xff) : w;
      return (v >>> 0).toString(16).padStart(8, '0');
    })
    .join('');

/** Shared 64-byte block buffering + Merkle–Damgård padding. */
abstract class BlockHasher implements Hasher {
  protected buffer = new Uint8Array(64);
  protected bufferLength = 0;
  protected bytes = 0;
  protected abstract block(view: DataView, offset: number): void;
  protected abstract littleEndian: boolean;
  protected abstract words(): number[];

  update(data: Uint8Array): void {
    this.bytes += data.length;
    let i = 0;
    if (this.bufferLength) {
      const take = Math.min(64 - this.bufferLength, data.length);
      this.buffer.set(data.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      i = take;
      if (this.bufferLength === 64) {
        this.block(new DataView(this.buffer.buffer), 0);
        this.bufferLength = 0;
      }
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (; i + 64 <= data.length; i += 64) this.block(view, i);
    if (i < data.length) {
      this.buffer.set(data.subarray(i), 0);
      this.bufferLength = data.length - i;
    }
  }

  digest(): string {
    const bits = this.bytes * 8;
    const padLength = this.bufferLength < 56 ? 56 - this.bufferLength : 120 - this.bufferLength;
    const tail = new Uint8Array(padLength + 8);
    tail[0] = 0x80;
    const dv = new DataView(tail.buffer);
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits >>> 0;
    if (this.littleEndian) {
      dv.setUint32(padLength, lo, true);
      dv.setUint32(padLength + 4, hi, true);
    } else {
      dv.setUint32(padLength, hi, false);
      dv.setUint32(padLength + 4, lo, false);
    }
    const saved = this.bytes;
    this.update(tail);
    this.bytes = saved;
    return hex(this.words(), this.littleEndian);
  }
}

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

class Md5 extends BlockHasher {
  protected littleEndian = true;
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  protected words() {
    return this.h;
  }
  protected block(view: DataView, offset: number): void {
    const m = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
    let [a, b, c, d] = this.h as [number, number, number, number];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[i]! + m[g]!) | 0;
      b = (b + ((sum << MD5_S[i]!) | (sum >>> (32 - MD5_S[i]!)))) | 0;
      a = tmp;
    }
    this.h = [(this.h[0]! + a) | 0, (this.h[1]! + b) | 0, (this.h[2]! + c) | 0, (this.h[3]! + d) | 0];
  }
}

class Sha1 extends BlockHasher {
  protected littleEndian = false;
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  private w = new Int32Array(80);
  protected words() {
    return this.h;
  }
  protected block(view: DataView, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let [a, b, c, d, e] = this.h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    this.h = [(this.h[0]! + a) | 0, (this.h[1]! + b) | 0, (this.h[2]! + c) | 0, (this.h[3]! + d) | 0, (this.h[4]! + e) | 0];
  }
}

const SHA256_K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256 extends BlockHasher {
  protected littleEndian = false;
  private h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  private w = new Int32Array(64);
  protected words() {
    return this.h;
  }
  protected block(view: DataView, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const s = this.h;
    this.h = [(s[0]! + a) | 0, (s[1]! + b) | 0, (s[2]! + c) | 0, (s[3]! + d) | 0, (s[4]! + e) | 0, (s[5]! + f) | 0, (s[6]! + g) | 0, (s[7]! + h) | 0];
  }
}

export function createHasher(algorithm: HashAlgorithm): Hasher {
  return algorithm === 'md5' ? new Md5() : algorithm === 'sha1' ? new Sha1() : new Sha256();
}

export function hashBytes(data: Uint8Array, algorithm: HashAlgorithm): string {
  const h = createHasher(algorithm);
  h.update(data);
  return h.digest();
}

/** Hashes a Blob in streaming fashion with several algorithms at once. */
export async function hashBlob(blob: Blob, algorithms: HashAlgorithm[], onProgress?: (p: number) => void): Promise<Record<HashAlgorithm, string>> {
  const hashers = algorithms.map((a) => [a, createHasher(a)] as const);
  const reader = blob.stream().getReader();
  let done = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    for (const [, h] of hashers) h.update(value);
    done += value.length;
    onProgress?.(blob.size ? done / blob.size : 1);
  }
  return Object.fromEntries(hashers.map(([a, h]) => [a, h.digest()])) as Record<HashAlgorithm, string>;
}
