/**
 * Background service worker (Manifest V3).
 *
 * Deliberately minimal and stateless: Chrome may terminate it at any time.
 * All file processing happens in the app tab and its Web Workers; nothing here
 * touches file contents or the network.
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs.create({ url: chrome.runtime.getURL('app/index.html#/welcome') });
  }
});
