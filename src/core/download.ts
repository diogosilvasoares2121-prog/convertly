import { settingsStore } from '../storage/settings';
import { sanitizeFilename, sanitizeRelativePath } from '../utils/filename';
import { createStore } from './store';

/**
 * Download engine. Results are handed to the browser's own download manager
 * (chrome.downloads when available, an <a download> fallback otherwise).
 * Object URLs are revoked as soon as the browser has finished reading them.
 */

/** Live object URLs created by this module (exposed for memory diagnostics/tests). */
export const objectUrlStats = { live: 0 };
export const lastDownloadStore = createStore<{ name: string; at: number } | null>(null);

function buildPath(name: string, subPath?: string): string {
  const folder = sanitizeRelativePath(settingsStore.get().downloadFolder);
  const inner = subPath ? sanitizeRelativePath(subPath) : '';
  const file = sanitizeFilename(name);
  return [folder, inner, file].filter(Boolean).join('/');
}

function hasDownloadsApi(): boolean {
  try {
    return typeof chrome !== 'undefined' && typeof chrome.downloads?.download === 'function';
  } catch {
    return false;
  }
}

function revokeLater(url: string, ms: number): void {
  setTimeout(() => {
    URL.revokeObjectURL(url);
    objectUrlStats.live--;
  }, ms);
}

/**
 * Saves a blob through the browser. `subPath` places it inside a folder under
 * Downloads (used when extracting archives).
 */
export async function downloadBlob(blob: Blob, name: string, subPath?: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  objectUrlStats.live++;
  const path = buildPath(name, subPath);
  lastDownloadStore.set({ name: path.split('/').pop() ?? name, at: Date.now() });

  if (!hasDownloadsApi()) {
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() ?? name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    revokeLater(url, 60_000);
    return;
  }

  let downloadId: number | undefined;
  try {
    downloadId = await chrome.downloads.download({
      url,
      filename: path,
      conflictAction: 'uniquify',
      saveAs: settingsStore.get().askWhereToSave,
    });
  } catch {
    // The user cancelled the "Save as" dialog, or the path was rejected: retry with a plain name.
    downloadId = undefined;
  }
  if (downloadId === undefined) {
    URL.revokeObjectURL(url);
    objectUrlStats.live--;
    return;
  }

  const id = downloadId;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    chrome.downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(url);
    objectUrlStats.live--;
  };
  const onChanged = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== id) return;
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') cleanup();
  };
  chrome.downloads.onChanged.addListener(onChanged);
  // Safety net: never keep the blob alive for longer than 10 minutes.
  setTimeout(cleanup, 10 * 60_000);
}

/** Downloads several files one after another (Chrome handles each in its download bar). */
export async function downloadMany(files: Array<{ blob: Blob; name: string; path?: string }>): Promise<void> {
  for (const f of files) {
    await downloadBlob(f.blob, f.name, f.path);
    await new Promise((r) => setTimeout(r, 120));
  }
}
