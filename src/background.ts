import { colors, getLogger } from './utils/log';


const lg = getLogger('background', colors.green)

lg.log('background.ts')

interface OpenLinkInSplitViewMessage {
  type: 'open-link-in-split-view'
  url: string
}

interface SplitViewTab extends chrome.tabs.Tab {
  splitViewId?: number
}

chrome.runtime.onMessage.addListener((message: OpenLinkInSplitViewMessage, sender, sendResponse) => {
  if (message.type !== 'open-link-in-split-view') {
    return
  }

  openLinkInSplitView(message.url, sender.tab)
    .then((mode) => sendResponse({ ok: true, mode }))
    .catch((error) => {
      console.error('failed to open link in split view', error)
      sendResponse({ ok: false, error: String(error) })
    })

  return true
})

async function openLinkInSplitView(url: string, sourceTab?: chrome.tabs.Tab): Promise<'split-view' | 'new-tab'> {
  const tab = sourceTab?.id ? await chrome.tabs.get(sourceTab.id) as SplitViewTab : sourceTab as SplitViewTab|undefined
  const splitViewId = tab?.splitViewId

  if (tab?.id && tab.windowId && typeof splitViewId === 'number' && splitViewId !== -1) {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId }) as SplitViewTab[]
    const splitTabs = tabs
      .filter((candidate) => candidate.id !== tab.id && candidate.splitViewId === splitViewId)
      .sort((a, b) => a.index - b.index)
    const targetTab = splitTabs.find((candidate) => candidate.index > tab.index) || splitTabs[0]

    if (targetTab?.id) {
      await chrome.tabs.update(targetTab.id, { url, active: true })
      return 'split-view'
    }
  }

  const createProperties: chrome.tabs.CreateProperties = { url, active: true }
  if (tab?.id) createProperties.openerTabId = tab.id
  if (tab?.windowId) createProperties.windowId = tab.windowId
  await chrome.tabs.create(createProperties)
  return 'new-tab'
}
