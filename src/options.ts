import './options.scss';

import $ from 'cash-dom';

import { defaultSettings, loadSettings, Settings } from './settings';

const bilifocusDefaults: Record<string, boolean> = {
  vidrecom: true,
  comments: true,
  leftnavi: true,
  searchrecom: true,
  membership: true,
  messages: true,
  dongtai: true,
  favourites: true,
  history: true,
  tougao: true,
  ads: true,
  myvideos: true,
  myfavourites: true,
  subanimes: true,
  recentcoins: true,
  recentlikes: true,
  collections: true,
  columns: true,
  usrpageleftsidebar: true,
}

const store: {settings: Settings} = {
  settings: {...defaultSettings},
}

const $autoFocus = $('#v-auto-focus')
$autoFocus.on('change', () => {
  store.settings.autoFocusSearchBar = $autoFocus.prop('checked')
})

const $autoLoadVideoColumn = $('#v-auto-load-video-column')
$autoLoadVideoColumn.on('change', () => {
  store.settings.autoLoadVideoColumn = $autoLoadVideoColumn.prop('checked')
})

const $blockedWords = $('#v-blocked-words')
$blockedWords.on('change', () => {
  store.settings.blockedWords = $blockedWords.val() as string
})


$('#fn-save').on('click', () => {
  chrome.storage.sync.set({
    settings: store.settings,
  })
})

const $slashFocus = $('#v-slashfocus')
$slashFocus.on('change', () => {
  chrome.storage.local.set({ slashfocus: $slashFocus.prop('checked') })
})

function getBilifocusInput(key: string) {
  return $(`#bf-${key}`)
}

function getBilifocusFalseCount() {
  return Object.keys(bilifocusDefaults).filter((key) => !getBilifocusInput(key).prop('checked')).length
}

function updateBilifocusToggleText() {
  $('#fn-bilifocus-toggle').text(getBilifocusFalseCount() === 0 ? 'Show all' : 'Hide all')
}

function broadcastBilifocusUpdate(key: string, value: boolean) {
  chrome.tabs.query({ url: ['*://*.bilibili.com/*'] }, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id) return
      chrome.tabs.sendMessage(tab.id, {
        action: 'updateCheckbox',
        field: key,
        value,
      }, () => {
        chrome.runtime.lastError
      })
    })
  })
}

function setBilifocusOption(key: string, value: boolean, broadcast = true) {
  getBilifocusInput(key).prop('checked', value)
  chrome.storage.local.set({ [key]: value })
  if (broadcast) broadcastBilifocusUpdate(key, value)
}

chrome.storage.local.remove(['homepagerecom', 'bilifocusMinimalDefaultsApplied'])

chrome.storage.local.get([...Object.keys(bilifocusDefaults), 'slashfocus'], (result) => {
  const missingValues: Record<string, boolean> = {}
  Object.keys(bilifocusDefaults).forEach((key) => {
    const value = result[key] === undefined ? bilifocusDefaults[key] : Boolean(result[key])
    if (result[key] === undefined) missingValues[key] = value
    getBilifocusInput(key).prop('checked', value)
  })
  if (Object.keys(missingValues).length > 0) chrome.storage.local.set(missingValues)
  $slashFocus.prop('checked', result.slashfocus === undefined ? true : Boolean(result.slashfocus))
  if (result.slashfocus === undefined) chrome.storage.local.set({ slashfocus: true })
  updateBilifocusToggleText()
})

Object.keys(bilifocusDefaults).forEach((key) => {
  getBilifocusInput(key).on('change', () => {
    setBilifocusOption(key, getBilifocusInput(key).prop('checked'))
    updateBilifocusToggleText()
  })
})

$('#fn-bilifocus-toggle').on('click', () => {
  const nextValue = getBilifocusFalseCount() !== 0
  Object.keys(bilifocusDefaults).forEach((key) => {
    setBilifocusOption(key, nextValue)
  })
  updateBilifocusToggleText()
})

loadSettings().then((settings) => {
  store.settings = settings
  console.log('loaded settings', store.settings)

  // load settings to UI
  $autoFocus.prop('checked', store.settings.autoFocusSearchBar)
  $autoLoadVideoColumn.prop('checked', store.settings.autoLoadVideoColumn)
  $blockedWords.val(store.settings.blockedWords)
})
