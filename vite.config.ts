import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; repository?: { url?: string } };

/**
 * Copies large third-party runtime assets (FFmpeg core, PDF.js data files) into
 * `dist/vendor`. They are loaded at runtime from the extension origin only —
 * never from a CDN. Files are copied only when missing or changed so that
 * `npm run dev` (watch mode) stays fast.
 */
function vendorAssets(): Plugin {
  const copies: Array<[from: string, to: string]> = [
    ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'vendor/ffmpeg/ffmpeg-core.js'],
    ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'vendor/ffmpeg/ffmpeg-core.wasm'],
    ['node_modules/pdfjs-dist/cmaps', 'vendor/pdfjs/cmaps'],
    ['node_modules/pdfjs-dist/standard_fonts', 'vendor/pdfjs/standard_fonts'],
    ['node_modules/pdfjs-dist/iccs', 'vendor/pdfjs/iccs'],
    ['node_modules/pdfjs-dist/wasm/openjpeg.wasm', 'vendor/pdfjs/wasm/openjpeg.wasm'],
    ['node_modules/pdfjs-dist/wasm/jbig2.wasm', 'vendor/pdfjs/wasm/jbig2.wasm'],
    ['node_modules/pdfjs-dist/wasm/qcms_bg.wasm', 'vendor/pdfjs/wasm/qcms_bg.wasm'],
    ['node_modules/libarchive.js/dist/worker-bundle.js', 'vendor/libarchive/worker-bundle.js'],
    ['node_modules/libarchive.js/dist/libarchive.wasm', 'vendor/libarchive/libarchive.wasm'],
    ['THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_LICENSES.txt'],
  ];
  const same = (a: string, b: string): boolean => {
    if (!existsSync(b)) return false;
    const sa = statSync(a);
    const sb = statSync(b);
    if (sa.isDirectory()) {
      return readdirSync(a).every((f) => same(join(a, f), join(b, f)));
    }
    return sa.size === sb.size && sb.mtimeMs >= sa.mtimeMs;
  };
  return {
    name: 'convertly-vendor-assets',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? resolve(root, 'dist');
      for (const [from, to] of copies) {
        const src = resolve(root, from);
        const dest = resolve(outDir, to);
        if (!existsSync(src)) throw new Error(`Missing vendor asset: ${from}`);
        if (same(src, dest)) continue;
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true, preserveTimestamps: true });
      }
    },
  };
}

/** Writes the final manifest.json with the version taken from package.json. */
/**
 * libarchive.js references its worker with `new URL('./worker-bundle.js', import.meta.url)`, which
 * makes Vite emit a second, unused copy. Convertly always passes its own `getWorker`
 * (vendor/libarchive/worker.js), so the default is pointed at that file instead.
 */
function libarchiveWorkerUrl(): Plugin {
  return {
    name: 'convertly-libarchive-worker-url',
    enforce: 'pre',
    transform(code, id) {
      if (!/libarchive\.js[\\/]dist[\\/]libarchive\.js$/.test(id)) return null;
      const target = 'new URL("./worker-bundle.js",import.meta.url)';
      if (!code.includes(target)) throw new Error('libarchive.js worker reference not found (library updated?)');
      return { code: code.replace(target, '"/vendor/libarchive/worker.js"'), map: null };
    },
  };
}

function manifest(): Plugin {
  return {
    name: 'convertly-manifest',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? resolve(root, 'dist');
      const src = JSON.parse(readFileSync(resolve(root, 'src/manifest.json'), 'utf8')) as Record<string, unknown>;
      src.version = pkg.version;
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(src, null, 2) + '\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const dev = mode === 'development';
  return {
    root: resolve(root, 'src'),
    publicDir: resolve(root, 'public'),
    base: '/',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // GPL: the app links to its Corresponding Source (public repository).
      __APP_SOURCE_URL__: JSON.stringify(String(pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')),
    },
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'preact' },
    },
    build: {
      outDir: resolve(root, 'dist'),
      emptyOutDir: !dev,
      target: 'chrome120',
      sourcemap: dev ? 'inline' : false,
      minify: !dev,
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      reportCompressedSize: false,
      chunkSizeWarningLimit: 4096,
      rolldownOptions: {
        input: {
          app: resolve(root, 'src/app/index.html'),
          popup: resolve(root, 'src/popup/index.html'),
          background: resolve(root, 'src/background/service-worker.ts'),
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
          chunkFileNames: 'assets/[name]-[hash].js',
          // Chrome serves `.mjs` correctly, but `.js` is the safest choice for module workers.
          assetFileNames: (asset) => {
            const name = asset.names[0] ?? '';
            return name.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    worker: {
      format: 'es',
      rolldownOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
    plugins: [libarchiveWorkerUrl(), vendorAssets(), manifest()],
  };
});
