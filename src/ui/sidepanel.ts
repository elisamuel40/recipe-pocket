/** Side panel entry: wires chrome.* into the reader controller. */
import { isTrustedSender } from '../shared/messages';
import { loadAndApplyPreferences } from './common/prefs';
import { mountReaderPanel, type PanelEnv } from './components/reader-panel';

const env: PanelEnv = {
  getWindowId: async () => (await chrome.windows.getCurrent()).id,
  getActiveTab: async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? { id: tab.id, url: tab.url } : undefined;
  },
  sendExtract: (req) => chrome.runtime.sendMessage(req),
  openPage: (path) => void chrome.tabs.create({ url: chrome.runtime.getURL(path) }),
  openOptions: () => void chrome.runtime.openOptionsPage(),
  focusTab: async (tabId) => {
    try {
      await chrome.tabs.update(tabId, { active: true });
      return true;
    } catch {
      return false;
    }
  },
  onMessage: (cb) => chrome.runtime.onMessage.addListener(cb),
  onTabActivated: (cb) => chrome.tabs.onActivated.addListener(cb),
  onTabUpdated: (cb) => chrome.tabs.onUpdated.addListener((tabId, change) => cb(tabId, change)),
  isTrustedSender,
  isPrintPageSender: (sender) =>
    isTrustedSender(sender) && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('ui/print.html')),
};

void (async () => {
  const root = document.getElementById('app');
  if (!root) return;
  const prefs = await loadAndApplyPreferences();
  await mountReaderPanel(root, env, prefs);
})();
