/**
 * Opens the Convertly app tab, reusing an existing one when possible.
 * Uses chrome.runtime.getContexts (no "tabs" permission needed) to find our own tab.
 */
export async function openApp(hash = ''): Promise<void> {
  const base = chrome.runtime.getURL('app/index.html');
  const url = hash ? `${base}${hash.startsWith('#') ? hash : `#${hash}`}` : base;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
    const existing = contexts.find((c) => c.documentUrl?.startsWith(base) && c.tabId !== undefined && c.tabId >= 0);
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true, ...(hash ? { url } : {}) });
      if (existing.windowId !== undefined && existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    /* getContexts unavailable: fall back to a new tab */
  }
  await chrome.tabs.create({ url });
}
