// 管理画面。左で編集 → 右の iframe（/?preview=1）に下書きを送って即時反映 → 「保存して公開」で確定。
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // 使う頻度の高い順に並べる
  const TABS = [
    { id: 'shift', label: '出勤', page: 'index', section: 'schedule' },
    { id: 'cast', label: 'キャスト', page: 'index', section: 'cast' },
    { id: 'coupon', label: 'クーポン', page: 'index', section: 'coupon' },
    { id: 'hero', label: 'トップ画像', page: 'index', section: 'top' },
    { id: 'price', label: '料金', page: 'index', section: 'system' },
    { id: 'recruit', label: '求人', page: 'recruit', section: 'recruit' },
    { id: 'stats', label: 'アクセス', page: 'index', section: 'top' },
    { id: 'shop', label: '店舗情報', page: 'index', section: 'info' },
    { id: 'branches', label: '支店', page: 'index', section: 'branches' },
    { id: 'sns', label: 'SNS', page: 'index', section: 'footer' },
    { id: 'seo', label: 'SEO', page: 'index', section: 'about' },
    { id: 'theme', label: 'デザイン', page: 'index', section: 'cast' },
    { id: 'account', label: 'アカウント', page: 'index', section: 'top' },
  ];
  const SNS_TYPES = [['instagram', 'Instagram'], ['x', 'X'], ['tiktok', 'TikTok'], ['line', 'LINE'], ['youtube', 'YouTube'], ['web', 'その他URL']];
  // キャストの見せ方。pic は選択カード用のミニ図（3枚のカードの位置）
  const LAYOUTS = [
    { id: 'coverflow', name: '重ねて中央を強調', desc: '少し重ねて並べ、真ん中が浮き上がる',
      pic: [[-26, 6, 0, .78, .45], [26, 6, 0, .78, .45], [0, 0, 0, 1, 1]] },
    { id: 'tilt', name: '3D回転', desc: '両隣が斜めに傾いて奥へ並ぶ',
      pic: [[-30, 4, 0, .8, .45, 52], [30, 4, 0, .8, .45, -52], [0, 0, 0, 1, 1]] },
    { id: 'fan', name: '扇形', desc: 'トランプのように広げる',
      pic: [[-14, 6, -16, .92, .55], [14, 6, 16, .92, .55], [0, -2, 0, 1, 1]] },
    { id: 'strip', name: '横スクロール', desc: '大きめの写真を指で横に流す',
      pic: [[-34, 0, 0, .9, 1], [0, 0, 0, .9, 1], [34, 0, 0, .9, 1]] },
    { id: 'grid', name: '格子', desc: '全員を一覧で見せる', grid: true },
  ];
  const layoutPic = (l) => l.grid
    ? `<span class="lp lp-grid">${'<i></i>'.repeat(6)}</span>`
    : `<span class="lp">${l.pic.map(([x, y, r, s, o, ry = 0]) => `<i style="transform:translateX(${x}px) translateY(${y}px) rotate(${r}deg) perspective(80px) rotateY(${ry}deg) scale(${s});opacity:${o}"></i>`).join('')}</span>`;

  const PRESETS = [
    { name: 'ゴールド × ブラック', accent: '#c9a35a', bg: '#0c0a0f' },
    { name: 'ローズ × ブラック', accent: '#d68aa5', bg: '#110a0e' },
    { name: 'シルバー × ネイビー', accent: '#c4ccd8', bg: '#0b1020' },
    { name: 'シャンパン × ワイン', accent: '#e3c58f', bg: '#1a0a10' },
    { name: 'ラベンダー × ナイト', accent: '#b9a3e3', bg: '#0f0b18' },
    { name: 'ホワイト × ブラック', accent: '#f2f2f2', bg: '#0a0a0a' },
  ];

  let site = null;
  let savedJSON = '';
  let tab = TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : 'shift';
  let recruitSub = 'cast'; // cast | staff | apply
  // 出勤タブの表示状態（保存しない）
  let shiftView = 'week'; // week | month
  let weekStart = '';     // 表示中の週の月曜 "YYYY-MM-DD"
  let monthCursor = '';   // 表示中の月 "YYYY-MM"
  let monthCast = '';     // 月入力の対象キャスト id
  let brush = '';         // クリックで入れる時間
  const openItems = new Set();
  let frameReady = false;
  let framePage = '';
  let pushTimer;

  const frame = $('#frame');
  const panel = $('#panel');
  // サーバーなし（GitHub Pages 等）で開かれたときは「お試しモード」：保存先はこのブラウザ内
  let DEMO = false;
  const DEMO_KEY = 'demo-site';
  // 保存データ内の画像パスはサイト直下基準なので、/admin/ から見るときは一つ上を指す
  const imgSrc = (u) => (/^(data:|https?:|\/)/.test(u) ? u : '../' + u);

  // ---------- 通信 ----------
  async function api(path, opts = {}) {
    const r = await fetch('..' + path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); throw new Error('ログインし直してください'); }
    if (!r.ok) throw new Error(data.error || `エラーが発生しました (${r.status})`);
    return data;
  }

  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', error);
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), error ? 4000 : 2200);
  }

  // ---------- 日付 ----------
  // 深夜営業なので dayStart 時（既定 6時）までは前日扱い。公開側 site.js と同じ規則。
  const DOW = '日月火水木金土';
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const todayKeyOf = (s) => keyOf(new Date(Date.now() - (Number(s.shift?.dayStart) || 0) * 3600e3));
  const todayKey = () => todayKeyOf(site);
  const mondayOf = (k) => addDays(k, -((parseKey(k).getDay() + 6) % 7));
  const shiftOf = (key, id) => site.shifts[key]?.[id] || '';
  function setShift(key, id, val) {
    if (val) (site.shifts[key] ||= {})[id] = val;
    else if (site.shifts[key]) { delete site.shifts[key][id]; if (!Object.keys(site.shifts[key]).length) delete site.shifts[key]; }
  }
  const shortTime = (t) => (t.match(/\d{1,2}:\d{2}/) || [t.slice(0, 3)])[0];
  const visibleCasts = () => site.casts.filter((c) => c.visible !== false);

  // ---------- データ ----------
  function normalize(s) {
    s.shop ||= {};
    s.hero ||= {}; s.hero.images ||= [];
    s.casts ||= []; s.branches ||= []; s.sns ||= [];
    s.theme ||= { accent: '#c9a35a', bg: '#0c0a0f' };
    s.theme.castLayout ||= 'coverflow';
    if (s.theme.castAutoplay === undefined) s.theme.castAutoplay = true;
    s.seo ||= {}; s.seo.keywords ||= [];
    s.coupon ||= { enabled: false, title: '', words: [], perks: [], note: '' };
    for (const k of ['words', 'perks']) { s.coupon[k] ||= []; s.coupon[k].forEach((x) => { x.id ||= uid(); if (x.on === undefined) x.on = true; }); }
    s.system ||= {};
    if (s.system.items) { s.system.plans = [{ title: '', items: s.system.items }]; delete s.system.items; }
    s.system.plans ||= [];
    s.system.plans.forEach((p) => { p.items ||= []; });
    s.shift ||= { enabled: false, defaultTime: '20:00〜', dayStart: 6 }; // 出勤情報は初期状態で非表示
    // サーバー側で空の {} が [] になっていても、入力が消えないよう入れ物の形を直す
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    s.shifts = obj(s.shifts);
    for (const k of Object.keys(s.shifts)) s.shifts[k] = obj(s.shifts[k]);
    // 旧形式（キャストごとの today フラグ）を日付ベースの出勤表へ移す
    const tk = todayKeyOf(s);
    for (const c of s.casts || []) {
      if (c.today) (s.shifts[tk] ||= {})[c.id || (c.id = uid())] = s.shift.defaultTime || '出勤';
      delete c.today;
    }
    s.recruit ||= {};
    for (const k of ['cast', 'staff']) {
      s.recruit[k] ||= { enabled: false, catch: '', body: '', items: [], perks: [] };
      s.recruit[k].items ||= []; s.recruit[k].perks ||= [];
    }
    s.recruit.apply ||= {};
    for (const c of s.casts) { c.id ||= uid(); c.tags ||= []; c.sns = obj(c.sns); if (c.visible === undefined) c.visible = true; }
    return s;
  }
  const getPath = (p) => p.split('.').reduce((o, k) => o?.[k], site);
  function setPath(p, v) {
    const keys = p.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], site)[last] = v;
  }

  function changed({ rerender = false } = {}) {
    if (rerender) renderPanel();
    const dirty = JSON.stringify(site) !== savedJSON;
    const st = $('#state');
    st.textContent = dirty ? '未保存の変更があります' : DEMO ? '保存済み' : '公開中の内容と同じです';
    st.classList.toggle('dirty', dirty);
    $('#save').disabled = !dirty;
    $('#discard').hidden = !dirty;
    $('#brand').textContent = `${site.shop.name || '店舗'} 管理画面`;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 250);
  }

  // ---------- プレビュー ----------
  function push() {
    if (frameReady) frame.contentWindow.postMessage({ type: 'site', site }, location.origin);
  }
  function previewTarget() {
    const t = TABS.find((x) => x.id === tab);
    const section = t.id === 'recruit' ? (recruitSub === 'apply' ? 'apply' : recruitSub) : t.section;
    return { page: t.page, section };
  }
  function syncPreview() {
    const { page, section } = previewTarget();
    if (page !== framePage) {
      framePage = page;
      frameReady = false;
      frame.src = (page === 'recruit' ? '../recruit.html' : '../') + '?preview=1';
      return; // ready を受けたら送る
    }
    push();
    frame.contentWindow?.postMessage({ type: 'scroll', id: section }, location.origin);
  }
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'ready') {
      frameReady = true;
      push();
      setTimeout(() => frame.contentWindow.postMessage({ type: 'scroll', id: previewTarget().section }, location.origin), 50);
    }
    if (d.type === 'goto') {
      if (d.page === 'recruit') { if (d.hash === 'staff' || d.hash === 'cast') recruitSub = d.hash; selectTab('recruit'); }
      else selectTab(TABS.find((t) => t.section === d.hash)?.id || 'cast');
    }
  });

  // ---------- タブ ----------
  function renderTabs() {
    $('#tabs').innerHTML = TABS.filter((t) => !(DEMO && ['account', 'stats', 'coupon'].includes(t.id))).map((t) => `<button data-tab="${t.id}" class="${t.id === tab ? 'on' : ''}">${t.label}</button>`).join('');
  }
  function selectTab(id) {
    tab = id;
    history.replaceState(null, '', '#' + id);
    renderTabs();
    renderPanel();
    panel.scrollTop = 0;
    syncPreview();
    if (id === 'account') loadAccounts();
    if (id === 'stats') loadStats();
    if (id === 'coupon') loadCoupon();
  }

  // ---------- フォーム部品 ----------
  function field(label, path, { type = 'text', ph = '', rows = 0, hint = '', list = false } = {}) {
    let v = getPath(path) ?? '';
    if (list) v = v.join('、');
    const attrs = `data-path="${path}"${list ? ' data-list' : ''} placeholder="${esc(ph)}"`;
    const input = rows
      ? `<textarea ${attrs} rows="${rows}">${esc(v)}</textarea>`
      : `<input type="${type}" ${attrs} value="${esc(v)}">`;
    return `<label class="f"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
  }
  const sw = (path, label, cls = '') => `<label class="sw ${cls}"><input type="checkbox" data-path="${path}" ${getPath(path) ? 'checked' : ''}><span>${label}</span></label>`;
  const ord = (list, i, len) => `<div class="ord"><button data-act="move" data-list="${list}" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button><button data-act="move" data-list="${list}" data-i="${i}" data-d="1" ${i === len - 1 ? 'disabled' : ''} aria-label="下へ">▼</button></div>`;
  // 「項目名 ＋ 内容」の行を自由に増減できる表（募集要項・料金表）
  function rowsEditor(list, labelPh, valuePh) {
    const rows = getPath(list);
    return rows.map((it, i) => `<div class="inline">
        <input class="lbl" data-path="${list}.${i}.label" value="${esc(it.label)}" placeholder="${labelPh}">
        <textarea data-path="${list}.${i}.value" rows="1" placeholder="${valuePh}">${esc(it.value)}</textarea>
        ${ord(list, i, rows.length)}
        <button class="icon-btn" data-act="del" data-list="${list}" data-i="${i}" data-now aria-label="削除">×</button>
      </div>`).join('') + `<div class="bar"><button class="btn sm" data-act="add" data-list="${list}">＋ 行を追加</button></div>`;
  }
  const delBtn = (list, i, label = '削除') => `<button class="btn danger sm" data-act="del" data-list="${list}" data-i="${i}">${label}</button>`;

  // ---------- SNS：ID だけでも URL に直す（公開ページ site.js と同じ規則） ----------
  function snsUrl(type, v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    const id = v.replace(/^@/, '');
    if (/^[\w.~-]+$/.test(id)) {
      const u = {
        instagram: `https://www.instagram.com/${id}/`, tiktok: `https://www.tiktok.com/@${id}`, x: `https://x.com/${id}`,
        youtube: `https://www.youtube.com/@${id}`, line: id.includes('.') ? '' : `https://line.me/ti/p/~${id}`,
      }[type];
      if (u) return u;
    }
    return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? 'https://' + v : ''; // example.com/… の形なら https:// を補う
  }
  const SNS_PH = { instagram: '@ID または URL', tiktok: '@ID または URL', x: '@ID または URL', youtube: '@ハンドル または URL', line: 'LINE ID または URL', web: 'https://…' };
  // 入力欄の下に、実際に飛ぶ先を表示（打ち間違いにすぐ気づけるように）
  function refreshResolved() {
    panel.querySelectorAll('.resolved').forEach((el) => {
      const type = el.dataset.rtypeFixed || getPath(el.dataset.rtype);
      const val = String(getPath(el.dataset.rval) || '').trim();
      const url = snsUrl(type, val);
      el.classList.toggle('bad', !!val && !url);
      el.innerHTML = !val ? '' : url ? `→ <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : 'このままではリンクになりません。ID か URL を確認してください';
    });
  }
  const resolved = (rval, typePath, fixedType) => `<small class="resolved" data-rval="${rval}" ${fixedType ? `data-rtype-fixed="${fixedType}"` : `data-rtype="${typePath}"`}></small>`;

  // ---------- 各タブ ----------
  const dayInfo = (k) => { const d = parseKey(k); return { md: `${d.getMonth() + 1}/${d.getDate()}`, dow: DOW[d.getDay()], w: d.getDay(), d: d.getDate() }; };
  const dayCls = (k, tk) => { const w = parseKey(k).getDay(); return (k === tk ? ' today' : '') + (w === 0 ? ' sun' : w === 6 ? ' sat' : ''); };
  const monthKeys = () => {
    const [y, m] = monthCursor.split('-').map(Number);
    return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${monthCursor}-${pad(i + 1)}`);
  };
  const weekKeys = () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // ---------- あいことばクーポン ----------
  let couponInfo = null; // { today, history }
  async function loadCoupon() {
    if (DEMO) return;
    try { couponInfo = await api('/api/coupon'); } catch (err) { toast(err.message, true); }
    if (tab === 'coupon') renderPanel();
  }
  function couponList(kind, label, ph) {
    const list = site.coupon[kind];
    return `<h3>${label} <small class="count">${list.filter((x) => x.on !== false && String(x.text || '').trim()).length}件が抽選の対象</small></h3>
      ${list.map((x, i) => `<div class="inline coupon-row ${x.on === false ? 'off' : ''}">
        ${sw(`coupon.${kind}.${i}.on`, '')}
        <input data-path="coupon.${kind}.${i}.text" value="${esc(x.text)}" placeholder="${ph}">
        <button class="icon-btn" data-act="del" data-list="coupon.${kind}" data-i="${i}" data-now aria-label="削除">×</button>
      </div>`).join('')}
      <div class="bar"><button class="btn sm" data-act="coupon-add" data-kind="${kind}">＋ ${label}を追加</button></div>`;
  }
  function couponView() {
    if (DEMO) return '<p class="hint">お試しモードではクーポンは使えません。</p>';
    const cp = site.coupon;
    const t = couponInfo?.today;
    const hist = (couponInfo?.history || []).slice(1);
    return `
      <div class="coupon-today ${t ? '' : 'none'}">
        <span>今日のあいことば（${t ? `${esc(t.from)} 〜 ${esc(t.to)}` : '—'}）</span>
        ${t ? `<b>「${esc(t.word)}」</b><em>${esc(t.perk)}</em>` : `<p>${cp.enabled ? '合言葉と特典をそれぞれ1つ以上登録して「保存して公開」を押すと決まります。' : '今はサイトに表示していません。'}</p>`}
      </div>
      <div class="shift-top">
        ${sw('coupon.enabled', 'サイトに表示する（SNS リンクの下）')}
        <p class="hint" style="margin:6px 0 0">毎日 <b>3:01</b> に、合言葉と特典がそれぞれランダムに切り替わります（前の日と同じものは出ません）。今日の分は保存しても変わりませんが、今日の合言葉・特典を OFF にしたり消したりすると、選び直されます。</p>
      </div>
      ${field('見出し', 'coupon.title', { ph: '本日のあいことばクーポン' })}
      ${couponList('words', '合言葉', '例：エルフで乾杯')}
      ${couponList('perks', '特典', '例：セット料金 1,000円引き')}
      ${field('注意書き', 'coupon.note', { rows: 2, ph: '例：1組1回まで。他のクーポンとの併用はできません。' })}
      ${hist.length ? `<h3>これまでの合言葉</h3><p class="hint">「昨日見た」というお客さんへの確認用です。</p>
        <ul class="coupon-hist">${hist.map((h) => `<li><span>${esc(h.from)}〜</span><b>「${esc(h.word)}」</b><em>${esc(h.perk)}</em></li>`).join('')}</ul>` : ''}`;
  }

  // ---------- アクセス（管理画面での集計表示） ----------
  let stats = null;        // サーバーからの集計
  let statsDays = 30;      // 表示する期間（日）
  const PAGE_LABEL = { index: 'トップページ', recruit: '求人ページ', other: 'その他' };
  const TAG_LINKS = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['x', 'X（旧Twitter）'], ['line', 'LINE'], ['nightstyle', 'ナイスタ'], ['gmb', 'Googleマップ'], ['qr', 'QRコード・名刺']];
  async function loadStats() {
    if (DEMO) return;
    try { stats = await api(`/api/stats?days=${statsDays}`); } catch (err) { toast(err.message, true); stats = { days: [], sources: {}, pages: {}, views: 0, visitors: 0 }; }
    if (tab === 'stats') renderPanel();
  }
  const fmt = (n) => Number(n || 0).toLocaleString('ja-JP');
  function barList(obj, labelOf = (k) => k) {
    const entries = Object.entries(obj || {});
    const total = entries.reduce((a, [, n]) => a + n, 0);
    if (!total) return '<p class="hint">まだデータがありません。</p>';
    const max = Math.max(...entries.map(([, n]) => n));
    return `<ul class="rank">${entries.map(([k, n]) => `<li>
      <span class="rank-label">${esc(labelOf(k))}</span>
      <span class="rank-bar"><i style="width:${Math.max(2, (n / max) * 100)}%"></i></span>
      <span class="rank-num">${fmt(n)}<small>${Math.round((n / total) * 100)}%</small></span>
    </li>`).join('')}</ul>`;
  }
  function statsView() {
    if (DEMO) return '<p class="hint">お試しモードではアクセス集計は見られません。</p>';
    const configured = String(site.seo?.siteUrl || '').trim();
    const base = configured ? configured.replace(/\/?$/, '/') : new URL('../', location.href).href;
    const periods = [[1, '今日'], [7, '7日'], [30, '30日'], [90, '90日']];
    let body = '<p class="hint">読み込み中…</p>';
    if (stats) {
      const days = stats.days || [];
      const max = Math.max(1, ...days.map((d) => d.visitors));
      const perVisit = stats.visitors ? (stats.views / stats.visitors).toFixed(1) : '—';
      const md = (d) => d.slice(5).replace('-', '/');
      body = `
        <div class="tiles">
          <div class="tile"><span>訪問者数</span><b>${fmt(stats.visitors)}</b><small>人（1日ごとに数えた合計）</small></div>
          <div class="tile"><span>表示回数</span><b>${fmt(stats.views)}</b><small>回</small></div>
          <div class="tile"><span>1人あたり</span><b>${perVisit}</b><small>ページ</small></div>
        </div>
        ${days.length > 1 ? `<h3>日ごとの訪問者数</h3>
        <div class="daychart" role="img" aria-label="日ごとの訪問者数のグラフ">
          <span class="daychart-max">最大 ${fmt(max)}人</span>
          <div class="daychart-bars">${days.map((d) => `<span class="dbar" style="--h:${(d.visitors / max) * 100}%" data-tip="${md(d.date)}：${fmt(d.visitors)}人・${fmt(d.views)}回"></span>`).join('')}</div>
          <div class="daychart-axis"><span>${md(days[0].date)}</span><span>${md(days[days.length - 1].date)}</span></div>
        </div>` : ''}
        <h3>どこから来たか</h3>
        <p class="hint">訪問者ごとに、来たきっかけを1回数えます。「直接・アプリ内（不明）」は、ブックマークや URL の直接入力、Instagram・LINE などのアプリ内から開いた場合です（アプリは来た場所を教えてくれないことが多いため）。</p>
        ${barList(stats.sources)}
        <h3>よく見られたページ</h3>
        ${barList(stats.pages, (k) => PAGE_LABEL[k] || k)}
        ${stats.local ? '<p class="hint">※ 手元の確認用サーバーでは集計しません。本番（clubelf.jp）で数えます。</p>' : ''}`;
    }
    return `
      <div class="sub-tabs">${periods.map(([d, l]) => `<button data-stats-days="${d}" class="${statsDays === d ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${body}
      <h3>SNS に貼る「目印付きリンク」</h3>
      <p class="hint">プロフィールのリンク欄にはこちらを貼ってください。アプリから来た人も「どこから来たか」が正しく分かります。</p>
      <ul class="taglinks">${TAG_LINKS.map(([k, l]) => `<li><span>${l}</span><code>${esc(base)}?from=${k}</code><button class="btn sm" data-act="copy" data-text="${esc(base)}?from=${k}">コピー</button></li>`).join('')}</ul>
      <h3>Google アナリティクス</h3>
      <p class="hint">もっと詳しく（地域・機種・時間帯・滞在時間など）見たいときに使います。Google アナリティクスで発行された「測定ID」（G- で始まる番号）を入れて「保存して公開」を押すと、計測が始まります。</p>
      ${field('測定ID', 'seo.gaId', { ph: '例：G-XXXXXXXXXX', hint: '空欄なら Google アナリティクスは使いません' })}
      <a class="btn" href="https://analytics.google.com/" target="_blank" rel="noopener">Google アナリティクスを開く ↗</a>`;
  }

  // ---------- アカウント（ID ＋ パスワード） ----------
  // サイトの下書きとは別に、変更はその場でサーバーへ送る（「保存して公開」は不要）
  let me_ = null;          // ログイン中のユーザー { id, role }
  let accounts = null;     // ユーザー一覧（管理者のみ）
  let resetOpen = '';      // パスワード再設定欄を開いているユーザー
  const ROLE_LABEL = { admin: '管理者', staff: 'スタッフ' };
  async function loadAccounts() {
    if (DEMO || me_?.role !== 'admin') return;
    try { accounts = (await api('/api/users')).users; } catch (err) { toast(err.message, true); accounts = []; }
    if (tab === 'account') renderPanel();
  }
  async function acctUpdate(body, okMsg) {
    try { accounts = (await api('/api/users/update', { method: 'POST', body: JSON.stringify(body) })).users; toast(okMsg); }
    catch (err) { toast(err.message, true); }
    renderPanel();
  }
  function accountView() {
    if (DEMO) return '<p class="hint">お試しモードではアカウントの管理はできません。</p>';
    if (!me_) return '<p class="hint">読み込み中…</p>';
    const isAdmin = me_.role === 'admin';
    const users = isAdmin ? (accounts === null ? '<p class="hint">読み込み中…</p>' : `<ul class="list">${accounts.map((u) => {
      const self = u.id.toLowerCase() === me_.id.toLowerCase();
      return `<li class="item"><div class="row acct-row">
          <div class="name"><b>${esc(u.id)}</b><small>${ROLE_LABEL[u.role] || u.role}${self ? '・自分' : ''}</small></div>
          <select data-acct-role="${esc(u.id)}" ${self ? 'disabled title="自分の権限は変えられません"' : ''}>
            <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>スタッフ</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理者</option>
          </select>
          ${self ? '' : `<button class="btn sm" data-act="acct-reset" data-id="${esc(u.id)}">パスワード再設定</button>
          <button class="btn sm danger" data-act="acct-del" data-id="${esc(u.id)}" data-confirm>削除</button>`}
        </div>
        ${resetOpen === u.id ? `<div class="edit acct-reset">
          <input type="password" id="acResetPw" autocomplete="new-password" placeholder="新しいパスワード（8文字以上）">
          <button class="btn sm primary" data-act="acct-reset-do" data-id="${esc(u.id)}">設定する</button>
        </div>` : ''}
      </li>`;
    }).join('')}</ul>`) : '';
    return `
      <h3>自分のアカウント</h3>
      <p class="sum">ログイン中：<b>${esc(me_.id)}</b>（${ROLE_LABEL[me_.role] || me_.role}）</p>
      <div class="acct-box">
        <label class="f"><span>新しい ID（変えない場合は空欄）</span><input id="acNewId" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="${esc(me_.id)}"><small>半角英数字と _ . @ - で3〜32文字</small></label>
        <div class="grid2">
          <label class="f"><span>新しいパスワード</span><input id="acNewPw" type="password" autocomplete="new-password" placeholder="変えない場合は空欄"></label>
          <label class="f"><span>新しいパスワード（確認）</span><input id="acNewPw2" type="password" autocomplete="new-password"></label>
        </div>
        <label class="f"><span>今のパスワード（必須）</span><input id="acCurPw" type="password" autocomplete="current-password"></label>
        <button class="btn primary" data-act="acct-save">変更する</button>
      </div>
      ${isAdmin ? `
        <h3>ユーザー一覧</h3>
        ${users}
        <h3>ユーザーを追加</h3>
        <div class="acct-box">
          <div class="grid2">
            <label class="f"><span>ID</span><input id="auId" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="例：staff01"></label>
            <label class="f"><span>初期パスワード</span><input id="auPw" type="password" autocomplete="new-password" placeholder="8文字以上"></label>
          </div>
          <label class="f"><span>権限</span><select id="auRole">
            <option value="staff">スタッフ（サイトの編集だけ）</option>
            <option value="admin">管理者（ユーザーの管理もできる）</option>
          </select></label>
          <button class="btn primary" data-act="acct-add">追加する</button>
          <p class="hint" style="margin-top:8px">追加した人には ID と初期パスワードを直接伝えてください。ログイン後、この画面で自分のパスワードに変えられます。</p>
        </div>` : '<p class="hint">ユーザーの追加・管理は管理者だけができます。</p>'}`;
  }

  const views = {
    coupon: () => couponView(),
    account: () => accountView(),
    stats: () => statsView(),
    shift() {
      const sh = site.shift;
      const tk = todayKey();
      brush ||= sh.defaultTime || '20:00〜';
      weekStart ||= mondayOf(tk);
      monthCursor ||= tk.slice(0, 7);
      const casts = visibleCasts();
      if (!casts.some((c) => c.id === monthCast)) monthCast = casts[0]?.id || '';
      const nameOf = (c) => esc(c.name) || '（名前未入力）';

      let body;
      if (!casts.length) {
        body = '<p class="hint">サイトに表示中のキャストがいません。「キャスト」タブで追加してください。</p>';
      } else if (shiftView === 'week') {
        const days = weekKeys();
        body = `
          <div class="nav-row">
            <button class="btn sm" data-act="wk" data-d="-7">← 前の週</button>
            <b>${dayInfo(days[0]).md}（月）〜 ${dayInfo(days[6]).md}（日）</b>
            <button class="btn sm" data-act="wk" data-d="7">次の週 →</button>
          </div>
          ${weekStart !== mondayOf(tk) ? '<div class="center"><button class="btn sm ghost" data-act="wk-this">今週に戻る</button></div>' : ''}
          <div class="grid-wrap"><table class="sched">
            <thead><tr><th></th>${days.map((k) => { const d = dayInfo(k); return `<th class="${dayCls(k, tk)}"><button data-act="sh-col" data-key="${k}" title="この日を全員まとめて切り替え">${d.md}<small>${k === tk ? '今日' : d.dow}</small></button></th>`; }).join('')}</tr></thead>
            <tbody>
              ${casts.map((c) => `<tr><th><button data-act="sh-row" data-id="${esc(c.id)}" title="この週をまとめて切り替え">${nameOf(c)}</button></th>${days.map((k) => {
                const v = shiftOf(k, c.id);
                return `<td class="${dayCls(k, tk)}"><button class="cell${v ? ' on' : ''}" data-act="sh-cell" data-key="${k}" data-id="${esc(c.id)}" title="${esc(v || '休み')}">${v ? esc(shortTime(v)) : ''}</button></td>`;
              }).join('')}</tr>`).join('')}
              <tr class="count"><th>出勤人数</th>${days.map((k) => `<td>${casts.filter((c) => shiftOf(k, c.id)).length}</td>`).join('')}</tr>
            </tbody>
          </table></div>
          <div class="bar">
            <button class="btn sm" data-act="copy-week">前の週と同じにする</button>
            <button class="btn sm danger" data-act="clear-week" data-confirm>この週をすべて休みに</button>
          </div>`;
      } else {
        const [y, m] = monthCursor.split('-').map(Number);
        const keys = monthKeys();
        const cast = casts.find((c) => c.id === monthCast);
        const lead = (parseKey(keys[0]).getDay() + 6) % 7; // 月曜始まり
        const cells = [...Array(lead).fill(null), ...keys];
        while (cells.length % 7) cells.push(null);
        const rows = [];
        for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
        body = `
          <div class="nav-row">
            <button class="btn sm" data-act="mo" data-d="-1">← 前の月</button>
            <b>${y}年 ${m}月</b>
            <button class="btn sm" data-act="mo" data-d="1">次の月 →</button>
          </div>
          <p class="hint">入力するキャストを選んでください（数字はその月の出勤日数）。</p>
          <div class="chips">${casts.map((c) => `<button class="chip${c.id === monthCast ? ' on' : ''}" data-act="mo-cast" data-id="${esc(c.id)}">${nameOf(c)}<small>${keys.filter((k) => shiftOf(k, c.id)).length}</small></button>`).join('')}</div>
          <table class="cal">
            <thead><tr>${'月火水木金土日'.split('').map((d, i) => `<th class="${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}"><button data-act="mo-dow" data-dow="${(i + 1) % 7}" title="毎週${d}曜をまとめて切り替え">${d}</button></th>`).join('')}</tr></thead>
            <tbody>${rows.map((r) => `<tr>${r.map((k) => {
              if (!k) return '<td></td>';
              const v = shiftOf(k, monthCast);
              return `<td class="${dayCls(k, tk)}"><button class="cell${v ? ' on' : ''}" data-act="sh-cell" data-key="${k}" data-id="${esc(monthCast)}" title="${esc(v || '休み')}"><b>${dayInfo(k).d}</b><span>${v ? esc(shortTime(v)) : ''}</span></button></td>`;
            }).join('')}</tr>`).join('')}</tbody>
          </table>
          <div class="bar">
            <button class="btn sm danger" data-act="mo-clear" data-confirm>${nameOf(cast)} の ${m}月をすべて休みに</button>
          </div>`;
      }

      return `
        <div class="shift-top">
          ${sw('shift.enabled', 'サイトに出勤情報を表示する')}
          ${sh.enabled === false ? '<p class="note-off">いまは非表示です。入力した内容は残り、表示に戻せばそのまま出ます。</p>' : ''}
        </div>
        <div class="sub-tabs">
          <button data-shiftview="week" class="${shiftView === 'week' ? 'on' : ''}">週ごとに入力</button>
          <button data-shiftview="month" class="${shiftView === 'month' ? 'on' : ''}">月ごとに入力</button>
        </div>
        <div class="brush">
          <label for="brush">入力する時間</label>
          <input id="brush" list="timeOpts" value="${esc(brush)}" autocomplete="off">
          <datalist id="timeOpts">${['19:00〜', '20:00〜', '21:00〜', '22:00〜', '23:00〜', '20:00〜LAST', '同伴', '未定'].map((t) => `<option value="${t}">`).join('')}</datalist>
        </div>
        <p class="hint">マスを押すと上の時間で出勤、もう一度押すと休み。${shiftView === 'week' ? '名前・日付を押すと行・列をまとめて切り替えます。' : '曜日を押すとその曜日をまとめて切り替えます。'}</p>
        ${body}
        <details class="settings">
          <summary>出勤の設定</summary>
          ${field('最初に入る時間', 'shift.defaultTime', { hint: '「入力する時間」の初期値' })}
          ${field('日付の切り替わり（時）', 'shift.dayStart', { type: 'number', hint: 'この時刻までは前日の営業として扱います（例：6 → 朝6時まで前日扱い）' })}
        </details>`;
    },

    price() {
      const plans = site.system.plans;
      return `
        <p class="hint">トップページの「営業案内」の下に表示されます。料金表は複数作れます（例：通常料金 ／ 早割・ハッピーアワー）。</p>
        <div class="list">${plans.map((p, i) => `<div class="item open"><div class="edit" style="border:0">
          <div class="edit-foot" style="margin:0 0 8px"><b>料金表 ${i + 1}</b>${ord('system.plans', i, plans.length).replace('class="ord"', 'class="ord" style="flex-direction:row"')}</div>
          ${field('見出し', `system.plans.${i}.title`, { ph: '例：通常料金 20:00〜LAST' })}
          ${rowsEditor(`system.plans.${i}.items`, '項目', '料金')}
          <div class="edit-foot"><span></span>${delBtn('system.plans', i, 'この料金表を削除')}</div>
        </div></div>`).join('')}</div>
        <div class="bar" style="margin-top:10px"><button class="btn primary" data-act="add-plan">＋ 料金表を追加</button></div>
        <h3>注記</h3>
        ${field('料金の注記', 'system.note', { rows: 2, ph: '例：TAX・サービス料 20%' })}
        <p class="hint">項目がすべて空の料金表は表示されません。</p>`;
    },

    cast() {
      const visible = visibleCasts();
      const tk = todayKey();
      return `
        <div class="bar">
          <button class="btn primary" data-act="cast-add">＋ キャストを追加</button>
        </div>
        <p class="sum">サイト掲載 <b>${visible.length}</b>人 ／ 在籍 ${site.casts.length}人</p>
        <p class="hint">名前を押すと詳細を編集できます。左の <b>⠿</b> をつかんで上下に動かすと並べ替えられます（この順がサイトの掲載順）。出勤の入力は「出勤」タブで。</p>
        <ul class="list" data-sortable="casts">${site.casts.map((c, i) => {
          const open = openItems.has(c.id);
          return `<li class="item ${c.visible === false ? 'off' : ''} ${open ? 'open' : ''}">
            <div class="row">
              <span class="grip" data-grip="${i}" title="ドラッグで並べ替え" aria-label="ドラッグで並べ替え">⠿</span>
              <button class="thumb" data-act="cast-photo" data-i="${i}" title="写真を変更">${c.photo ? `<img src="${esc(imgSrc(c.photo))}" alt="">` : '写真'}</button>
              <button class="name" data-act="toggle" data-id="${esc(c.id)}">
                <b data-label="casts.${i}.name">${esc(c.name) || '（名前未入力）'}</b>
                <small>${c.visible === false ? '非表示 ・ ' : ''}${esc(c.profile)}</small>
              </button>
              ${shiftOf(tk, c.id) ? `<span class="today-pill">本日 ${esc(shortTime(shiftOf(tk, c.id)))}</span>` : ''}
              ${ord('casts', i, site.casts.length)}
            </div>
            ${open ? `<div class="edit">
              <div class="edit-photo">
                <button class="thumb" data-act="cast-photo" data-i="${i}">${c.photo ? `<img src="${esc(imgSrc(c.photo))}" alt="">` : '写真'}</button>
                <div class="bar">
                  <button class="btn sm" data-act="cast-photo" data-i="${i}">${c.photo ? '写真を変更' : '写真を選ぶ'}</button>
                  ${c.photo ? `<button class="btn sm ghost" data-act="cast-photo-clear" data-i="${i}">写真を外す</button>` : ''}
                </div>
              </div>
              ${field('名前', `casts.${i}.name`)}
              ${field('プロフィール', `casts.${i}.profile`, { ph: '例：T158 / O型' })}
              ${field('タグ', `casts.${i}.tags`, { ph: '例：新人、No.1', hint: '「、」区切りで複数', list: true })}
              ${field('ひとこと', `casts.${i}.comment`, { rows: 3 })}
              <h4 class="mini">SNS <small>（名前の下にアイコンで出ます。URL でも @ID だけでもOK）</small></h4>
              <div class="grid2">
                ${field('Instagram', `casts.${i}.sns.instagram`, { ph: '@ID または URL', hint: resolved(`casts.${i}.sns.instagram`, '', 'instagram') })}
                ${field('TikTok', `casts.${i}.sns.tiktok`, { ph: '@ID または URL', hint: resolved(`casts.${i}.sns.tiktok`, '', 'tiktok') })}
                ${field('X（旧Twitter）', `casts.${i}.sns.x`, { ph: '@ID または URL', hint: resolved(`casts.${i}.sns.x`, '', 'x') })}
                ${field('LINE', `casts.${i}.sns.line`, { ph: 'LINE ID または URL', hint: resolved(`casts.${i}.sns.line`, '', 'line') })}
              </div>
              ${field('その他のURL', `casts.${i}.sns.web`, { ph: 'ブログなど https://…', hint: resolved(`casts.${i}.sns.web`, '', 'web') })}
              <div class="edit-foot">
                ${sw(`casts.${i}.visible`, 'サイトに表示')}
                ${delBtn('casts', i, 'このキャストを削除')}
              </div>
            </div>` : ''}
          </li>`;
        }).join('')}</ul>`;
    },

    hero() {
      const imgs = site.hero.images;
      return `
        <h3>ロゴ</h3>
        <div class="logo-ed">
          ${site.hero.logo ? `<span class="logo-prev"><img src="${esc(imgSrc(site.hero.logo))}" alt=""></span>` : `<span class="logo-prev empty">${esc(site.shop.name) || '店名'}（文字で表示中）</span>`}
          <div class="bar">
            <button class="btn sm" data-act="logo-set">${site.hero.logo ? 'ロゴを変更' : 'ロゴ画像を選ぶ'}</button>
            ${site.hero.logo ? '<button class="btn sm ghost" data-act="logo-clear">文字で表示する</button>' : ''}
          </div>
        </div>
        <p class="hint">トップの店名の位置に出ます。背景が透明な PNG がおすすめ。</p>
        <h3>スライド画像</h3>
        <p class="hint">横長（16:9 くらい）の写真がおすすめ。2枚以上で自動スライドします。1枚目が最初に表示されます。</p>
        <div class="slides-ed">
          ${imgs.map((src, i) => `<div class="slide-ed"><img src="${esc(imgSrc(src))}" alt=""><span class="no">${i + 1}</span>
            <div class="ops">
              <button data-act="move" data-list="hero.images" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="前へ">←</button>
              <button data-act="move" data-list="hero.images" data-i="${i}" data-d="1" ${i === imgs.length - 1 ? 'disabled' : ''} aria-label="後ろへ">→</button>
              <button data-act="del" data-list="hero.images" data-i="${i}" data-now aria-label="削除">×</button>
            </div></div>`).join('')}
          <button class="add-tile" data-act="hero-add">＋ 画像を追加<br><small>複数選択できます</small></button>
        </div>
        ${field('切り替え間隔（秒）', 'hero.interval', { type: 'number' })}
        <h3>テキスト</h3>
        ${field('キャッチコピー', 'hero.catch')}
        ${field('サブテキスト', 'hero.sub', { rows: 2 })}
        <p class="hint">店名は「店舗情報」タブで変更できます。</p>`;
    },

    recruit() {
      const sub = recruitSub;
      const head = `<div class="sub-tabs">
        <button data-sub="cast" class="${sub === 'cast' ? 'on' : ''}">キャスト募集</button>
        <button data-sub="staff" class="${sub === 'staff' ? 'on' : ''}">スタッフ募集</button>
        <button data-sub="apply" class="${sub === 'apply' ? 'on' : ''}">応募先</button>
      </div>`;
      if (sub === 'apply') {
        return head + `
          <p class="hint">キャスト・スタッフ共通の応募ボタンです。空欄のボタンは表示されません。</p>
          ${field('LINE の URL', 'recruit.apply.line', { ph: 'https://line.me/...', hint: 'LINE公式アカウントの友だち追加URL' })}
          ${field('求人用 電話番号', 'recruit.apply.phone')}
          ${field('メールアドレス', 'recruit.apply.email', { type: 'email' })}
          ${field('応募欄の案内文', 'recruit.apply.note', { rows: 2 })}`;
      }
      const base = `recruit.${sub}`;
      const r = site.recruit[sub];
      return head + `
        <div class="bar">${sw(`${base}.enabled`, 'この求人を掲載する')}</div>
        ${field('キャッチコピー', `${base}.catch`)}
        ${field('本文', `${base}.body`, { rows: 3 })}
        ${field('待遇タグ', `${base}.perks`, { list: true, ph: '日払いOK、送り完備', hint: '「、」区切り。目立つバッジで表示されます' })}
        <h3>募集要項</h3>
        ${rowsEditor(`${base}.items`, '項目', '内容')}
        <p class="hint">例：給与 / 勤務時間 / 勤務日数 / 資格 / 待遇</p>`;
    },

    shop() {
      return `
        <h3>基本</h3>
        <div class="grid2">${field('店名', 'shop.name')}${field('読み・サブ表記', 'shop.kana')}</div>
        ${field('電話番号', 'shop.phone', { type: 'tel', hint: 'スマホでは画面下に「電話する」ボタンが出ます' })}
        <h3>営業</h3>
        <div class="grid2">${field('営業時間', 'shop.hours')}${field('定休日', 'shop.holiday')}</div>
        ${field('補足（予約・支払いなど）', 'shop.note', { rows: 2, hint: '料金表は「料金」タブで編集できます' })}
        <h3>場所</h3>
        ${field('住所', 'shop.address', { hint: '住所から Google マップを自動表示します' })}
        ${field('アクセス', 'shop.access', { ph: '例：JR新宿駅 東口より徒歩5分' })}
        ${field('地図の検索ワード', 'shop.mapQuery', { ph: '例：CLUB ELF 三島店 静岡県三島市一番町11-14', hint: '地図のピンの位置を決めます。Googleマップに登録されている店名＋住所がおすすめ（空欄なら住所で検索）' })}
        ${field('地図の埋め込みコード（任意）', 'shop.mapEmbed', { rows: 2, hint: 'ピンの位置がずれる時だけ。Googleマップ →「共有」→「地図を埋め込む」のコードを貼り付け' })}`;
    },

    branches() {
      const b = site.branches;
      return `
        <div class="bar"><button class="btn primary" data-act="add" data-list="branches">＋ 支店を追加</button></div>
        <p class="hint">トップページの「SHOPS」に表示されます。0件なら項目ごと非表示になります。</p>
        <ul class="list">${b.map((x, i) => `<li class="item open"><div class="edit" style="border:0">
          <div class="edit-foot" style="margin:0 0 8px"><b>${i + 1}.</b>${ord('branches', i, b.length).replace('class="ord"', 'class="ord" style="flex-direction:row"')}</div>
          <div class="grid2">${field('店名', `branches.${i}.name`)}${field('エリア', `branches.${i}.area`, { ph: '例：六本木' })}</div>
          ${field('住所', `branches.${i}.address`)}
          <div class="grid2">${field('電話番号', `branches.${i}.phone`, { type: 'tel' })}${field('サイトURL', `branches.${i}.url`, { type: 'url' })}</div>
          <div class="edit-foot"><span></span>${delBtn('branches', i)}</div>
        </div></li>`).join('')}</ul>`;
    },

    sns() {
      const s = site.sns;
      return `
        <p class="hint">ページ最下部にアイコンで並びます。<b>@ID だけ入れれば、URL は自動で補います</b>（例：Instagram に「@clubelf」）。空のものは表示されません。</p>
        ${s.map((x, i) => `<div class="inline">
          <select data-path="sns.${i}.type">${SNS_TYPES.map(([v, l]) => `<option value="${v}" ${x.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input data-path="sns.${i}.url" value="${esc(x.url)}" placeholder="${SNS_PH[x.type] || 'https://…'}" autocapitalize="off" spellcheck="false">
          ${ord('sns', i, s.length)}
          <button class="icon-btn" data-act="del" data-list="sns" data-i="${i}" data-now aria-label="削除">×</button>
        </div>${resolved(`sns.${i}.url`, `sns.${i}.type`)}`).join('')}
        <h3>追加</h3>
        <div class="bar">${SNS_TYPES.map(([v, l]) => `<button class="btn sm" data-act="sns-add" data-type="${v}">＋ ${l}</button>`).join('')}</div>`;
    },

    seo() {
      const s = site.seo;
      const len = (v) => [...String(v || '')].length;
      const counter = (path, max) => `いま <b data-count="${path}">${len(getPath(path))}</b>文字（目安 ${max}文字まで）`;
      return `
        <p class="hint">検索結果やLINE・Xでリンクを貼ったときに出る文章です。見えない文字で言葉を詰め込むのは Google の規約違反になるので、<b>人が読んで自然な文章</b>に検索されたい言葉を入れてください。</p>
        <h3>Google の検索結果での見え方（トップページ）</h3>
        <div class="serp">
          <div class="serp-url">${esc(s.siteUrl || '')}</div>
          <div class="serp-title" data-label="seo.title" data-empty="（タイトル未入力）">${esc(s.title) || '（タイトル未入力）'}</div>
          <div class="serp-desc" data-label="seo.description" data-empty="（説明文未入力）">${esc(s.description) || '（説明文未入力）'}</div>
        </div>
        ${field('ページタイトル', 'seo.title', { hint: '店名＋地名＋業種を入れる（例：CLUB ELF｜三島駅南口のキャバクラ）。' + counter('seo.title', 32) })}
        ${field('説明文', 'seo.description', { rows: 3, hint: '検索結果のタイトルの下に出る文。' + counter('seo.description', 120) })}
        <h3>お店紹介（トップページの「ABOUT」に表示）</h3>
        <p class="hint">検索に一番効くのはここです。「三島」「三島駅」「キャバクラ」など、探されそうな言葉を自然に入れた紹介文にしてください。空欄なら ABOUT 欄は表示されません。</p>
        ${field('見出し', 'seo.introTitle', { ph: '例：三島駅南口のキャバクラ CLUB ELF' })}
        ${field('紹介文', 'seo.intro', { rows: 6 })}
        <h3>求人ページ</h3>
        ${field('ページタイトル', 'seo.recruitTitle', { hint: counter('seo.recruitTitle', 32) })}
        ${field('説明文', 'seo.recruitDescription', { rows: 3, hint: counter('seo.recruitDescription', 120) })}
        <h3>その他</h3>
        ${field('キーワード', 'seo.keywords', { list: true, rows: 2, hint: '「、」区切り。Google はほぼ参照しないので、上の文章に入れることのほうが大切です' })}
        ${field('価格帯', 'seo.priceRange', { ph: '例：¥5,100〜¥8,000', hint: 'Google 向けのお店情報（構造化データ）に入ります' })}
        ${field('サイトのURL', 'seo.siteUrl', { type: 'url', hint: '独自ドメインに移したらここを変更（サイトマップ・共有時のURLに使われます）' })}`;
    },

    theme() {
      const t = site.theme;
      return `
        <h3>キャストの見せ方</h3>
        <div class="layouts">${LAYOUTS.map((l) => `<button class="layout ${t.castLayout === l.id ? 'on' : ''}" data-act="layout" data-layout="${l.id}">
          ${layoutPic(l)}<b>${l.name}</b><small>${l.desc}</small></button>`).join('')}</div>
        ${['coverflow', 'tilt', 'fan'].includes(t.castLayout) ? `<div class="bar">${sw('theme.castAutoplay', '自動で回す（約4.5秒ごと）')}</div>` : ''}
        <h3>カラープリセット</h3>
        <div class="presets">${PRESETS.map((p, i) => `<button class="preset ${p.accent === t.accent && p.bg === t.bg ? 'on' : ''}" data-act="preset" data-i="${i}">
          <i style="background:${p.bg};border-color:${p.accent}"></i><span>${p.name}</span></button>`).join('')}</div>
        <h3>個別に調整</h3>
        <label class="color-row"><input type="color" data-path="theme.accent" value="${esc(t.accent)}"><span>アクセント色（文字・線・ボタン）</span><code>${esc(t.accent)}</code></label>
        <label class="color-row"><input type="color" data-path="theme.bg" value="${esc(t.bg)}"><span>背景色</span><code>${esc(t.bg)}</code></label>
        <p class="hint">背景は暗めの色にすると文字が読みやすくなります。</p>`;
    },
  };

  function renderPanel() {
    panel.innerHTML = views[tab]();
    refreshResolved();
  }

  // ---------- 入力 ----------
  panel.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'brush') { brush = el.value; return; }
    if (el.dataset.acctRole) { acctUpdate({ id: el.dataset.acctRole, role: el.value }, '権限を変更しました'); return; }
    const path = el.dataset.path;
    if (!path) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
    else if ('list' in el.dataset) v = el.value.split(/[、,，\n]+/).map((x) => x.trim()).filter(Boolean);
    else v = el.value;
    setPath(path, v);
    // 一覧の見出しなど、入力欄以外の表示を追従させる
    panel.querySelectorAll(`[data-label="${path}"]`).forEach((n) => { n.textContent = v || n.dataset.empty || '（名前未入力）'; });
    panel.querySelectorAll(`[data-count="${path}"]`).forEach((n) => { n.textContent = [...String(v)].length; });
    if (el.type === 'color') el.nextElementSibling.nextElementSibling.textContent = v;
    if (/(^sns\.|\.sns\.)/.test(path)) {
      refreshResolved();
      if (/^sns\.\d+\.type$/.test(path)) { const inp = panel.querySelector(`[data-path="${path.replace('.type', '.url')}"]`); if (inp) inp.placeholder = SNS_PH[v] || 'https://…'; }
    }
    const structural = el.type === 'checkbox' || el.type === 'color';
    changed({ rerender: structural });
  });

  // ---------- ドラッグ＆ドロップで並べ替え ----------
  // マウスでも指でも動くよう Pointer Events で実装（HTML5 の drag はスマホで動かないため）。
  // つまみ（⠿）をつかむ → 行が指についてくる → 他の行がよけて隙間ができる → 離した位置に入る
  let sortDrag = null;
  panel.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    const list = grip.closest('[data-sortable]');
    const row = grip.closest('.item');
    if (!list || !row) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* 取れなくても並べ替えは動く */ }
    const rows = [...list.children];
    const from = rows.indexOf(row);
    const gapPx = parseFloat(getComputedStyle(list).rowGap) || 0;
    sortDrag = {
      list, row, rows, from, to: from, path: list.dataset.sortable,
      startY: e.clientY, startScroll: panel.scrollTop, lastY: e.clientY,
      shift: row.offsetHeight + gapPx,
      mids: rows.map((r) => r.offsetTop + r.offsetHeight / 2),
      top: row.offsetTop, h: row.offsetHeight,
    };
    row.classList.add('dragging');
    list.classList.add('sorting');
  });
  function sortMove(clientY) {
    const d = sortDrag;
    const dy = clientY - d.startY + (panel.scrollTop - d.startScroll);
    d.row.style.transform = `translateY(${dy}px)`;
    const center = d.top + d.h / 2 + dy;
    let to = d.mids.filter((m, i) => i !== d.from && m < center).length;
    d.to = to;
    d.rows.forEach((r, i) => {
      if (i === d.from) return;
      let s = 0;
      if (d.from < to && i > d.from && i <= to) s = -d.shift;   // 下へ動かしたとき：間の行を上へ
      if (d.from > to && i >= to && i < d.from) s = d.shift;    // 上へ動かしたとき：間の行を下へ
      r.style.transform = s ? `translateY(${s}px)` : '';
    });
  }
  panel.addEventListener('pointermove', (e) => {
    if (!sortDrag) return;
    sortDrag.lastY = e.clientY;
    sortMove(e.clientY);
    // 一覧の端に来たら自動でスクロール
    const pr = panel.getBoundingClientRect();
    if (e.clientY < pr.top + 50) panel.scrollTop -= 14;
    else if (e.clientY > pr.bottom - 50) panel.scrollTop += 14;
  });
  panel.addEventListener('scroll', () => { if (sortDrag) sortMove(sortDrag.lastY); });
  const sortEnd = () => {
    if (!sortDrag) return;
    const { path, from, to, rows, list } = sortDrag;
    sortDrag = null;
    rows.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
    list.classList.remove('sorting');
    if (from === to) return;
    const arr = getPath(path);
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    changed({ rerender: true });
    toast('並び順を変更しました（保存すると公開されます）');
  };
  panel.addEventListener('pointerup', sortEnd);
  panel.addEventListener('pointercancel', sortEnd);

  panel.addEventListener('click', async (e) => {
    const sub = e.target.closest('[data-sub]');
    if (sub) { recruitSub = sub.dataset.sub; renderPanel(); syncPreview(); return; }
    const sd = e.target.closest('[data-stats-days]');
    if (sd) { statsDays = Number(sd.dataset.statsDays); stats = null; renderPanel(); return loadStats(); }
    const sv = e.target.closest('[data-shiftview]');
    if (sv) { shiftView = sv.dataset.shiftview; return renderPanel(); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const i = Number(b.dataset.i);
    const list = b.dataset.list && getPath(b.dataset.list);

    // まとめて消す操作は2回押しで実行
    if ('confirm' in b.dataset && !b.dataset.armed) {
      b.dataset.armed = '1';
      const old = b.textContent;
      b.textContent = 'もう一度押すと実行';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = old; } }, 3000);
      return;
    }

    if (act === 'coupon-add') {
      const list = site.coupon[b.dataset.kind];
      list.push({ id: uid(), text: '', on: true });
      changed({ rerender: true });
      return panel.querySelector(`[data-path="coupon.${b.dataset.kind}.${list.length - 1}.text"]`)?.focus();
    }
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(b.dataset.text); toast('コピーしました'); }
      catch { toast('コピーできませんでした。長押しで選んでコピーしてください', true); }
      return;
    }
    // ---- アカウント ----
    const val = (sel) => (panel.querySelector(sel)?.value || '');
    if (act === 'acct-save') {
      const newId = val('#acNewId').trim(), newPassword = val('#acNewPw'), currentPassword = val('#acCurPw');
      if (!newId && !newPassword) return toast('新しい ID か新しいパスワードを入力してください', true);
      if (newPassword && newPassword !== val('#acNewPw2')) return toast('新しいパスワード（確認）が一致しません', true);
      if (!currentPassword) return toast('今のパスワードを入力してください', true);
      try {
        const res = await api('/api/account', { method: 'POST', body: JSON.stringify({ newId, newPassword, currentPassword }) });
        me_ = res.user;
        $('#who').textContent = `ログイン中：${me_.id}`;
        toast(newId && newPassword ? 'ID とパスワードを変更しました' : newId ? 'ID を変更しました' : 'パスワードを変更しました');
        renderPanel();
        loadAccounts();
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (act === 'acct-add') {
      const id = val('#auId').trim(), password = val('#auPw'), role = val('#auRole');
      if (!id || !password) return toast('ID と初期パスワードを入力してください', true);
      try { accounts = (await api('/api/users', { method: 'POST', body: JSON.stringify({ id, password, role }) })).users; toast(`${id} を追加しました`); renderPanel(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (act === 'acct-reset') { resetOpen = resetOpen === b.dataset.id ? '' : b.dataset.id; renderPanel(); panel.querySelector('#acResetPw')?.focus(); return; }
    if (act === 'acct-reset-do') {
      const password = val('#acResetPw');
      if (!password) return toast('新しいパスワードを入力してください', true);
      resetOpen = '';
      return acctUpdate({ id: b.dataset.id, password }, `${b.dataset.id} のパスワードを再設定しました`);
    }
    if (act === 'acct-del') {
      try { accounts = (await api('/api/users/delete', { method: 'POST', body: JSON.stringify({ id: b.dataset.id }) })).users; toast(`${b.dataset.id} を削除しました`); renderPanel(); }
      catch (err) { toast(err.message, true); }
      return;
    }

    // ---- 出勤 ----
    const pen = () => brush.trim() || '出勤';
    // 複数マスをまとめて切り替え：全部同じ時間で入っていれば休みに、そうでなければ全部入れる
    const toggleMany = (pairs) => {
      const allOn = pairs.every(([k, id]) => shiftOf(k, id) === pen());
      pairs.forEach(([k, id]) => setShift(k, id, allOn ? '' : pen()));
      changed({ rerender: true });
    };
    const ids = () => visibleCasts().map((c) => c.id);
    if (act === 'sh-cell') {
      const { key, id } = b.dataset;
      setShift(key, id, shiftOf(key, id) === pen() ? '' : pen());
      return changed({ rerender: true });
    }
    if (act === 'sh-row') return toggleMany(weekKeys().map((k) => [k, b.dataset.id]));
    if (act === 'sh-col') return toggleMany(ids().map((id) => [b.dataset.key, id]));
    if (act === 'mo-dow') return toggleMany(monthKeys().filter((k) => parseKey(k).getDay() === Number(b.dataset.dow)).map((k) => [k, monthCast]));
    if (act === 'wk') { weekStart = addDays(weekStart, Number(b.dataset.d)); return renderPanel(); }
    if (act === 'wk-this') { weekStart = mondayOf(todayKey()); return renderPanel(); }
    if (act === 'mo') {
      const [y, m] = monthCursor.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(b.dataset.d), 1);
      monthCursor = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return renderPanel();
    }
    if (act === 'mo-cast') { monthCast = b.dataset.id; return renderPanel(); }
    if (act === 'copy-week') {
      const src = weekKeys().map((k) => site.shifts[addDays(k, -7)]);
      if (!src.some(Boolean)) return toast('前の週に出勤の入力がありません', true);
      weekKeys().forEach((k, n) => { if (src[n]) site.shifts[k] = { ...src[n] }; else delete site.shifts[k]; });
      toast('前の週の出勤をコピーしました');
      return changed({ rerender: true });
    }
    if (act === 'clear-week') {
      weekKeys().forEach((k) => delete site.shifts[k]);
      return changed({ rerender: true });
    }
    if (act === 'mo-clear') {
      monthKeys().forEach((k) => setShift(k, monthCast, ''));
      return changed({ rerender: true });
    }
    if (act === 'add-plan') {
      site.system.plans.push({ title: '', items: [{ label: '', value: '' }] });
      changed({ rerender: true });
      return panel.querySelector(`[data-path="system.plans.${site.system.plans.length - 1}.title"]`)?.focus();
    }

    if (act === 'toggle') {
      const id = b.dataset.id;
      openItems.has(id) ? openItems.delete(id) : openItems.add(id);
      return renderPanel();
    }
    if (act === 'move') {
      const j = i + Number(b.dataset.d);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      return changed({ rerender: true });
    }
    if (act === 'del') {
      // 誤操作防止：「×」以外は2回押しで削除
      if (!('now' in b.dataset) && !b.dataset.armed) {
        b.dataset.armed = '1';
        const old = b.textContent;
        b.textContent = 'もう一度押すと削除';
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = old; } }, 3000);
        return;
      }
      list.splice(i, 1);
      return changed({ rerender: true });
    }
    if (act === 'add') {
      list.push(b.dataset.list === 'branches' ? { name: '', area: '', address: '', phone: '', url: '' } : { label: '', value: '' });
      changed({ rerender: true });
      return panel.querySelectorAll('input')[panel.querySelectorAll('input').length - 1]?.focus();
    }
    if (act === 'cast-add') {
      const c = { id: uid(), name: '', profile: '', tags: ['新人'], comment: '', photo: '', sns: {}, visible: true };
      site.casts.unshift(c);
      openItems.add(c.id);
      changed({ rerender: true });
      panel.scrollTop = 0;
      return panel.querySelector('[data-path="casts.0.name"]')?.focus();
    }
    if (act === 'cast-photo') {
      const [file] = await pickFiles(false);
      if (!file) return;
      const url = await upload(file, 1200);
      if (url) { site.casts[i].photo = url; changed({ rerender: true }); }
      return;
    }
    if (act === 'cast-photo-clear') {
      site.casts[i].photo = '';
      return changed({ rerender: true });
    }
    if (act === 'logo-set') {
      const [file] = await pickFiles(false);
      if (!file) return;
      const url = await upload(file, 1400, 'image/png');
      if (url) { site.hero.logo = url; changed({ rerender: true }); }
      return;
    }
    if (act === 'logo-clear') {
      site.hero.logo = '';
      return changed({ rerender: true });
    }
    if (act === 'hero-add') {
      const files = await pickFiles(true);
      for (const f of files) {
        const url = await upload(f, 2000);
        if (url) { site.hero.images.push(url); changed({ rerender: true }); }
      }
      return;
    }
    if (act === 'sns-add') {
      site.sns.push({ type: b.dataset.type, url: '' });
      changed({ rerender: true });
      return panel.querySelector(`[data-path="sns.${site.sns.length - 1}.url"]`)?.focus();
    }
    if (act === 'layout') {
      site.theme.castLayout = b.dataset.layout;
      return changed({ rerender: true });
    }
    if (act === 'preset') {
      const p = PRESETS[i];
      site.theme.accent = p.accent; site.theme.bg = p.bg;
      return changed({ rerender: true });
    }
  });

  // ---------- 画像 ----------
  function pickFiles(multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.multiple = multiple;
      inp.onchange = () => resolve([...inp.files]);
      inp.click();
    });
  }
  // ブラウザ側で縮小してから送る（スマホ写真をそのまま載せると重いため）
  async function upload(file, max, type = 'image/jpeg') {
    try {
      toast('画像をアップロード中…');
      if (DEMO) max = Math.min(max, 640); // ブラウザ保存は容量が小さいので控えめに
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL(type, DEMO ? 0.75 : 0.86);
      if (DEMO) { toast('画像を追加しました（お試しモード）'); return dataUrl; }
      const { url } = await api('/api/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) });
      toast('画像を追加しました（保存すると公開されます）');
      return url;
    } catch (err) {
      toast(err.message.includes('decode') || err.name === 'InvalidStateError' ? 'この画像形式は読み込めませんでした' : err.message, true);
      return null;
    }
  }

  // ---------- 保存 ----------
  async function save() {
    if ($('#save').disabled) return;
    $('#save').disabled = true;
    // 2か月より前の出勤データは消してファイルを軽く保つ
    const limit = addDays(todayKey(), -62);
    for (const k of Object.keys(site.shifts)) if (k < limit) delete site.shifts[k];
    try {
      if (DEMO) {
        try { localStorage.setItem(DEMO_KEY, JSON.stringify(site)); }
        catch { throw new Error('ブラウザの保存容量を超えました。画像を減らしてください'); }
      } else {
        await api('/api/site', { method: 'PUT', body: JSON.stringify(site) });
      }
      savedJSON = JSON.stringify(site);
      changed();
      toast(DEMO ? '保存しました（このブラウザ内のみ）' : '保存して公開しました');
      if (!DEMO && tab === 'coupon') loadCoupon();
    } catch (err) {
      toast(err.message, true);
      changed();
    }
  }
  $('#save').onclick = save;
  $('#discard').onclick = () => {
    site = JSON.parse(savedJSON);
    changed({ rerender: true });
    toast('変更を破棄しました');
  };
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });
  addEventListener('beforeunload', (e) => {
    if (site && JSON.stringify(site) !== savedJSON) e.preventDefault();
  });

  $('#tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); };
  $('#device').onclick = (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    $('#device').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $('#frameWrap').classList.toggle('sp', b.dataset.d === 'sp');
  };
  $('#previewToggle').onclick = () => {
    const on = document.body.classList.toggle('show-preview');
    $('#previewToggle').textContent = on ? '編集に戻る' : 'プレビューを見る';
    if (on) syncPreview(); // 非表示中に届いたスクロール指示は効かないので出し直す
  };
  $('#logout').onclick = async () => {
    await fetch('../api/logout', { method: 'POST' });
    location.reload();
  };

  // ---------- 起動 ----------
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginForm [name=id]').focus();
  }
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('#loginErr').textContent = '';
    const r = await fetch('../api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.target.id.value.trim(), password: e.target.password.value }) });
    btn.disabled = false;
    if (!r.ok) { $('#loginErr').textContent = (await r.json().catch(() => ({}))).error || 'ログインできませんでした'; return; }
    e.target.reset();
    start();
  };

  async function start() {
    const me = await fetch('../api/me', { cache: 'no-store' }).catch(() => null);
    DEMO = !me || (me.status !== 200 && me.status !== 401) || !(me.headers.get('content-type') || '').includes('json');
    if (DEMO) {
      $('#warn').hidden = false;
      $('#warn').innerHTML = 'お試しモード：保存した内容は<b>このブラウザの中だけ</b>に残ります（他の人には見えません）。 <button class="btn sm" id="demoReset">最初の状態に戻す</button>';
      $('#demoReset').onclick = () => {
        try { localStorage.removeItem(DEMO_KEY); } catch { /* noop */ }
        site = null;
        start();
        toast('最初の状態に戻しました');
      };
      $('#logout').hidden = true;
    } else {
      if (me.status === 401) return showLogin();
      const info = await me.json();
      $('#warn').hidden = !info.defaultPassword;
      me_ = info.user || null;
      $('#who').textContent = me_ ? `ログイン中：${me_.id}` : '';
    }
    if (!site) {
      let data = null;
      if (DEMO) { try { data = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { /* noop */ } }
      data ||= await (await fetch(DEMO ? '../site.json' : '../api/site', { cache: 'no-store' })).json();
      site = normalize(data);
      savedJSON = JSON.stringify(site);
    }
    $('#login').hidden = true;
    $('#app').hidden = false;
    if (DEMO && ['account', 'stats', 'coupon'].includes(tab)) tab = 'shift';
    renderTabs();
    changed({ rerender: true });
    syncPreview();
    if (tab === 'account') loadAccounts();
    if (tab === 'stats') loadStats();
    if (tab === 'coupon') loadCoupon();
  }
  start();
})();
