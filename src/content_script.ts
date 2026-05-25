import $, { Cash } from 'cash-dom';
import delegate from 'delegate-it';

import { loadSettings } from './settings';
import { colors, getLogger } from './utils/log';
import { formatDate, formatDuration, hoursOrMinutesFrom } from './utils/misc';


/*
possible settings:
- [x] enable/disable scroll to load
- [x] enable/disable auto focus search bar
- [ ] enable/disable hover seq to show preview
- [ ] feed font size

TODO:
- [x] hover seq number to show preview
- [ ] remember watched status in local storage
- [ ] add toggle to show/hide watched videos
- [ ] list: rightmost button that marks watched/unwatched, and shows preview
- [ ] play-controls: mark watched/unwatched
- [ ] paginator: next/prev video, close button in the middle
- [ ] error handling for video page parsing
- [ ] column for recommendations
- [ ] like, tip, fav buttons
- [ ] add video to bilibili history
*/


const lg = getLogger('content_script', colors.bgYellowBright)
lg.info('content_script.ts');

const TYPE_LIST = {
  VIDEO: '8',
  BANGUMI: '512,4097,4098,4099,4100,4101',
}

let recommendOffset = 0
const RECOMMEND_PAGE_SIZE = 10
const DYNAMIC_VISITED_KEY = 'minimalDynamicVisitedUrls'
const MAX_DYNAMIC_VISITED = 1000
const RECOMMEND_DISLIKED_KEY = 'minimalDislikedRecommendKeys'
const MAX_DISLIKED_RECOMMENDS = 1000
let prependWatchLaterItem: ((item: WatchLaterItem) => void)|null = null
const dynamicVisitedUrls = new Set<string>()
const dislikedRecommendKeys = new Set<string>()

/* main */

loadSettings().then(async (settings) => {
  lg.info('loaded settings', settings)
  await loadDynamicVisitedUrls()
  await loadDislikedRecommendKeys()
  const blockedWords = settings.blockedWords
    ? settings.blockedWords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  console.log("Processed blockedWords:", blockedWords);

  markOriginalRecommendContainer()

  setTimeout(() => {
    const searchInput = document.querySelector('input.nav-search-input') as HTMLInputElement
    if (!searchInput) return
    // remove placeholder and title
    searchInput.placeholder = ''
    searchInput.title = ''
    // focus
    if (settings.autoFocusSearchBar) {
      searchInput.focus()
    }
  }, 1000);

  // remove download button
  const downloadLink = document.querySelector('.download-client-trigger')
  downloadLink?.parentElement?.remove()

  // all the logics that rely on uid
  const uidInterval = setInterval(() => {
    const uid = getCurrentUserId()
    const dynamicsParent = $('.feed2')
    if (!uid || dynamicsParent.length === 0 || dynamicsParent.find('.dynamics-container').length > 0) {
      return
    }

    clearInterval(uidInterval)

    // create container
    const container = $('<div class="dynamics-container">').prependTo(dynamicsParent)

    // init columns
    const loadMoreFuncs: Array<() => Promise<void>> = []


    const loadMoreVideos = initDynamicsColumn(container, 'left', '动态', uid, TYPE_LIST.VIDEO, blockedWords)
    if (settings.autoLoadVideoColumn)
      loadMoreFuncs.push(loadMoreVideos)
    initWatchLaterColumn(container)
    initRecommendColumn(container, blockedWords)

    // listen to video link click
    delegate(container.get(0) as HTMLDivElement, '.left-column .dynamic-item .title a.open-player', 'click', (e) => {
      const link = e.target as HTMLLinkElement
      markDynamicVisited(link)

      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      chrome.runtime.sendMessage({
        type: 'open-link-in-split-view',
        url: link.href,
      }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          window.open(link.href, '_blank', 'noopener')
        }
      })
    })
    delegate(container.get(0) as HTMLDivElement, '.left-column .dynamic-item .title a:not(.open-player)', 'click', (e) => {
      markDynamicVisited(e.target as HTMLLinkElement)
    })
    initPreviewHover(container.get(0) as HTMLDivElement)

    // load more when scroll to bottom
    detectScrollToBottom(async () => {
      if (loadMoreFuncs.length === 0) return
      await Promise.all(loadMoreFuncs.map(f => f()))
    })
  }, 100)
})

/* functions */

function loadDynamicVisitedUrls() {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get(DYNAMIC_VISITED_KEY, (data) => {
      const urls = Array.isArray(data[DYNAMIC_VISITED_KEY]) ? data[DYNAMIC_VISITED_KEY] : []
      dynamicVisitedUrls.clear()
      for (const url of urls) {
        if (typeof url === 'string') dynamicVisitedUrls.add(normalizeDynamicUrl(url))
      }
      resolve()
    })
  })
}

function markDynamicVisited(link: HTMLLinkElement) {
  const url = normalizeDynamicUrl(link.href)
  if (!url) return

  dynamicVisitedUrls.delete(url)
  dynamicVisitedUrls.add(url)
  while (dynamicVisitedUrls.size > MAX_DYNAMIC_VISITED) {
    const first = dynamicVisitedUrls.values().next().value
    dynamicVisitedUrls.delete(first)
  }

  link.classList.add('visited')
  link.closest('.dynamic-item')?.classList.add('visited')
  chrome.storage.local.set({ [DYNAMIC_VISITED_KEY]: Array.from(dynamicVisitedUrls) })
}

function loadDislikedRecommendKeys() {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get(RECOMMEND_DISLIKED_KEY, (data) => {
      const keys = Array.isArray(data[RECOMMEND_DISLIKED_KEY]) ? data[RECOMMEND_DISLIKED_KEY] : []
      dislikedRecommendKeys.clear()
      for (const key of keys) {
        if (typeof key === 'string' && key) dislikedRecommendKeys.add(key)
      }
      resolve()
    })
  })
}

function rememberDislikedRecommend(item: RecommendCard) {
  const key = getRecommendKey(item)
  if (!key) return

  dislikedRecommendKeys.delete(key)
  dislikedRecommendKeys.add(key)
  while (dislikedRecommendKeys.size > MAX_DISLIKED_RECOMMENDS) {
    const first = dislikedRecommendKeys.values().next().value
    dislikedRecommendKeys.delete(first)
  }

  chrome.storage.local.set({ [RECOMMEND_DISLIKED_KEY]: Array.from(dislikedRecommendKeys) })
}

function isDynamicVisited(url: string) {
  return dynamicVisitedUrls.has(normalizeDynamicUrl(url))
}

function normalizeDynamicUrl(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString()
  } catch {
    return url
  }
}

async function fetchDynamics(uid: string, dynamicId: string|null, type_list: string): Promise<DynamicData> {
  // see https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/dynamic/get_dynamic_detail.md
  // for type_list values meaning
  let url
  if (dynamicId) {
    url = `https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/dynamic_history?uid=${uid}&type_list=${type_list}&offset_dynamic_id=${dynamicId}`
  } else {
    url = `https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/dynamic_new?uid=${uid}&type_list=${type_list}`
  }

  const resp = await fetch(url, {
    credentials: 'include',
  })
  return resp.json()
}

interface DynamicData {
  data: {
    cards: {
      card: string
      desc: {
        // video id, e.g. BV1Dx4y1F7u3; video url: https://www.bilibili.com/video/BV1Dx4y1F7u3
        bvid: string
        dynamic_id_str: string
        // e.g. 1677212231
        timestamp: number
        user_profile?: {
          info: {
            // avatar image url
            face: string
            // user id, e.g. 31700507; user url: https://space.bilibili.com/31700507
            uid: number
            uname: string
          }
        }
      }
      display: any
      extend_json: string
    }[]
  }
}

interface VideoCard {
  // 【游研社】在末日生存如何解决“住房”问题？
  title: string
  // "在当今的文化作品中，末日题材已越发被大家熟悉。丧尸、核平、冻土、水灾......在这些诸多的末日题材中，总有那么一群生存大师，即便身处的环境再差，也要想办法给自己解决“住房”问题。今天我们就来和大家聊聊末日生存该如何解决“住”的问题。"
  desc: string
  // e.g. 1677212230
  // NOTE pubdate may be earlier than the actual time the video appears in dynamics, use desc.timestamp instead
  pubdate: number
  // duration in seconds
  duration: number
  // video thumbnail url
  pic: string
  // statistics
  stat: {
    like: number
    coin: number
    favorite: number
    reply: number
    view: number
  }
  // tag name, e.g. 单机游戏
  tname: string
  // tag id
  tid: number
}

interface BangumiCard {
  new_desc: string
  cover: string
  apiSeasonInfo: {
    title: string
    cover: string
  }
  url: string
}

interface WatchLaterData {
  code: number
  message: string
  data?: {
    list?: WatchLaterItem[]
  }
}

interface WatchLaterItem {
  aid?: number
  bvid?: string
  title: string
  pic?: string
  duration?: number
  pubdate?: number
  publishedAtText?: string
  owner?: {
    mid?: number
    name?: string
  }
}

interface ColumnState {
  dynamicsSeq: number
  lastDynamicId: string|null
}

function initWatchLaterColumn(container: Cash) {
  const column = $('<aside class="watchlater-column">').appendTo(container)
  const sectionTitle = $('<div class="section-title">').appendTo(column)
  $('<span>').text('稍后再看').appendTo(sectionTitle)
  const refresh = $('<button class="refresh-dynamics" title="刷新稍后再看">↻</button>').appendTo(sectionTitle)
  const list = $('<div class="watchlater-list">').appendTo(column)
  const preview = $('<div class="watchlater-preview">').appendTo(column)

  const loadWatchLater = async () => {
    refresh.attr('disabled', 'disabled')
    list.empty().append('<div class="watchlater-empty">加载中</div>')
    try {
      const items = await fetchWatchLater()
      renderWatchLaterList(list, items)
    } catch (error) {
      console.error('failed to load watch later list', error)
      list.empty().append('<div class="watchlater-empty">加载失败</div>')
    } finally {
      refresh.removeAttr('disabled')
    }
  }

  prependWatchLaterItem = (item) => {
    list.children('.watchlater-empty').remove()
    const existing = list.find(`.watchlater-item[data-key="${getWatchLaterKey(item)}"]`)
    if (existing.length > 0) {
      existing.remove()
    }
    list.prepend(renderWatchLaterItem(list, item))
  }

  list.on('mouseenter', '.watchlater-item', (event) => {
    const item = event.currentTarget as HTMLElement
    const img = item.dataset.pic
    const title = item.dataset.title || ''
    const url = item.dataset.url || ''
    const desc = item.dataset.desc || title
    if (!img || !url) return

    const itemRect = item.getBoundingClientRect()
    const columnRect = column.get(0)!.getBoundingClientRect()
    const desiredTop = itemRect.top - columnRect.top
    preview.html(`
      <div class="inner">
        <img src="${img}">
        <div class="desc">
          <span class="desc-title">简介</span>
          ${linkifyText(desc)}
        </div>
      </div>
    `)
    preview.css('top', `${desiredTop}px`)
    preview.addClass('is-visible')
    const previewHeight = preview.get(0)!.offsetHeight
    const bottomOverflow = itemRect.top + previewHeight - window.innerHeight
    if (bottomOverflow > 0) {
      const alignedTop = window.innerHeight - previewHeight - columnRect.top - 8
      preview.css('top', `${Math.max(0, alignedTop)}px`)
    }
  })

  list.on('mouseleave', '.watchlater-item', () => {
    preview.removeClass('is-visible')
  })

  refresh.on('click', loadWatchLater)
  loadWatchLater()
}

function initRecommendColumn(container: Cash, blockedWords: string[]) {
  const column = $('<aside class="minimal-recommend-column">').appendTo(container)
  const sectionTitle = $('<div class="section-title">').appendTo(column)
  $('<span>').text('推荐').appendTo(sectionTitle)
  const refresh = $('<button class="recommend-switch" title="换一换">换一换</button>').appendTo(sectionTitle)
  const toggle = $('<button class="recommend-switch" title="隐藏推荐">隐藏</button>').appendTo(sectionTitle)
  const list = $('<div class="minimal-recommend-list">').appendTo(column)

  chrome.storage.local.get('minimalRecommendHidden', (data) => {
    const hidden = Boolean(data.minimalRecommendHidden)
    column.toggleClass('recommend-hidden', hidden)
    toggle.text(hidden ? '显示' : '隐藏')
    toggle.attr('title', hidden ? '显示推荐' : '隐藏推荐')
  })

  const render = (advance = false) => {
    if (advance) recommendOffset += RECOMMEND_PAGE_SIZE
    renderRecommendList(list, blockedWords, recommendOffset)
  }

  refresh.on('click', () => render(true))
  toggle.on('click', () => {
    const hidden = column.toggleClass('recommend-hidden').hasClass('recommend-hidden')
    toggle.text(hidden ? '显示' : '隐藏')
    toggle.attr('title', hidden ? '显示推荐' : '隐藏推荐')
    chrome.storage.local.set({ minimalRecommendHidden: hidden })
  })

  const observeSource = () => {
    const source = getOriginalRecommendSource()
    if (!source) {
      window.setTimeout(observeSource, 500)
      return
    }

    render(false)
    const observer = new MutationObserver(runOnceInTime(render, 1000))
    observer.observe(source, { childList: true, subtree: true })
  }

  observeSource()
  window.addEventListener('resize', runOnceInTime(() => render(false), 500))
}

function renderRecommendList(container: Cash, blockedWords: string[], offset: number) {
  const source = getOriginalRecommendSource()
  container.empty()

  if (!source) {
    container.append('<div class="watchlater-empty">加载中</div>')
    return
  }

  const cards = Array.from(source.querySelectorAll('.feed-card, .bili-video-card'))
    .filter((card, index, allCards) => {
      if (!(card instanceof HTMLElement)) return false
      return allCards.findIndex((candidate) => candidate === card || candidate.contains(card)) === index
    })
    .filter((card): card is HTMLElement => card instanceof HTMLElement && isValidRecommendCard(card, blockedWords))
    .filter((card) => !isRecommendDisliked(getRecommendKeyFromCard(card)))

  if (cards.length === 0) {
    container.append('<div class="watchlater-empty">暂无推荐</div>')
    return
  }

  const start = cards.length > RECOMMEND_PAGE_SIZE ? offset % cards.length : 0
  const selected = Array.from(
    { length: Math.min(RECOMMEND_PAGE_SIZE, cards.length) },
    (_, index) => cards[(start + index) % cards.length],
  )

  for (const card of selected) {
    const item = parseRecommendCard(card)
    if (!item) continue
    container.append(renderRecommendCard(item))
  }
}

function markOriginalRecommendContainer() {
  $('.recommended-container_floor-aside').addClass('minimal-original-recommend')
}

function getOriginalRecommendSource() {
  markOriginalRecommendContainer()
  return document.querySelector('.minimal-original-recommend .container, .recommended-container_floor-aside .container') as HTMLElement|null
}

function isValidRecommendCard(card: HTMLElement, blockedWords: string[]) {
  if (card.querySelector('.bili-live-card')) return false
  if (card.querySelector('.bili-video-card__info--ad, .bili-video-card__info--creative-ad')) return false
  if (card.querySelector('.floor-single-card, .recommended-swipe')) return false

  const title = card.querySelector('.bili-video-card__info--tit')?.textContent?.trim() || ''
  if (!title) return false

  return !blockedWords.some((word) => title.toLowerCase().includes(word.toLowerCase()))
}

function getRecommendKeyFromCard(card: HTMLElement) {
  const link = card.querySelector<HTMLAnchorElement>('a[href*="/video/"]')
  const url = link?.href || ''
  const title = card.querySelector<HTMLElement>('.bili-video-card__info--tit')?.textContent?.trim() || link?.title?.trim() || ''

  return getRecommendKey({
    aid: getAidFromRecommendCard(card, url),
    bvid: getBvidFromUrl(url),
    title,
    url,
  })
}

function getRecommendKey(item: Pick<RecommendCard, 'aid'|'bvid'|'title'|'url'>) {
  if (item.bvid) return `bvid:${item.bvid}`
  if (item.aid) return `aid:${item.aid}`
  const url = normalizeDynamicUrl(item.url)
  if (url) return `url:${url}`
  return item.title ? `title:${item.title}` : ''
}

function isRecommendDisliked(key: string) {
  return key !== '' && dislikedRecommendKeys.has(key)
}

interface RecommendCard {
  aid?: number
  bvid?: string
  title: string
  url: string
  pic: string
  author: string
  authorUrl: string
  date: string
  duration: string
  views: string
  danmaku: string
}

function parseRecommendCard(card: HTMLElement): RecommendCard|null {
  const link = card.querySelector<HTMLAnchorElement>('a[href*="/video/"]')
  const titleEl = card.querySelector<HTMLElement>('.bili-video-card__info--tit')
  const image = card.querySelector<HTMLImageElement>('picture img, img')
  const title = titleEl?.textContent?.trim() || link?.title?.trim() || ''
  const url = link?.href || ''
  const pic = image?.src || image?.getAttribute('data-src') || ''
  if (!title || !url || !pic) return null

  const authorLink = card.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com"]')
  const date = normalizeRecommendMetaText(card.querySelector<HTMLElement>('.bili-video-card__info--date')?.textContent || '')
  const author = stripTrailingRecommendDate(normalizeRecommendMetaText(authorLink?.textContent || ''), date)
    || stripTrailingRecommendDate(normalizeRecommendMetaText(card.querySelector<HTMLElement>('.bili-video-card__info--author, .bili-video-card__info--owner')?.textContent || ''), date)
    || ''
  const duration = normalizeRecommendMetaText(card.querySelector<HTMLElement>('.bili-video-card__stats__duration')?.textContent || '')
  const stats = Array.from(card.querySelectorAll<HTMLElement>('.bili-video-card__stats--item')).map((el) => el.textContent?.trim() || '').filter(Boolean)

  return {
    aid: getAidFromRecommendCard(card, url),
    bvid: getBvidFromUrl(url),
    title,
    url,
    pic: normalizeImageUrl(pic),
    author,
    authorUrl: authorLink?.href || '',
    date,
    duration,
    views: stats[0] || '',
    danmaku: stats[1] || '',
  }
}

function renderRecommendCard(item: RecommendCard) {
  const stats = [item.views, item.danmaku, item.duration].filter(Boolean)
  const card = $(`
    <div class="minimal-recommend-card" data-aid="${item.aid || ''}">
      <a class="minimal-recommend-cover" href="${item.url}" target="_blank" title="${escapeAttr(item.title)}">
        <img src="${item.pic}">
        ${stats.length > 0 ? `
          <div class="minimal-recommend-stats">
            ${stats.map((stat) => `<span>${escapeHtml(stat)}</span>`).join('')}
          </div>
        ` : ''}
      </a>
      <a class="minimal-recommend-title" href="${item.url}" target="_blank" title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</a>
      <div class="minimal-recommend-meta">
        ${renderRecommendOwner(item)}
        <span>${escapeHtml(item.date)}</span>
      </div>
      <div class="minimal-recommend-actions">
        <button class="minimal-recommend-action fn-watchlater" ${item.aid || item.bvid ? '' : 'disabled'}>稍后再看</button>
        <button class="minimal-recommend-action fn-dislike">不感兴趣</button>
      </div>
    </div>
  `)

  card.find('.fn-watchlater').on('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()

    const button = $(event.currentTarget)
    button.attr('disabled', 'disabled')
    try {
      await addWatchLater(item)
      button.text('已添加')
      prependWatchLaterItem?.({
        aid: item.aid,
        bvid: item.bvid,
        title: item.title,
        pic: item.pic,
        owner: {
          mid: getMidFromSpaceUrl(item.authorUrl),
          name: item.author,
        },
        duration: parseDurationText(item.duration),
        publishedAtText: item.date,
      })
    } catch (error) {
      console.error('failed to add recommend item to watch later', error)
      button.removeAttr('disabled')
    }
  })

  card.find('.fn-dislike').on('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    rememberDislikedRecommend(item)
    card.remove()
  })

  return card
}

function normalizeImageUrl(url: string) {
  if (url.startsWith('//')) return `https:${url}`
  return url
}

function renderRecommendOwner(item: RecommendCard) {
  if (!item.author) return '<span></span>'
  if (!item.authorUrl) return `<span>${escapeHtml(item.author)}</span>`
  return `<a class="minimal-recommend-owner" href="${item.authorUrl}" target="_blank" title="${escapeAttr(item.author)}">${escapeHtml(item.author)}</a>`
}

function normalizeRecommendMetaText(text: string) {
  return text.replace(/\s+/g, ' ').replace(/^·\s*/, '').trim()
}

function stripTrailingRecommendDate(text: string, date: string) {
  if (!date) return text
  return text.replace(new RegExp(`\\s*[·•]\\s*${escapeRegExp(date)}\\s*$`), '').trim()
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getAidFromRecommendCard(card: HTMLElement, url: string) {
  const aidAttr = card.getAttribute('data-aid') || card.querySelector<HTMLElement>('[data-aid]')?.getAttribute('data-aid')
  if (aidAttr && /^\d+$/.test(aidAttr)) return parseInt(aidAttr, 10)

  const avMatch = url.match(/\/video\/av(\d+)/)
  if (avMatch) return parseInt(avMatch[1], 10)

  return undefined
}

function getBvidFromUrl(url: string) {
  return url.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1]
}

function getMidFromSpaceUrl(url: string) {
  const mid = url.match(/space\.bilibili\.com\/(\d+)/)?.[1]
  return mid ? parseInt(mid, 10) : undefined
}

async function addWatchLater(item: RecommendCard) {
  const csrf = getCookieValue('bili_jct')
  if (!csrf) {
    throw new Error('missing bili_jct csrf token')
  }
  if (!item.aid && !item.bvid) {
    throw new Error('missing aid or bvid')
  }

  const body = new URLSearchParams()
  if (item.bvid) {
    body.set('bvid', item.bvid)
  } else if (item.aid) {
    body.set('aid', String(item.aid))
  }
  body.set('csrf', csrf)

  const resp = await fetch('https://api.bilibili.com/x/v2/history/toview/add', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const data = await resp.json() as { code: number; message: string }
  if (data.code !== 0) {
    throw new Error(data.message || `request failed: ${data.code}`)
  }
}

async function fetchWatchLater(): Promise<WatchLaterItem[]> {
  const resp = await fetch('https://api.bilibili.com/x/v2/history/toview', {
    credentials: 'include',
  })
  const data = await resp.json() as WatchLaterData
  if (data.code !== 0) {
    throw new Error(data.message || `request failed: ${data.code}`)
  }
  return data.data?.list || []
}

function renderWatchLaterList(container: Cash, items: WatchLaterItem[]) {
  container.empty()

  if (items.length === 0) {
    container.append('<div class="watchlater-empty">暂无内容</div>')
    return
  }

  for (const item of items) {
    container.append(renderWatchLaterItem(container, item))
  }
}

function renderWatchLaterItem(listContainer: Cash, item: WatchLaterItem) {
  const url = item.bvid
    ? `https://www.bilibili.com/video/${item.bvid}`
    : `https://www.bilibili.com/video/av${item.aid}`
  const canDelete = typeof item.aid === 'number'
  const itemEl = $(`
    <div class="watchlater-item" data-key="${getWatchLaterKey(item)}" data-aid="${item.aid || ''}" data-url="${url}" data-title="${escapeAttr(item.title)}" data-desc="${escapeAttr(item.title)}" data-pic="${item.pic ? normalizeImageUrl(item.pic) : ''}">
      <a class="watchlater-title" href="${url}" target="_blank" title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</a>
      <button class="watchlater-remove" title="从稍后再看删除" ${canDelete ? '' : 'disabled'}>×</button>
      <div class="watchlater-meta">
        ${renderWatchLaterOwner(item)}
        ${renderWatchLaterDuration(item)}
        ${renderWatchLaterDate(item)}
      </div>
    </div>
  `)

  itemEl.find('.watchlater-remove').on('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()

    const button = $(event.currentTarget)
    button.attr('disabled', 'disabled')
    try {
      if (typeof item.aid !== 'number') return
      await deleteWatchLater(item.aid)
      itemEl.remove()
      if (listContainer.children('.watchlater-item').length === 0) {
        listContainer.append('<div class="watchlater-empty">暂无内容</div>')
      }
    } catch (error) {
      console.error('failed to delete watch later item', error)
      button.removeAttr('disabled')
    }
  })

  return itemEl
}

function getWatchLaterKey(item: WatchLaterItem) {
  return item.bvid || `aid-${item.aid || ''}`
}

function renderWatchLaterOwner(item: WatchLaterItem) {
  const name = item.owner?.name || ''
  if (!name) return '<span></span>'
  if (!item.owner?.mid) return `<span>${escapeHtml(name)}</span>`
  return `<a href="https://space.bilibili.com/${item.owner.mid}" target="_blank" class="watchlater-owner" title="${escapeAttr(name)}">${escapeHtml(name)}</a>`
}

function renderWatchLaterDuration(item: WatchLaterItem) {
  if (!item.duration) return ''
  return `<span>${escapeHtml(formatDuration(item.duration))}</span>`
}

function renderWatchLaterDate(item: WatchLaterItem) {
  const text = item.publishedAtText || (item.pubdate ? formatDate(item.pubdate) : '')
  if (!text) return ''
  return `<span>${escapeHtml(text)}</span>`
}

function parseDurationText(text: string) {
  const parts = text.split(':').map((part) => parseInt(part, 10))
  if (parts.some((part) => Number.isNaN(part))) return undefined
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return undefined
}

async function deleteWatchLater(aid: number) {
  const csrf = getCookieValue('bili_jct')
  if (!csrf) {
    throw new Error('missing bili_jct csrf token')
  }

  const body = new URLSearchParams()
  body.set('aid', String(aid))
  body.set('csrf', csrf)

  const resp = await fetch('https://api.bilibili.com/x/v2/history/toview/del', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const data = await resp.json() as { code: number; message: string }
  if (data.code !== 0) {
    throw new Error(data.message || `request failed: ${data.code}`)
  }
}

function getCookieValue(name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

function getCurrentUserId() {
  const fromCookie = getCookieValue('DedeUserID')
  if (fromCookie) return fromCookie

  const profileLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="space.bilibili.com/"]'))
  for (const link of profileLinks) {
    const uid = link.href.match(/space\.bilibili\.com\/(\d+)/)?.[1]
    if (uid) return uid
  }

  return ''
}

function initDynamicsColumn(container: Cash, name: string, title: string, uid: string, type_list: string, blockedWords: string[]) {

  const column = $(`<section class="${name}-column">`).appendTo(container)
  const sectionTitle = $('<div class="section-title">').appendTo(column)
  $('<span>').text(title).appendTo(sectionTitle)
  const refresh = $('<button class="refresh-dynamics" title="刷新最新动态">↻</button>').appendTo(sectionTitle)
  const items = $('<div class="items">').appendTo(column)
  const actions = $('<div class="actions">').appendTo(column)
  const loadMore = $('<button class="load-more button">').text('加载更多').appendTo(actions)

  const state: ColumnState = {
    dynamicsSeq: 0,
    lastDynamicId: null,
  }

  const loadMoreFunc = async () => {
    loadMore.attr('disabled', 'disabled')
    await loadDynamics(state, items, uid, type_list, blockedWords)
    loadMore.removeAttr('disabled')
  }

  const refreshFunc = async () => {
    refresh.attr('disabled', 'disabled')
    loadMore.attr('disabled', 'disabled')
    state.dynamicsSeq = 0
    state.lastDynamicId = null
    items.empty()
    await loadDynamics(state, items, uid, type_list, blockedWords)
    refresh.removeAttr('disabled')
    loadMore.removeAttr('disabled')
  }

  loadMore.on('click', loadMoreFunc)
  refresh.on('click', refreshFunc)

  loadDynamics(state, items, uid, type_list, blockedWords)
  return loadMoreFunc
}

async function loadDynamics(state: ColumnState, container: Cash, uid: string, type_list: string, blockedWords: string[]) {

  return fetchDynamics(uid, state.lastDynamicId, type_list).then(data => {
    // console.log('data', data)
    for (const item of data.data.cards) {
      state.dynamicsSeq++
      const desc = item.desc
      const _card = JSON.parse(item.card)
      let innerHtml
      let dateStr
      if (desc.bvid) {
        const card = _card as VideoCard
        let shouldBlock = false
        for (const word of blockedWords) {
          if (card.title.toLowerCase().includes(word.toLowerCase())) {
            console.log(`block video with title ${card.title}, match word ${word}`)
            shouldBlock = true
            break
          }
        }
        if (shouldBlock) continue

        const description = card.desc
        const videoUrl = `https://www.bilibili.com/video/${desc.bvid}`
        const visitedClass = isDynamicVisited(videoUrl) ? ' visited' : ''
        innerHtml = `
          <a href="${videoUrl}" target="_blank" class="seq">${state.dynamicsSeq}</a>
          <div class="content">
            <div class="title">
              <a href="${videoUrl}" target="_blank" class="open-player${visitedClass}" title="${escapeAttr(card.title)}">${escapeHtml(card.title)}</a>
            </div>
            <div class="meta">
              <span class="with-sep">${spanIcon('user')}<a href="https://space.bilibili.com/${desc.user_profile?.info.uid}" target="_blank">${desc.user_profile?.info.uname}</a></span
              ><span class="with-sep">${spanIcon('calendar-time')}${hoursOrMinutesFrom(desc.timestamp)}</span
              ><span class="with-sep">${spanIcon('clock')}${formatDuration(card.duration)}</span
              ><span class="stats">
                ${spanIcon('thumb-up')}<span class="value">${card.stat.like}</span>
                ${spanIcon('coin-yuan')}<span class="value">${card.stat.coin}</span>
                ${spanIcon('star')}<span class="value">${card.stat.favorite}</span>
              </span>
            </div>
            <div class="desc">${description}</div>
            ${divPreview(card.pic, description)}
          </div>
        `
        dateStr = formatDate(desc.timestamp)
      } else {
        const card = _card as BangumiCard
        const description = card.apiSeasonInfo.title
        const visitedClass = isDynamicVisited(card.url) ? ' visited' : ''
        // console.log('bangumi card', card, item)
        innerHtml = `
          <a href="https://www.bilibili.com/video/${desc.bvid}" target="_blank" class="seq">${state.dynamicsSeq}</a>
          <div class="content">
            <div class="title">
              <a href="${card.url}" target="_blank" class="${visitedClass.trim()}" title="${escapeAttr(card.new_desc)}">${escapeHtml(card.new_desc)}</a>
            </div>
            <div class="meta">
              <span class="with-sep">${spanIcon('user')}${card.apiSeasonInfo.title}</span
              ><span>${spanIcon('calendar-time')}${hoursOrMinutesFrom(desc.timestamp)}</span
            </div>
            <div class="desc">${description}</div>
            ${divPreview(card.cover, description)}
          </div>
        `
        dateStr = formatDate(desc.timestamp)
      }

      // get or create date separator
      const dateSeparator = container.find(`.date-separator[data-date="${dateStr}"]`)
      if (dateSeparator.length === 0) {
        $(`<div class="date-separator" data-date="${dateStr}"><span>${dateStr}</span></div>`).appendTo(container)
      }

      const dynamicItem = $('<div class="dynamic-item">').appendTo(container)
      dynamicItem.html(innerHtml)
      if (dynamicItem.find('.title a.visited').length > 0) {
        dynamicItem.addClass('visited')
      }

      state.lastDynamicId = desc.dynamic_id_str
    }
  })
}

function spanIcon(icon: string) {
  return `<span class="icon icon--tabler icon--tabler--${icon}"></span>`
}

function divPreview(img: string, desc: string) {
  return `
    <div class="preview">
      <div class="inner">
        <img src="${img}">
        <div class="desc"><span class="desc-title">简介</span>${linkifyText(desc)}</div>
      </div>
    </div>
  `
}

function initPreviewHover(container: HTMLDivElement) {
  const hideTimers = new WeakMap<HTMLElement, number>()

  container.addEventListener('mouseover', (event) => {
    const target = event.target as HTMLElement
    const seq = target.closest('.dynamic-item .seq')
    const preview = target.closest('.dynamic-item .preview')
    const item = (seq || preview)?.closest('.dynamic-item') as HTMLElement|null

    if (!item || !container.contains(item)) return

    const timer = hideTimers.get(item)
    if (timer) {
      window.clearTimeout(timer)
      hideTimers.delete(item)
    }
    item.classList.add('preview-active')
  })

  container.addEventListener('mouseout', (event) => {
    const target = event.target as HTMLElement
    const item = target.closest('.dynamic-item') as HTMLElement|null
    if (!item || !container.contains(item)) return

    const relatedTarget = event.relatedTarget as Node|null
    if (relatedTarget && item.contains(relatedTarget)) return

    const timer = window.setTimeout(() => {
      item.classList.remove('preview-active')
      hideTimers.delete(item)
    }, 30)
    hideTimers.set(item, timer)
  })
}

function linkifyText(text: string) {
  return escapeHtml(text).replace(/https?:\/\/[^\s<>"']+/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  })
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[char]
  })
}

function escapeAttr(text: string) {
  return escapeHtml(text).replace(/`/g, '&#96;')
}

const scrollBottomOffset = 5;

function detectScrollToBottom(callback: () => Promise<void>) {
  let isDoing = false;

  window.addEventListener("scroll", async function () {
    if (isDoing) return

    const scrollPosition = window.scrollY;
    const windowSize = window.innerHeight;
    const fullSize = document.body.scrollHeight;
    // console.log('scroll', isDoing, scrollPosition, scrollPosition + windowSize, fullSize)
    if (scrollPosition + windowSize + scrollBottomOffset > fullSize) {
      isDoing = true
      await callback();
      isDoing = false
    }
  });
}

function observeRecommend(blockedWords: string[]) {

  const targetNode = document.querySelector('.recommended-container_floor-aside .container') as HTMLDivElement

  const debouncedRemoveAds = runOnceInTime(() => removeAdsAndBlockedWordsIn(targetNode, blockedWords), 2000)

  // Callback function to execute when mutations are observed
  const callback: MutationCallback = (mutationsList: MutationRecord[], observer: MutationObserver) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        // do something because child elements have changed
        // console.log('A child node has been added or removed.')
        debouncedRemoveAds()
      }
    }
  };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(callback);

  // Options for the observer (which mutations to observe)
  const config: MutationObserverInit = { childList: true };

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);
}

function runOnceInTime(fn: () => void, interval: number): () => void {
  let timerId: NodeJS.Timeout | null = null;

  return () => {
    if (timerId === null) {
      setTimeout(fn, 200);
      timerId = setTimeout(() => {
        timerId = null;
      }, interval);
    }
  };
}

function removeAdsAndBlockedWordsIn(el: HTMLElement, blockedWords: string[]) {
  lg.info('removeAdsAndBlockedWordsIn', el)
  const $el = $(el)

  // remove ads
  $el.find('.bili-video-card__info--ad, .bili-video-card__info--creative-ad').each((i, el) => {
    removeVideoCardParent(el)
  })
  $el.find('.bili-live-card').remove()

  // remove blocked words
  if (blockedWords.length > 0) {
    $el.find('.bili-video-card__info--tit').each((i, el) => {
      // console.log('info el content', el.textContent);
      const title = el.textContent
      for (const word of blockedWords) {
        if (title && title.toLowerCase().includes(word.toLowerCase())) {
          console.log('remove recommend video:', title)
          removeVideoCardParent(el)
        }
      }
    })
  }
}

function removeVideoCardParent(el: HTMLElement) {
  const videoCard = $(el).closest('.bili-video-card')
  const parent = videoCard.parent()
  if (parent.hasClass('feed-card')) {
    parent.remove()
  } else {
    videoCard.remove()
  }
}
