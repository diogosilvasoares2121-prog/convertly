/**
 * Tells a gzip-compressed tarball (.tar.gz / .tgz) from a single gzip-compressed file,
 * using the browser's native DecompressionStream on the first block only.
 */
export async function gzipContainsTar(file: Blob): Promise<boolean> {
  try {
    const reader = file.slice(0, 64 * 1024).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 512) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    void reader.cancel().catch(() => {});
    if (size < 262) return false;
    const head = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      head.set(c, offset);
      offset += c.length;
    }
    // POSIX/GNU tar headers carry "ustar" at offset 257.
    return String.fromCharCode(...head.subarray(257, 262)) === 'ustar';
  } catch {
    return false;
  }
}

/** Uncompressed size from the gzip trailer (ISIZE, modulo 4 GiB). */
export async function gzipOriginalSize(file: Blob): Promise<number> {
  if (file.size < 18) return 0;
  const tail = new DataView(await file.slice(file.size - 4).arrayBuffer());
  return tail.getUint32(0, true);
}
