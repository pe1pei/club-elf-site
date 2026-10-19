// 公開ページ（トップ / 求人）の描画。
// 通常は /api/site を読んで描画し、?preview=1 のときは管理画面から届く下書きデータで描画する。
(() => {
  'use strict';
  const app = document.getElementById('app');
  const PAGE = document.body.dataset.page; // 'index' | 'recruit'
  const PREVIEW = new URLSearchParams(location.search).has('preview');
  let site = null;
  let castFilter = 'all';
  let job = location.hash === '#staff' ? 'staff' : 'cast';
  let slideTimer = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ---------- 日本語の折り返し ----------
  // 単語の区切りにだけ <wbr> を入れ、CSS（word-break: keep-all）で単語の途中では改行させない。
  // 描画後のページ全体の文字に自動でかけるので、どの欄の文章でも同じルールになる（wrapJa）。
  // 区切りはブラウザ標準の Intl.Segmenter（iPhone/Android とも対応）。細かく切れすぎるので次は前後とつなげる：
  //  助詞・語尾（で／ます）、句読点・閉じ括弧、開き括弧の次、1文字の漢字（静岡＋県、日＋払い）、
  //  複合動詞（立ち＋寄る）、接頭の「お／ご」は次の語へ、数字・英字は隣の文字と（歩いて3分、一番町11-14、第二KOHWAビル）
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
  const KANJI = /[㐀-鿿]/;
  const ALNUM = /[0-9A-Za-z０-９Ａ-Ｚａ-ｚ]/;
  function jpChunks(s) {
    const out = [];
    let prefix = '';
    for (let { segment } of segmenter.segment(s)) {
      if (/^[おご]$/.test(segment)) { prefix += segment; continue; }
      segment = prefix + segment;
      prefix = '';
      const prev = out[out.length - 1];
      const last = prev === undefined ? '' : prev.slice(-1);
      const glue = prev !== undefined && (
        /^[ぁ-ゟ]{1,3}$/.test(segment)                                 // 助詞・語尾
        || /^[、。，．！？!?）」』】・…ー〜:：%％\s]+$/.test(segment)          // 句読点・閉じ括弧・空白（ノーブレークスペース含む）
        || /[「『（【(\u00a0]$/.test(prev)                                     // 開き括弧の次
        || (segment.length === 1 && KANJI.test(segment) && KANJI.test(last))   // 静岡＋県
        || (prev.length === 1 && KANJI.test(prev) && (KANJI.test(segment[0]) || ALNUM.test(segment[0]))) // 日＋払い、週＋1日
        || (/^[㐀-鿿][ぁ-ゟ]$/.test(prev) && KANJI.test(segment[0])) // 立ち＋寄り
        || (ALNUM.test(segment[0]) && last !== '' && !/\s/.test(last))         // 歩いて＋3分、一番町＋11-14
        || (ALNUM.test(last) && !/^\s/.test(segment))                          // 3＋分、KOHWA＋ビル、OK＋です
      );
      if (glue) out[out.length - 1] += segment; else out.push(segment);
    }
    if (prefix) out.push(prefix);
    return out;
  }
  // 「1SET 60分 4,000円」や「ビル B1」「2F」のような短い英数字の前後の空白は改行させない（ノーブレークスペースに）
  const keepNumbers = (s) => s
    .replace(/([0-9A-Za-z%％円分])[ ](?=[0-9A-Za-z¥￥])/g, '$1\u00a0')
    .replace(/[ ](?=[0-9A-Za-z]{1,3}(?:[\s／/]|$))/g, '\u00a0');
  function wrapJa(root) {
    if (!segmenter || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.data.length < 4 || !/[぀-ヿ㐀-鿿]/.test(n.data)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        return !p || p.closest('script, style, svg, textarea, input') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const chunks = jpChunks(keepNumbers(n.data));
      if (chunks.length < 2 && !n.data.includes(' ')) continue;
      const frag = document.createDocumentFragment();
      chunks.forEach((c, i) => { if (i) frag.append(document.createElement('wbr')); frag.append(c); });
      n.replaceWith(frag);
    }
  }
  // 文章は描画後に wrapJa で区切るので、ここではエスケープと改行だけ
  const jp = (s) => esc(s);
  const nl = (s) => String(s ?? '').split('\n').map(esc).join('<br>');
  const safeUrl = (u) => {
    u = String(u ?? '').trim();
    if (!u) return '';
    if (/^(https?:|tel:|mailto:)/i.test(u) || /^\/(?!\/)/.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '';
    return 'https://' + u;
  };
  // 画像: サーバー保存分（uploads/…）と、お試しモードでブラウザ内に持つ data:image を許可
  // サイト同梱の画像（logo-horizontal.png など）も相対パスのまま使う
  const imgUrl = (u) => (/^data:image\/(png|jpeg|webp|gif);base64,/.test(u) || /^\/?uploads\//.test(u) || /^[\w-]+\.(png|jpe?g|webp|gif|svg)$/i.test(u) ? u : safeUrl(u));
  // 写真未登録のキャストは店のロゴ画像を出す
  const NO_PHOTO = 'no-photo.jpg';
  const photoImg = (c, alt, lazy) => c.photo
    ? `<img src="${esc(imgUrl(c.photo))}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''}>`
    : `<img class="no-photo" src="${NO_PHOTO}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''}>`;
  const cssUrl = (u) => imgUrl(u).replace(/["'()\\\s]/g, encodeURIComponent);
  const telNo = (p) => String(p || '').replace(/[^\d+]/g, '');

  // ---------- 出勤 ----------
  // 日付は "YYYY-MM-DD"。深夜営業なので dayStart 時（既定 6時）までは前日扱いにする。
  let schedDay = 0;
  const DOW = '日月火水木金土';
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const todayKey = (s) => keyOf(new Date(Date.now() - (Number(s.shift?.dayStart) || 0) * 3600e3));
  const dayLabel = (k) => { const d = parseKey(k); return { md: `${d.getMonth() + 1}/${d.getDate()}`, dow: DOW[d.getDay()], w: d.getDay() }; };
  const shiftOn = (s) => s.shift?.enabled === true; // 明示的に ON にしたときだけ出勤情報を出す
  const shiftOf = (s, key, id) => s.shifts?.[key]?.[id] || '';

  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>'),
    instagram: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>'),
    x: svg('<path d="M4 4h4.5L20 20h-4.5zM20 4l-6.6 7.3M4 20l6.6-7.3"/>'),
    tiktok: svg('<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.6 2.4 4.5 5 4.6"/>'),
    line: svg('<path d="M12 4C7 4 3 7.1 3 11c0 3.3 2.9 6.1 6.8 6.8L9.5 21l4-3.1C17.8 17.4 21 14.5 21 11c0-3.9-4-7-9-7z"/>'),
    youtube: svg('<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>'),
    web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  };
  const SNS_LABEL = { instagram: 'Instagram', x: 'X', tiktok: 'TikTok', line: 'LINE', youtube: 'YouTube', web: 'Web' };

  // キャストごとの SNS。管理画面では URL でも「@ID」だけでも入れられるので、ID は各 SNS の URL に直す
  const CAST_SNS = ['instagram', 'tiktok', 'x', 'line', 'web'];
  function castSnsUrl(type, v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    const id = v.replace(/^@/, '');
    if (/^[\w.~-]+$/.test(id)) {
      if (type === 'instagram') return `https://www.instagram.com/${id}/`;
      if (type === 'tiktok') return `https://www.tiktok.com/@${id}`;
      if (type === 'x') return `https://x.com/${id}`;
      if (type === 'line' && !id.includes('.')) return `https://line.me/ti/p/~${id}`;
    }
    return safeUrl(v);
  }
  function castSns(c) {
    const links = CAST_SNS.map((t) => [t, castSnsUrl(t, c.sns?.[t])]).filter(([, u]) => u);
    if (!links.length) return '';
    return `<div class="cast-sns">${links.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${esc(c.name)} の ${SNS_LABEL[t]}">${ICON[t]}</a>`).join('')}</div>`;
  }

  // 各パーツは HTML が変わったときだけ差し替える（地図の再読込やスライドのリセットを防ぐ）
  function patch(name, html) {
    const el = app.querySelector(`[data-part="${name}"]`);
    if (el && el._html !== html) { el.innerHTML = html; el._html = html; wrapJa(el); return true; }
    return false;
  }

  // 同じビルに複数店舗があると住所だけでは候補一覧になりピンが立たないので、
  // 検索ワード（店名＋住所）を優先する。無ければ郵便番号を除いた住所。
  const mapQuery = (shop) => String(shop.mapQuery || '').trim()
    || String(shop.address || '').replace(/〒?s*d{3}-?d{4}s*/, '').trim();

  function mapSrc(shop) {
    const raw = String(shop.mapEmbed || '').trim();
    const m = raw.match(/src="([^"]+)"/);
    const s = (m ? m[1] : raw).replace(/&amp;/g, '&');
    if (/^https:\/\/(www\.)?google\.[a-z.]+\/maps/.test(s) || /^https:\/\/maps\.google\./.test(s)) return s;
    const q = mapQuery(shop);
    if (!q) return '';
    return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=17&hl=ja&output=embed`;
  }

  const recruitOn = (s) => ['cast', 'staff'].filter((k) => s.recruit?.[k]?.enabled);

  // ---------- 共通パーツ ----------
  function headerHTML(s) {
    const top = PAGE === 'index' ? '' : './';
    const links = [['cast', 'CAST']];
    if (shiftOn(s)) links.push(['schedule', 'SCHEDULE']);
    links.push(['info', 'INFO'], ['access', 'ACCESS']);
    if ((s.branches || []).some((b) => b.name)) links.push(['branches', 'SHOPS']);
    const tel = telNo(s.shop.phone);
    return `<header class="hd">
      <a href="${top}#top" class="logo">${esc(s.shop.name)}</a>
      <nav>${links.map(([id, l]) => `<a href="${top}#${id}">${l}</a>`).join('')}${recruitOn(s).length ? '<a href="recruit.html">RECRUIT</a>' : ''}</nav>
      ${tel ? `<a class="hd-tel" href="tel:${tel}" aria-label="電話する">${ICON.phone}<span>${esc(s.shop.phone)}</span></a>` : ''}
    </header>`;
  }

  function footerHTML(s) {
    const sns = (s.sns || []).filter((x) => safeUrl(x.url));
    return `<footer class="ft" id="footer">
      ${sns.length ? `<p class="ft-follow">FOLLOW US</p><ul class="sns">${sns.map((x) => `<li><a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener" aria-label="${esc(SNS_LABEL[x.type] || 'Link')}">${ICON[x.type] || ICON.web}<span>${esc(SNS_LABEL[x.type] || 'Link')}</span></a></li>`).join('')}</ul>` : ''}
      <p class="ft-name">${esc(s.shop.name)}</p>
      <p class="ft-addr">${esc(s.shop.address)}${s.shop.phone ? ` ／ TEL ${esc(s.shop.phone)}` : ''}</p>
      ${recruitOn(s).length && PAGE === 'index' ? '<p class="ft-links"><a href="recruit.html">求人情報</a></p>' : ''}
      ${PAGE !== 'index' ? '<p class="ft-links"><a href="./">トップページへ</a></p>' : ''}
      <small>&copy; ${new Date().getFullYear()} ${esc(s.shop.name)}</small>
    </footer>`;
  }

  function callBarHTML(phone, label) {
    const tel = telNo(phone);
    return tel ? `<a class="call-bar" href="tel:${tel}">${ICON.phone}<span>${esc(label)}</span></a>` : '';
  }

  const title = (en, ja) => `<h2 class="sec-title"><span>${en}</span><small>${ja}</small></h2>`;

  // ---------- トップページ ----------
  function heroHTML(s) {
    const h = s.hero || {};
    const imgs = (h.images || []).filter(Boolean);
    return `<section class="hero" id="top">
      <div class="slides">${imgs.length
        ? imgs.map((src, i) => `<div class="slide${i ? '' : ' on'}" style="background-image:url('${cssUrl(src)}')"></div>`).join('')
        : '<div class="slide slide-ph on"></div>'}</div>
      <div class="hero-shade"></div>
      <div class="hero-text">
        ${s.shop.kana ? `<p class="hero-kana">${esc(s.shop.kana)}</p>` : ''}
        ${h.logo
          ? `<h1 class="hero-logo"><img src="${esc(imgUrl(h.logo))}" alt="${esc(s.shop.name)}"></h1>`
          : `<h1>${esc(s.shop.name)}</h1>`}
        ${h.catch ? `<p class="hero-catch">${jp(h.catch)}</p>` : ''}
        ${h.sub ? `<p class="hero-sub">${nl(h.sub)}</p>` : ''}
      </div>
      <a class="scroll-cue" href="#cast">SCROLL</a>
    </section>`;
  }

  function castList(s) {
    const casts = (s.casts || []).filter((c) => c.visible !== false);
    const on = shiftOn(s);
    const tk = todayKey(s);
    const today = on ? casts.filter((c) => shiftOf(s, tk, c.id)) : [];
    if (!on) castFilter = 'all';
    return { casts, today, on, tk, list: castFilter === 'today' ? today : casts };
  }

  function castHTML(s) {
    const { casts, today, on, tk, list } = castList(s);
    const layout = s.theme?.castLayout || 'coverflow';
    const badge = (c) => (on && shiftOf(s, tk, c.id) ? `<span class="badge">本日出勤 ${esc(shiftOf(s, tk, c.id))}</span>` : '');
    let body;
    if (!list.length) {
      body = `<p class="empty">${castFilter === 'today' ? '本日の出勤情報は準備中です' : 'キャスト情報は準備中です'}</p>`;
    } else if (layout === 'grid' || layout === 'strip') {
      // 格子 / 横スクロール（CSS だけで並べる）
      body = `<div class="${layout === 'grid' ? 'cast-grid' : 'cast-strip'}">${list.map((c) => `
        <div class="cast-card">
          <button class="cast" data-id="${esc(c.id)}">
            <div class="ph">${photoImg(c, c.name, true)}${badge(c)}</div>
            <p class="nm">${esc(c.name)}</p>
          </button>
          ${castSns(c)}
          ${c.profile ? `<p class="pf">${esc(c.profile)}</p>` : ''}
          ${(c.tags || []).length ? `<p class="tags">${c.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
        </div>`).join('')}</div>`;
    } else {
      // カルーセル系（coverflow / tilt / fan）：中央の1枚を強調。位置は layoutCF() が JS で付ける
      body = `<div class="cf cf-${esc(layout)}" data-mode="${esc(layout)}" tabindex="0" aria-roledescription="カルーセル" aria-label="キャスト紹介（左右キーで切り替え）">
        <div class="cf-stage">${list.map((c, i) => `
          <button class="cf-item" data-i="${i}" data-id="${esc(c.id)}" aria-label="${esc(c.name)}">
            <div class="ph">${photoImg(c, c.name, i > 4)}${badge(c)}</div>
          </button>`).join('')}</div>
        ${list.length > 1 ? '<button class="cf-nav prev" data-cf="-1" aria-label="前のキャスト">‹</button><button class="cf-nav next" data-cf="1" aria-label="次のキャスト">›</button>' : ''}
      </div>
      <div class="cf-caption" aria-live="polite"></div>`;
    }
    return `<section class="sec" id="cast">
      ${title('CAST', 'キャスト紹介')}
      ${on ? `<div class="filter" role="tablist">
        <button data-f="all" class="${castFilter === 'all' ? 'on' : ''}">ALL <small>${casts.length}</small></button>
        <button data-f="today" class="${castFilter === 'today' ? 'on' : ''}">本日出勤 <small>${today.length}</small></button>
      </div>` : ''}
      ${body}
    </section>`;
  }

  // ---------- カバーフロー ----------
  // 位置は小数で持てるようにして、スワイプ中は指に合わせて連続的に動かす（cfPos）。離したら最寄りの1枚に吸着する。
  let cfIndex = 0;
  let cfTimer = null;
  let cfHover = false;
  let cfDrag = null;      // スワイプ中の状態
  let cfSwiped = 0;       // スワイプ直後のクリックを無視するための時刻
  let cfCaptionId = '';   // 表示中のキャプション（変わったときだけふわっと出す）
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // 1枚ぶん進むのに必要な指の移動量（px）。モードごとのずらし幅に合わせる
  function cfStep(mode, gap) {
    if (mode === 'fan') return gap * 0.6;
    if (mode === 'tilt') return gap * 0.8;
    return gap;
  }
  function cfGap(items) { return items[0].offsetWidth * (innerWidth < 600 ? 0.42 : 0.55); }

  function layoutCF(pos = cfIndex) {
    const items = app.querySelectorAll('.cf-item');
    const n = items.length;
    if (!n) return;
    const dragging = pos !== cfIndex;
    if (!dragging) { cfIndex = ((cfIndex % n) + n) % n; pos = cfIndex; }
    const gap = cfGap(items);
    const mode = app.querySelector('.cf').dataset.mode;
    const center = ((Math.round(pos) % n) + n) % n;
    items.forEach((el, i) => {
      let d = i - pos;
      if (n > 2) d -= n * Math.round(d / n); // 端から端へ回り込む
      const a = Math.abs(d);
      const near = Math.min(a, 1); // 0（中央）〜1（隣）
      el.style.transform = cfTransform(mode, d, a, near, gap);
      el.style.zIndex = String(1000 - Math.round(a * 100));
      el.style.opacity = a > 3.5 ? '0' : a > 3 ? String((3.5 - a) * 2) : '1';
      const bright = a < 1 ? 1 - near * 0.38 : Math.max(0.3, 0.62 - (a - 1) * 0.12);
      el.style.filter = bright >= 0.999 ? 'none' : `brightness(${bright.toFixed(3)}) saturate(${(1 - near * 0.2).toFixed(3)})`;
      el.style.pointerEvents = a > 3 ? 'none' : '';
      el.tabIndex = -1;
      if (!dragging) {
        el.classList.toggle('on', i === center); // on が付いた瞬間に「ふわっ」と出るアニメーションが走る
        el.setAttribute('aria-hidden', i === center ? 'false' : 'true');
      }
    });
    if (dragging) return;
    const c = (site.casts || []).find((x) => x.id === items[center].dataset.id);
    const cap = app.querySelector('.cf-caption');
    if (c && cap) {
      cap.innerHTML = `<p class="cf-count">${center + 1} / ${n}</p>
        <p class="nm">${esc(c.name)}</p>
        ${castSns(c)}
        ${c.profile ? `<p class="pf">${esc(c.profile)}</p>` : ''}
        ${(c.tags || []).length ? `<p class="tags">${c.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
        <button class="cf-more" data-open="${esc(c.id)}">PROFILE <span aria-hidden="true">→</span></button>`;
      wrapJa(cap);
      if (cfCaptionId !== c.id) {
        cfCaptionId = c.id;
        cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap'); // アニメーションをかけ直す
      }
    }
  }

  // d: 中央からの位置（左が負・小数あり）、a: その絶対値、near: 0〜1 に丸めた a、gap: 隣とのずらし幅
  function cfTransform(mode, d, a, near, gap) {
    const base = 'translateX(-50%) ';
    const s = Math.sign(d);
    if (mode === 'tilt') {
      // 3D回転：両隣を斜めに傾けて奥へ
      const x = d * gap * 0.38 + s * gap * 0.55 * near;
      const z = a < 1 ? 40 - 210 * a : -140 - a * 30;
      return base + `translateX(${x.toFixed(1)}px) translateZ(${z.toFixed(1)}px) rotateY(${(-s * 48 * near).toFixed(2)}deg)`;
    }
    if (mode === 'fan') {
      // 扇形：下端を軸にトランプのように広げる
      const y = a < 1 ? -18 + 24 * a : a * 6;
      return base + `translateX(${(d * gap * 0.32).toFixed(1)}px) translateY(${y.toFixed(1)}px) rotate(${(d * 9).toFixed(2)}deg) scale(${(1 - 0.08 * near).toFixed(3)})`;
    }
    // coverflow：重ねて中央を浮かせる
    const scale = a < 1 ? 1 - 0.16 * a : Math.max(0.58, 0.84 - (a - 1) * 0.1);
    return base + `translateX(${(d * gap).toFixed(1)}px) translateY(${(-12 * (1 - near)).toFixed(1)}px) scale(${scale.toFixed(3)})`;
  }

  function cfGo(step) { cfIndex += step; layoutCF(); restartCF(); }

  function restartCF() {
    clearInterval(cfTimer);
    if (!site || site.theme?.castAutoplay === false || reduceMotion.matches) return;
    if (app.querySelectorAll('.cf-item').length < 2) return;
    cfTimer = setInterval(() => {
      if (!cfHover && !cfDrag && !document.hidden && !document.querySelector('dialog[open]')) { cfIndex += 1; layoutCF(); }
    }, 4500);
  }


  function scheduleHTML(s) {
    if (!shiftOn(s)) return '';
    const tk = todayKey(s);
    const days = Array.from({ length: 7 }, (_, i) => addDays(tk, i));
    const key = days[schedDay];
    const list = (s.casts || []).filter((c) => c.visible !== false && shiftOf(s, key, c.id));
    return `<section class="sec" id="schedule">
      ${title('SCHEDULE', '出勤情報')}
      <div class="days" role="tablist">${days.map((k, i) => {
        const l = dayLabel(k);
        return `<button data-day="${i}" class="${i === schedDay ? 'on' : ''} ${l.w === 0 ? 'sun' : l.w === 6 ? 'sat' : ''}"><b>${l.md}</b><small>${i === 0 ? '今日' : ''}（${l.dow}）</small></button>`;
      }).join('')}</div>
      ${list.length ? `<div class="sched-list">${list.map((c) => `
        <button class="sc" data-id="${esc(c.id)}">
          <span class="sc-ph">${photoImg(c, '', true)}</span>
          <span class="sc-nm">${esc(c.name)}</span>
          <span class="sc-tm">${esc(shiftOf(s, key, c.id))}</span>
        </button>`).join('')}</div>`
        : '<p class="empty">この日の出勤情報は準備中です</p>'}
    </section>`;
  }

  // お店紹介文。検索されたい言葉（三島・キャバクラ など）を、見える自然な文章として載せる場所
  function aboutHTML(s) {
    const seo = s.seo || {};
    if (!seo.intro) return '';
    return `<section class="sec about" id="about">
      <h2 class="sec-title"><span>ABOUT</span><small>${esc(seo.introTitle || s.shop.name)}</small></h2>
      <p class="about-text">${nl(seo.intro)}</p>
    </section>`;
  }

  function infoHTML(s) {
    const sh = s.shop;
    const tel = telNo(sh.phone);
    return `<section class="sec" id="info">
      ${title('INFORMATION', '営業案内')}
      <div class="info">
        <div class="info-item">${ICON.clock}<h3>OPEN</h3><p>${nl(sh.hours) || '—'}</p></div>
        <div class="info-item">${ICON.cal}<h3>CLOSED</h3><p>${nl(sh.holiday) || '—'}</p></div>
        <div class="info-item">${ICON.phone}<h3>TEL</h3><p>${tel ? `<a class="tel-big" href="tel:${tel}">${esc(sh.phone)}</a>` : '—'}</p></div>
      </div>
      ${sh.note ? `<p class="note">${nl(sh.note)}</p>` : ''}
      ${systemHTML(s.system)}
    </section>`;
  }

  function systemHTML(sys) {
    const plans = (sys?.plans || [])
      .map((p) => ({ title: p.title, rows: (p.items || []).filter((i) => i.label || i.value) }))
      .filter((p) => p.rows.length);
    if (!plans.length) return '';
    return `<div class="system" id="system">
      <h3 class="sub-title">SYSTEM <small>料金システム</small></h3>
      ${plans.map((p) => `<div class="plan">
        ${p.title ? `<p class="plan-title">${esc(p.title)}</p>` : ''}
        <dl class="price">${p.rows.map((i) => `<div><dt>${esc(i.label)}</dt><dd>${nl(i.value)}</dd></div>`).join('')}</dl>
      </div>`).join('')}
      ${sys.note ? `<p class="note">${nl(sys.note)}</p>` : ''}
    </div>`;
  }

  function accessHTML(s) {
    const sh = s.shop;
    const src = mapSrc(sh);
    return `<section class="sec" id="access">
      ${title('ACCESS', 'アクセス')}
      <div class="access">
        <dl class="dl">
          <dt>店名</dt><dd>${esc(sh.name)}</dd>
          ${sh.address ? `<dt>住所</dt><dd>${nl(sh.address)}</dd>` : ''}
          ${sh.access ? `<dt>アクセス</dt><dd>${nl(sh.access)}</dd>` : ''}
          ${sh.phone ? `<dt>TEL</dt><dd><a href="tel:${telNo(sh.phone)}">${esc(sh.phone)}</a></dd>` : ''}
          ${sh.hours ? `<dt>営業時間</dt><dd>${nl(sh.hours)}</dd>` : ''}
          ${sh.holiday ? `<dt>定休日</dt><dd>${nl(sh.holiday)}</dd>` : ''}
        </dl>
        ${src ? `<div class="map"><iframe src="${esc(src)}" title="${esc(sh.name)} の地図" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
          ${mapQuery(sh) ? `<a class="map-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery(sh))}" target="_blank" rel="noopener">${ICON.pin} Googleマップで開く</a>` : ''}</div>` : ''}
      </div>
    </section>`;
  }

  function branchesHTML(s) {
    const list = (s.branches || []).filter((b) => b.name);
    if (!list.length) return '';
    return `<section class="sec" id="branches">
      ${title('SHOPS', '系列店舗')}
      <div class="branches">${list.map((b) => {
        const tel = telNo(b.phone), url = safeUrl(b.url);
        return `<article class="branch">
          ${b.area ? `<p class="area">${esc(b.area)}</p>` : ''}
          <h3>${esc(b.name)}</h3>
          ${b.address ? `<p>${ICON.pin}${esc(b.address)}</p>` : ''}
          ${tel ? `<p>${ICON.phone}<a href="tel:${tel}">${esc(b.phone)}</a></p>` : ''}
          ${url ? `<a class="more" href="${esc(url)}" target="_blank" rel="noopener">WEBSITE →</a>` : ''}
        </article>`;
      }).join('')}</div>
    </section>`;
  }

  function recruitBannerHTML(s) {
    const on = recruitOn(s);
    if (!on.length) return '';
    const label = { cast: ['CAST', 'キャスト募集'], staff: ['STAFF', 'スタッフ募集'] };
    return `<section class="sec" id="recruit-banner">
      ${title('RECRUIT', '求人情報')}
      <div class="rb">${on.map((k) => `<a class="rb-item" href="recruit.html#${k}"><span>${label[k][0]}</span><b>${label[k][1]}</b><small>${jp(s.recruit[k].catch)}</small><i>詳しく見る →</i></a>`).join('')}</div>
    </section>`;
  }

  // ---------- 求人ページ ----------
  function recruitHTML(s) {
    const on = recruitOn(s);
    if (!on.length) return `<section class="sec page-top"><p class="empty">現在、求人の募集は行っておりません。</p></section>`;
    if (!on.includes(job)) job = on[0];
    const r = s.recruit[job];
    const ap = s.recruit.apply || {};
    const tel = telNo(ap.phone), line = safeUrl(ap.line), mail = String(ap.email || '').trim();
    const label = { cast: 'キャスト募集', staff: 'スタッフ募集' };
    return `<section class="sec page-top" id="recruit">
      ${title('RECRUIT', '求人情報')}
      ${on.length > 1 ? `<div class="filter job-tabs">${on.map((k) => `<button data-job="${k}" class="${k === job ? 'on' : ''}">${label[k]}</button>`).join('')}</div>` : ''}
      <div class="job" id="${job}">
        ${r.catch ? `<p class="job-catch">${jp(r.catch)}</p>` : ''}
        ${r.body ? `<p class="job-body">${nl(r.body)}</p>` : ''}
        ${(r.perks || []).length ? `<ul class="perks">${r.perks.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        ${(r.items || []).filter((i) => i.label || i.value).length ? `<dl class="dl job-dl">${r.items.filter((i) => i.label || i.value).map((i) => `<dt>${esc(i.label)}</dt><dd>${nl(i.value)}</dd>`).join('')}</dl>` : ''}
      </div>
      <div class="apply" id="apply">
        <h3>応募・お問い合わせ</h3>
        ${ap.note ? `<p>${nl(ap.note)}</p>` : ''}
        <div class="apply-btns">
          ${line ? `<a class="btn-line" href="${esc(line)}" target="_blank" rel="noopener">${ICON.line}LINEで応募</a>` : ''}
          ${tel ? `<a class="btn-gold" href="tel:${tel}">${ICON.phone}${esc(ap.phone)}</a>` : ''}
          ${mail ? `<a class="btn-outline" href="mailto:${esc(mail)}?subject=${encodeURIComponent(`【${label[job]}】応募`)}">${ICON.mail}メールで応募</a>` : ''}
        </div>
      </div>
    </section>`;
  }

  // ---------- 描画 ----------
  function render(s) {
    site = s;
    s.shop = s.shop || {};
    const root = document.documentElement.style;
    root.setProperty('--accent', s.theme?.accent || '#c9a35a');
    root.setProperty('--bg', s.theme?.bg || '#0c0a0f');
    // 検索結果用のタイトル・説明（初期値はサーバー/書き出し時に HTML へ埋め込み済み。プレビュー用に追従させる）
    const seo = s.seo || {};
    document.title = PAGE === 'recruit'
      ? (seo.recruitTitle || `求人情報 | ${s.shop.name || ''}`)
      : (seo.title || `${s.shop.name || ''}${s.hero?.catch ? ' | ' + s.hero.catch : ''}`);
    const desc = PAGE === 'recruit' ? seo.recruitDescription : seo.description;
    let meta = document.querySelector('meta[name="description"]');
    if (desc) { if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.append(meta); } meta.content = desc; }

    const parts = PAGE === 'recruit'
      ? ['header', 'recruit', 'footer', 'callbar']
      : ['header', 'hero', 'cast', 'schedule', 'about', 'info', 'access', 'branches', 'recruitBanner', 'footer', 'callbar'];
    if (!app.firstElementChild) {
      app.innerHTML = parts.map((p) => `<div data-part="${p}"></div>`).join('') + '<dialog class="modal" id="castModal"></dialog>';
    }
    patch('header', headerHTML(s));
    patch('footer', footerHTML(s));
    if (PAGE === 'recruit') {
      patch('recruit', recruitHTML(s));
      const ap = s.recruit?.apply || {};
      patch('callbar', callBarHTML(ap.phone, '電話で応募する'));
    } else {
      if (patch('hero', heroHTML(s))) startSlides(s.hero?.interval);
      if (patch('cast', castHTML(s))) layoutCF();
      restartCF(); // 自動再生の ON/OFF 変更も反映
      patch('schedule', scheduleHTML(s));
      patch('about', aboutHTML(s));
      patch('info', infoHTML(s));
      patch('access', accessHTML(s));
      patch('branches', branchesHTML(s));
      patch('recruitBanner', recruitBannerHTML(s));
      patch('callbar', callBarHTML(s.shop.phone, '電話で問い合わせる'));
    }
    onScroll();
  }

  function startSlides(sec) {
    clearInterval(slideTimer);
    const slides = app.querySelectorAll('.slide');
    if (slides.length < 2) return;
    let i = 0;
    slideTimer = setInterval(() => {
      slides[i].classList.remove('on');
      i = (i + 1) % slides.length;
      slides[i].classList.add('on');
    }, Math.max(2, Number(sec) || 6) * 1000);
  }

  function openCast(id) {
    const c = (site.casts || []).find((x) => x.id === id);
    const dlg = document.getElementById('castModal');
    if (!c || !dlg) return;
    const on = shiftOn(site);
    const tk = todayKey(site);
    const week = on ? Array.from({ length: 7 }, (_, i) => addDays(tk, i)) : [];
    dlg.innerHTML = `<div class="modal-inner">
      <button class="modal-close" aria-label="閉じる">×</button>
      <div class="modal-ph">${photoImg(c, c.name, false)}</div>
      <div class="modal-body">
        ${on && shiftOf(site, tk, c.id) ? `<span class="badge static">本日出勤 ${esc(shiftOf(site, tk, c.id))}</span>` : ''}
        <h3>${esc(c.name)}</h3>
        ${castSns(c)}
        ${c.profile ? `<p class="pf">${esc(c.profile)}</p>` : ''}
        ${(c.tags || []).length ? `<p class="tags left">${c.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
        ${c.comment ? `<p class="comment">${nl(c.comment)}</p>` : ''}
        ${on ? `<p class="week-title">WEEKLY SCHEDULE</p><ul class="week">${week.map((k) => {
          const l = dayLabel(k), t = shiftOf(site, k, c.id);
          return `<li class="${t ? 'on' : ''} ${l.w === 0 ? 'sun' : l.w === 6 ? 'sat' : ''}"><b>${l.md}<small>${l.dow}</small></b><span>${t ? esc(t) : '−'}</span></li>`;
        }).join('')}</ul>` : ''}
      </div>
    </div>`;
    wrapJa(dlg);
    dlg.showModal();
  }

  function onScroll() {
    const hd = app.querySelector('.hd');
    if (hd) hd.classList.toggle('solid', PAGE !== 'index' || scrollY > 40);
  }

  app.addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { castFilter = f.dataset.f; cfIndex = 0; if (patch('cast', castHTML(site))) { layoutCF(); restartCF(); } return; }
    const nav = e.target.closest('[data-cf]');
    if (nav) { cfGo(Number(nav.dataset.cf)); return; }
    const more = e.target.closest('[data-open]');
    if (more) { openCast(more.dataset.open); return; }
    const cf = e.target.closest('.cf-item');
    if (cf) {
      if (Date.now() - cfSwiped < 300) return; // スワイプの指離しでクリック扱いにしない
      const i = Number(cf.dataset.i);
      if (i === cfIndex) openCast(cf.dataset.id); else { cfIndex = i; layoutCF(); restartCF(); }
      return;
    }
    const j = e.target.closest('[data-job]');
    if (j) { job = j.dataset.job; history.replaceState(null, '', PREVIEW ? location.search + '#' + job : '#' + job); patch('recruit', recruitHTML(site)); return; }
    const day = e.target.closest('[data-day]');
    if (day) { schedDay = Number(day.dataset.day); patch('schedule', scheduleHTML(site)); return; }
    const c = e.target.closest('.cast, .sc');
    if (c) { openCast(c.dataset.id); return; }
    const dlg = e.target.closest('dialog');
    if (dlg && (e.target === dlg || e.target.closest('.modal-close'))) { dlg.close(); return; }
    // プレビュー中に別ページへのリンクを押したら、管理画面側でタブを切り替える
    const a = e.target.closest('a[href]');
    if (PREVIEW && a && !a.target) {
      const u = new URL(a.href, location.href);
      if (u.origin === location.origin && u.pathname !== location.pathname) {
        e.preventDefault();
        parent.postMessage({ type: 'goto', page: u.pathname.includes('recruit') ? 'recruit' : 'index', hash: u.hash.slice(1) }, location.origin);
      }
    }
  });
  addEventListener('scroll', onScroll, { passive: true });
  // ロゴ画像が読めなかったときは、空枠ではなく店名の文字で出す
  app.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.closest('.hero-logo')) return;
    const h1 = img.closest('h1');
    h1.classList.remove('hero-logo');
    h1.textContent = img.alt;
  }, true);
  // スワイプ：指（マウス）の動きに合わせて連続で動かし、離したら勢いを見て最寄りの1枚に吸着
  app.addEventListener('pointerdown', (e) => {
    const stage = e.target.closest('.cf-stage');
    if (!stage || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const items = app.querySelectorAll('.cf-item');
    if (items.length < 2) return;
    const mode = app.querySelector('.cf').dataset.mode;
    cfDrag = { x: e.clientX, y: e.clientY, pos0: cfIndex, pos: cfIndex, step: cfStep(mode, cfGap(items)), moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 };
  });
  addEventListener('pointermove', (e) => {
    if (!cfDrag) return;
    const dx = e.clientX - cfDrag.x, dy = e.clientY - cfDrag.y;
    if (!cfDrag.moved) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { cfDrag = null; return; } // 縦スクロールは邪魔しない
      if (Math.abs(dx) < 6) return;
      cfDrag.moved = true;
      app.querySelector('.cf')?.classList.add('cf-dragging'); // 指に追従させるあいだはアニメーションを止める
    }
    const now = performance.now();
    const dt = Math.max(1, now - cfDrag.lastT);
    cfDrag.v = 0.8 * ((e.clientX - cfDrag.lastX) / dt) + 0.2 * cfDrag.v; // px/ms（なめらかにした速度）
    cfDrag.lastX = e.clientX; cfDrag.lastT = now;
    cfDrag.pos = cfDrag.pos0 - dx / cfDrag.step;
    layoutCF(cfDrag.pos === cfIndex ? cfDrag.pos + 1e-6 : cfDrag.pos);
  });
  const endDrag = () => {
    if (!cfDrag) return;
    const d = cfDrag;
    cfDrag = null;
    if (!d.moved) return; // ただのタップはクリック処理に任せる
    app.querySelector('.cf')?.classList.remove('cf-dragging');
    const fling = -(d.v * 180) / d.step;                          // 払った勢いのぶん先へ
    const jump = Math.max(-4, Math.min(4, Math.round(d.pos + fling - d.pos0)));
    cfIndex = d.pos0 + jump;
    cfSwiped = Date.now();
    layoutCF();
    restartCF();
  };
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);
  app.addEventListener('keydown', (e) => {
    if (!e.target.closest('.cf')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); cfGo(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); cfGo(-1); }
    if (e.key === 'Enter' && e.target.classList.contains('cf')) { const on = app.querySelector('.cf-item.on'); if (on) openCast(on.dataset.id); }
  });
  // マウスを乗せている間だけ自動再生を止める（スマホのタッチでは止めっぱなしにならないように）
  app.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') cfHover = !!e.target.closest('.cf'); });
  app.addEventListener('pointerleave', () => { cfHover = false; });
  let resizeT;
  addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(layoutCF, 120); });
  addEventListener('hashchange', () => {
    if (PAGE === 'recruit' && site && ['#cast', '#staff'].includes(location.hash)) { job = location.hash.slice(1); patch('recruit', recruitHTML(site)); }
  });

  // サーバーがあれば API から。GitHub Pages などサーバーなしの場合（お試しモード）は、
  // 管理画面でこのブラウザに保存した内容 → 同梱の site.json の順に読む。
  async function loadSite() {
    try {
      const r = await fetch('api/site', { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch { /* サーバーなし */ }
    try {
      const draft = localStorage.getItem('demo-site');
      if (draft) return JSON.parse(draft);
    } catch { /* ストレージ不可 */ }
    const r = await fetch('site.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('load failed');
    return r.json();
  }

  if (PREVIEW) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin) return;
      const d = e.data || {};
      if (d.type === 'site') render(d.site);
      if (d.type === 'scroll') {
        if (PAGE === 'recruit' && (d.id === 'cast' || d.id === 'staff') && site) { job = d.id; patch('recruit', recruitHTML(site)); }
        const el = d.id === 'top' ? document.body : document.getElementById(d.id);
        if (el) scrollTo({ top: d.id === 'top' ? 0 : el.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' });
      }
    });
    parent.postMessage({ type: 'ready', page: PAGE }, location.origin);
  } else {
    loadSite()
      .then((s) => {
        render(s);
        if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
      })
      .catch(() => { app.innerHTML = '<p class="empty" style="padding:40vh 16px">読み込みに失敗しました。時間をおいて再度お試しください。</p>'; });
  }
})();
