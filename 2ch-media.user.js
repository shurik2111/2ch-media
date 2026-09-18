// ==UserScript==
// @name         2ch Media
// @namespace    https://github.com/shurik2111
// @version      1.5.0
// @description  Галерея фото и видео из треда, поиск по картинке и список ссылок.
// @author       shurik2111
// @homepageURL  https://github.com/shurik2111/2ch-media
// @downloadURL  https://raw.githubusercontent.com/shurik2111/2ch-media/main/2ch-media.user.js
// @updateURL    https://raw.githubusercontent.com/shurik2111/2ch-media/main/2ch-media.user.js
// @match        https://2ch.org/*/res/*.html*
// @match        https://2ch.su/*/res/*.html*
// @match        https://2ch.life/*/res/*.html*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  'use strict';

  if (!/^\/[^/]+\/res\/\d+\.html$/.test(location.pathname)) return;

  const APP = 'chm';
  const IMAGE_RE = /\.(?:jpe?g|png|gif|webp|bmp|avif|jfif)(?:$|[?#])/i;
  const VIDEO_RE = /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i;

  const state = {
    section: 'images',
    sort: 'newest',
    dirty: true,
    timer: 0,
    data: { images: [], videos: [], links: [] },
    viewer: [],
    viewerIndex: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const absUrl = href => {
    try { return new URL(href, location.href).href; }
    catch { return ''; }
  };

  const postUrl = number => `${location.origin}${location.pathname}#${number}`;

  function postNumber(post) {
    return post?.id?.match(/^post-(\d+)$/)?.[1] || '';
  }

  function fileName(url) {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file'); }
    catch { return 'file'; }
  }

  function posts() {
    const seen = new Set();
    return $$('[id^="post-"]').filter(post => {
      if (!/^post-\d+$/.test(post.id)) return false;
      if (!post.querySelector('.post__message') && !post.classList.contains('post')) return false;
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }

  function mediaLinks(post) {
    return $$('a[href]', post).filter(link => {
      if (link.closest('.post__message')) return false;
      const url = absUrl(link.getAttribute('href'));
      return IMAGE_RE.test(url) || VIDEO_RE.test(url);
    });
  }

  function videoPreview(link, post) {
    const own = $('img', link);
    if (own) return own.currentSrc || own.src || '';

    const box = link.closest('.post__image, .post__file, [class*="post__image"], [class*="post__file"]');
    const nearby = box && $('img.post__file-preview, img', box);
    return nearby ? (nearby.currentSrc || nearby.src || '') : '';
  }

  function scan() {
    const images = [];
    const videos = [];
    const links = [];
    const mediaSeen = new Set();
    const linkSeen = new Set();

    let order = 0;

    for (const post of posts()) {
      order += 1;
      const number = postNumber(post);
      if (!number) continue;

      const message = $('.post__message', post);
      const jump = postUrl(number);

      for (const link of mediaLinks(post)) {
        const url = absUrl(link.getAttribute('href'));
        if (!url || mediaSeen.has(url)) continue;
        mediaSeen.add(url);

        const item = {
          url,
          preview: videoPreview(link, post),
          name: fileName(url),
          postNum: number,
          postUrl: jump,
          order,
          postEl: post,
        };

        (VIDEO_RE.test(url) ? videos : images).push(item);
      }

      if (!message) continue;

      for (const link of $$('a[href]', message)) {
        const raw = link.getAttribute('href') || '';
        const url = absUrl(raw);
        if (!/^https?:\/\//i.test(url)) continue;

        // Пропускаем ссылки на посты и вложения.
        if (link.hasAttribute('data-num') || /^#\d+$/.test(raw)) continue;
        if (IMAGE_RE.test(url) || VIDEO_RE.test(url)) continue;

        const key = `${number}|${url}`;
        if (linkSeen.has(key)) continue;
        linkSeen.add(key);

        let host = url;
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}

        links.push({
          url,
          host,
          postNum: number,
          postUrl: jump,
          order,
          postEl: post,
          messageEl: message,
        });
      }
    }

    state.data = { images, videos, links };
    state.dirty = false;
    updateCounts();
  }

  function sorted(type) {
    const direction = state.sort === 'newest' ? -1 : 1;
    return [...state.data[type]].sort((a, b) => {
      const byPost = (a.order - b.order) * direction;
      if (byPost) return byPost;
      return (Number(a.postNum) - Number(b.postNum)) * direction;
    });
  }

  function addTab() {
    for (const tabs of $$('.bb__tabs')) {
      if ($(`[data-${APP}-tab]`, tabs)) continue;

      const tab = document.createElement('li');
      tab.className = 'bb__tab';
      tab.dataset.chmTab = '1';
      tab.dataset.tab = 'threadmedia';
      tab.textContent = 'Медиа';
      tab.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openHub();
      }, true);

      const anchor = $('[data-tab="boardstats"]', tabs) || tabs.lastElementChild;
      anchor ? anchor.after(tab) : tabs.append(tab);
    }
  }

  function ensureHub() {
    if ($(`#${APP}-backdrop`)) return;

    const backdrop = document.createElement('div');
    backdrop.id = `${APP}-backdrop`;
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section id="${APP}-panel" role="dialog" aria-modal="true" aria-label="Медиа">
        <nav class="${APP}-nav">
          <div class="${APP}-tabs">
            <button data-section="images" class="is-active">Фото <span data-count="images">0</span></button>
            <button data-section="videos">Видео <span data-count="videos">0</span></button>
            <button data-section="links">Ссылки <span data-count="links">0</span></button>
          </div>
          <button class="${APP}-sort" data-action="sort"><span>Сначала</span> <b id="${APP}-sort-label">новые</b></button>
        </nav>
        <main id="${APP}-content"></main>
      </section>`;

    document.body.append(backdrop);

    backdrop.addEventListener('mousedown', event => {
      if (event.target === backdrop) closeHub();
    });

    backdrop.addEventListener('click', event => {
      if (event.target.closest('[data-action="sort"]')) {
        state.sort = state.sort === 'newest' ? 'oldest' : 'newest';
        render();
        return;
      }

      const tab = event.target.closest('[data-section]');
      if (tab) {
        state.section = tab.dataset.section;
        render();
      }
    });
  }

  function openHub() {
    ensureHub();
    if (state.dirty) scan();

    $(`#${APP}-backdrop`).hidden = false;
    document.documentElement.classList.add(`${APP}-locked`);
    $$(`[data-${APP}-tab]`).forEach(tab => tab.classList.add('bb__tab_active'));
    render();
  }

  function closeHub() {
    closeViewer();
    const backdrop = $(`#${APP}-backdrop`);
    if (backdrop) backdrop.hidden = true;
    document.documentElement.classList.remove(`${APP}-locked`);
    $$(`[data-${APP}-tab]`).forEach(tab => tab.classList.remove('bb__tab_active'));
  }

  function updateCounts() {
    for (const type of ['images', 'videos', 'links']) {
      const counter = $(`[data-count="${type}"]`);
      if (counter) counter.textContent = state.data[type].length;
    }
  }

  function icon(name) {
    if (name === 'open') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5"/><path d="M10 14 19 5"/><path d="M19 13v6H5V5h6"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/></svg>';
  }

  function mediaActions(item, image) {
    return `
      <div class="${APP}-actions">
        <button class="${APP}-action" data-action="post" data-post="${escapeHtml(item.postNum)}">#${escapeHtml(item.postNum)}</button>
        ${image ? `<a class="${APP}-action" href="https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(item.url)}" target="_blank" rel="noopener">Яндекс</a>` : ''}
        ${image ? `<a class="${APP}-action" href="https://lens.google.com/uploadbyurl?url=${encodeURIComponent(item.url)}" target="_blank" rel="noopener">Google</a>` : ''}
        <a class="${APP}-action ${APP}-icon" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${icon('open')}</a>
        <a class="${APP}-action ${APP}-icon" href="${escapeHtml(item.url)}" download="${escapeHtml(item.name)}">${icon('download')}</a>
      </div>`;
  }

  let videoObserver = null;

  function resetVideoObserver() {
    videoObserver?.disconnect();
    videoObserver = null;
  }

  function prepareVideo(video, item) {
    const load = () => {
      if (video.dataset.loaded) return;
      video.dataset.loaded = '1';
      video.src = item.url;
      video.load();

      let seeking = false;
      const show = () => {
        video.pause();
        video.classList.add('is-ready');
      };

      video.addEventListener('loadedmetadata', () => {
        const duration = Number(video.duration);
        const point = Number.isFinite(duration) && duration > 0
          ? Math.min(0.35, Math.max(0.08, duration * 0.04))
          : 0.12;
        try {
          seeking = true;
          video.currentTime = point;
        } catch {
          seeking = false;
        }
      }, { once: true });

      video.addEventListener('seeked', show, { once: true });
      video.addEventListener('loadeddata', () => {
        if (!seeking) show();
        else setTimeout(show, 600);
      }, { once: true });
    };

    if (!('IntersectionObserver' in window)) {
      load();
      return;
    }

    if (!videoObserver) {
      videoObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          videoObserver.unobserve(entry.target);
          entry.target._loadPreview?.();
        }
      }, { root: $(`#${APP}-content`), rootMargin: '350px' });
    }

    video._loadPreview = load;
    videoObserver.observe(video);
  }

  function renderMedia(type) {
    resetVideoObserver();
    const items = sorted(type);
    state.viewer = items;

    if (!items.length) return `<div class="${APP}-empty">Здесь пока ничего нет</div>`;

    const grid = document.createElement('div');
    grid.className = `${APP}-grid`;

    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = `${APP}-card`;

      const thumb = document.createElement('button');
      thumb.className = `${APP}-thumb`;
      thumb.type = 'button';
      thumb.dataset.viewerIndex = index;

      if (type === 'images') {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        thumb.append(img);
      } else {
        const video = document.createElement('video');
        video.className = `${APP}-video-preview`;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        thumb.append(video);
        prepareVideo(video, item);
      }

      const footer = document.createElement('div');
      footer.className = `${APP}-footer`;
      footer.innerHTML = mediaActions(item, type === 'images');

      card.append(thumb, footer);
      grid.append(card);
    });

    grid.addEventListener('click', event => {
      const thumb = event.target.closest('[data-viewer-index]');
      if (thumb) {
        openViewer(Number(thumb.dataset.viewerIndex));
        return;
      }

      const postButton = event.target.closest('[data-action="post"]');
      if (postButton) goToPost(postButton.dataset.post);
    });

    return grid;
  }

  function renderLinks() {
    resetVideoObserver();
    const items = sorted('links');
    if (!items.length) return `<div class="${APP}-empty">Ссылок нет</div>`;

    const list = document.createElement('div');
    list.className = `${APP}-links`;

    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = `${APP}-link`;
      card.innerHTML = `
        <div class="${APP}-linkrow">
          <div class="${APP}-linktext">
            <div class="${APP}-host">${escapeHtml(item.host)}</div>
            <a class="${APP}-url" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a>
          </div>
          <div class="${APP}-linkactions">
            <a class="${APP}-small" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Открыть</a>
            <button class="${APP}-small" data-action="post" data-post="${escapeHtml(item.postNum)}">#${escapeHtml(item.postNum)}</button>
            <button class="${APP}-small" data-action="message" data-index="${index}">Сообщение</button>
          </div>
        </div>
        <div class="${APP}-message" hidden></div>`;
      list.append(card);
    });

    list.addEventListener('click', event => {
      const postButton = event.target.closest('[data-action="post"]');
      if (postButton) {
        goToPost(postButton.dataset.post);
        return;
      }

      const messageButton = event.target.closest('[data-action="message"]');
      if (!messageButton) return;

      const item = items[Number(messageButton.dataset.index)];
      const box = messageButton.closest(`.${APP}-link`).querySelector(`.${APP}-message`);
      if (!box.hidden) {
        box.hidden = true;
        return;
      }

      box.innerHTML = '';
      box.append(item.messageEl.cloneNode(true));
      box.hidden = false;
    });

    return list;
  }

  function render() {
    if (state.dirty) scan();

    $$(`.${APP}-tabs [data-section]`).forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.section === state.section);
    });

    $(`#${APP}-sort-label`).textContent = state.sort === 'newest' ? 'новые' : 'старые';

    const content = $(`#${APP}-content`);
    content.replaceChildren();

    const view = state.section === 'links'
      ? renderLinks()
      : renderMedia(state.section);

    if (typeof view === 'string') content.innerHTML = view;
    else content.append(view);
  }

  function goToPost(number) {
    closeHub();
    const post = $(`#post-${CSS.escape(number)}`);
    if (!post) {
      location.hash = number;
      return;
    }

    history.replaceState(null, '', `#${number}`);
    post.scrollIntoView({ behavior: 'smooth', block: 'center' });
    post.classList.remove(`${APP}-flash`);
    void post.offsetWidth;
    post.classList.add(`${APP}-flash`);
  }

  function ensureViewer() {
    if ($(`#${APP}-viewer`)) return;

    const viewer = document.createElement('div');
    viewer.id = `${APP}-viewer`;
    viewer.hidden = true;
    viewer.innerHTML = `<div id="${APP}-stage"></div>`;
    document.body.append(viewer);

    viewer.addEventListener('mousedown', event => {
      const stage = $(`#${APP}-stage`);
      if (event.target === viewer || event.target === stage) closeViewer();
    });
  }

  function openViewer(index) {
    ensureViewer();
    state.viewerIndex = index;
    $(`#${APP}-viewer`).hidden = false;
    showViewerItem();
  }

  function closeViewer() {
    const viewer = $(`#${APP}-viewer`);
    if (!viewer || viewer.hidden) return;

    const video = $(`#${APP}-stage video`);
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    viewer.hidden = true;
    $(`#${APP}-stage`).replaceChildren();
  }

  function stepViewer(step) {
    if (!state.viewer.length) return;
    state.viewerIndex = (state.viewerIndex + step + state.viewer.length) % state.viewer.length;
    showViewerItem();
  }

  function showViewerItem() {
    const item = state.viewer[state.viewerIndex];
    if (!item) return;

    const stage = $(`#${APP}-stage`);
    stage.replaceChildren();

    if (VIDEO_RE.test(item.url)) {
      const video = document.createElement('video');
      video.src = item.url;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'metadata';
      stage.append(video);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = '';
      stage.append(img);
    }
  }

  function scheduleScan() {
    state.dirty = true;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      addTab();
      const hub = $(`#${APP}-backdrop`);
      if (hub && !hub.hidden) {
        scan();
        render();
      }
    }, 250);
  }

  document.addEventListener('keydown', event => {
    const viewer = $(`#${APP}-viewer`);
    if (viewer && !viewer.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeViewer();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepViewer(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepViewer(1);
      }
      return;
    }

    const hub = $(`#${APP}-backdrop`);
    if (hub && !hub.hidden && event.key === 'Escape') {
      event.preventDefault();
      closeHub();
    }
  });

  GM_addStyle(`
    html.${APP}-locked, html.${APP}-locked body { overflow: hidden !important; }
    #${APP}-backdrop[hidden], #${APP}-viewer[hidden] { display: none !important; }

    #${APP}-backdrop {
      --bg: #0f1c26;
      --panel: #101f2a;
      --border: #29404f;
      --soft-border: #213542;
      --text: #c8d1d8;
      --muted: #82929d;
      --accent: #e66f00;
      --accent-hover: #ff7b00;

      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(5, 11, 16, .76);
    }

    #${APP}-panel {
      width: min(1520px, 97vw);
      height: min(920px, 94vh);
      display: grid;
      grid-template-rows: auto 1fr;
      overflow: hidden;
      color: var(--text);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 3px;
      box-shadow: 0 10px 34px rgba(0, 0, 0, .48);
      font: 13px/1.4 Arial, Helvetica, sans-serif;
    }

    .${APP}-nav {
      min-height: 39px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 5px 9px;
      background: var(--panel);
      border-bottom: 1px solid var(--soft-border);
    }

    .${APP}-tabs { display: flex; align-items: center; gap: 2px; }

    .${APP}-nav button {
      border: 0;
      border-radius: 1px;
      padding: 6px 9px;
      color: var(--text);
      background: transparent;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }

    .${APP}-nav button:hover,
    .${APP}-nav button.is-active { color: var(--accent); }
    .${APP}-nav button span { margin-left: 3px; color: var(--muted); font-weight: 400; }

    .${APP}-sort {
      display: inline-flex !important;
      align-items: baseline;
      gap: 4px;
      color: var(--muted) !important;
      font: 11px Arial, Helvetica, sans-serif !important;
      font-weight: 400 !important;
    }
    .${APP}-sort b { color: var(--accent); }
    .${APP}-sort:hover b { color: var(--accent-hover); }

    #${APP}-content {
      overflow: auto;
      overscroll-behavior: contain;
      padding: 8px;
      background: var(--bg);
      scrollbar-gutter: stable;
    }
    #${APP}-content::-webkit-scrollbar { width: 12px; height: 12px; }
    #${APP}-content::-webkit-scrollbar-track { background: #0d1821; }
    #${APP}-content::-webkit-scrollbar-thumb { background: #4a545b; border: 2px solid #0d1821; }

    .${APP}-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px 8px;
      align-items: start;
    }

    .${APP}-card { min-width: 0; }

    .${APP}-thumb {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 4 / 3;
      padding: 0;
      border: 0;
      overflow: hidden;
      cursor: pointer;
      background: var(--bg);
    }

    .${APP}-thumb img,
    .${APP}-video-preview {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: contain;
    }

    .${APP}-video-preview {
      position: absolute;
      inset: 0;
      opacity: 0;
      background: var(--bg);
    }
    .${APP}-video-preview.is-ready { opacity: 1; }

    .${APP}-footer { padding: 5px 0 2px; }
    .${APP}-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .${APP}-action {
      appearance: none;
      margin: 0;
      padding: 2px 3px;
      border: 0;
      border-radius: 0;
      color: var(--text) !important;
      background: transparent;
      cursor: pointer;
      text-decoration: none !important;
      font: 11px/1.35 Arial, Helvetica, sans-serif;
    }
    .${APP}-action:hover { color: var(--accent-hover) !important; }

    .${APP}-icon {
      width: 20px;
      height: 20px;
      padding: 0;
      display: inline-grid;
      place-items: center;
    }
    .${APP}-icon svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }

    .${APP}-links { display: grid; gap: 5px; }
    .${APP}-link {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 2px;
      background: #182b39;
    }
    .${APP}-linkrow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 8px 9px;
    }
    .${APP}-linktext { min-width: 0; }
    .${APP}-host { margin-bottom: 2px; color: #9eb0ba; font-weight: 700; font-size: 11px; }
    .${APP}-url {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--accent) !important;
      text-decoration: none;
    }
    .${APP}-url:hover { color: var(--accent-hover) !important; text-decoration: underline; }
    .${APP}-linkactions { display: flex; align-items: center; gap: 5px; }
    .${APP}-small {
      padding: 3px 5px;
      border: 1px solid #334b5a;
      border-radius: 2px;
      color: var(--text) !important;
      background: #142632;
      cursor: pointer;
      text-decoration: none !important;
      font: 11px/1.35 Arial, Helvetica, sans-serif;
    }
    .${APP}-small:hover { color: var(--accent-hover) !important; }
    .${APP}-message {
      padding: 9px 10px;
      border-top: 1px solid var(--soft-border);
      color: var(--text);
      background: #142632;
    }
    .${APP}-message .post__message { margin: 0 !important; padding: 0 !important; color: inherit !important; }
    .${APP}-empty { padding: 42px 20px; text-align: center; color: var(--muted); }

    #${APP}-viewer {
      position: fixed;
      inset: 0;
      z-index: 2147483640;
      background: rgba(4, 8, 11, .97);
    }
    #${APP}-stage {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      padding: 12px;
      box-sizing: border-box;
      overflow: auto;
    }
    #${APP}-stage img,
    #${APP}-stage video {
      display: block;
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: calc(100vh - 24px);
      object-fit: contain;
    }

    .${APP}-flash { animation: ${APP}-flashanim 1.5s ease; }
    @keyframes ${APP}-flashanim {
      0%, 35% { outline: 2px solid #e66f00; outline-offset: 2px; }
      100% { outline-color: transparent; }
    }

    @media (max-width: 1200px) {
      .${APP}-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    }
    @media (max-width: 980px) {
      .${APP}-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      #${APP}-backdrop { padding: 5px; }
      #${APP}-panel { width: 100%; height: 97vh; }
      .${APP}-nav { align-items: stretch; flex-direction: column; gap: 5px; }
      .${APP}-sort { align-self: flex-end; }
      .${APP}-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .${APP}-linkrow { grid-template-columns: 1fr; }
      .${APP}-linkactions { justify-content: flex-start; }
    }
    @media (max-width: 500px) {
      .${APP}-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `);

  addTab();
  ensureHub();

  const observer = new MutationObserver(records => {
    const changed = records.some(record => [...record.addedNodes].some(node => (
      node instanceof Element && (
        node.matches?.('.post, [id^="post-"], .bb__tabs') ||
        node.querySelector?.('.post, [id^="post-"], .bb__tabs')
      )
    )));

    if (changed) scheduleScan();
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();