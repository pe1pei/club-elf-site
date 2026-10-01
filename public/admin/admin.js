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
    { id: 'hero', label: 'トップ画像', page: 'index', section: 'top' },
    { id: 'price', label: '料金', page: 'index', section: 'system' },
    { id: 'recruit', label: '求人', page: 'recruit', section: 'recruit' },
    { id: 'shop', label: '店舗情報', page: 'index', section: 'info' },
    { id: 'branches', label: '支店', page: 'index', section: 'branches' },
    { id: 'sns', label: 'SNS', page: 'index', section: 'footer' },
    { id: 'theme', label: 'デザイン', page: 'index', section: 'top' },
  ];
  const SNS_TYPES = [['instagram', 'Instagram'], ['x', 'X'], ['tiktok', 'TikTok'], ['line', 'LINE'], ['youtube', 'YouTube'], ['web', 'その他URL']];
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
    s.system ||= {};
    if (s.system.items) { s.system.plans = [{ title: '', items: s.system.items }]; delete s.system.items; }
    s.system.plans ||= [];
    s.system.plans.forEach((p) => { p.items ||= []; });
    s.shift ||= { enabled: true, defaultTime: '20:00〜', dayStart: 6 };
    s.shifts ||= {};
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
    for (const c of s.casts) { c.id ||= uid(); c.tags ||= []; if (c.visible === undefined) c.visible = true; }
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
    $('#tabs').innerHTML = TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === tab ? 'on' : ''}">${t.label}</button>`).join('');
  }
  function selectTab(id) {
    tab = id;
    history.replaceState(null, '', '#' + id);
    renderTabs();
    renderPanel();
    panel.scrollTop = 0;
    syncPreview();
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

  // ---------- 各タブ ----------
  const dayInfo = (k) => { const d = parseKey(k); return { md: `${d.getMonth() + 1}/${d.getDate()}`, dow: DOW[d.getDay()], w: d.getDay(), d: d.getDate() }; };
  const dayCls = (k, tk) => { const w = parseKey(k).getDay(); return (k === tk ? ' today' : '') + (w === 0 ? ' sun' : w === 6 ? ' sat' : ''); };
  const monthKeys = () => {
    const [y, m] = monthCursor.split('-').map(Number);
    return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${monthCursor}-${pad(i + 1)}`);
  };
  const weekKeys = () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const views = {
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
        <p class="hint">名前を押すと詳細を編集できます。並び順がそのままサイトの掲載順です。出勤の入力は「出勤」タブで。</p>
        <ul class="list">${site.casts.map((c, i) => {
          const open = openItems.has(c.id);
          return `<li class="item ${c.visible === false ? 'off' : ''} ${open ? 'open' : ''}">
            <div class="row">
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
        <p class="hint">ページ最下部にアイコンで並びます。URL が空のものは表示されません。</p>
        ${s.map((x, i) => `<div class="inline">
          <select data-path="sns.${i}.type">${SNS_TYPES.map(([v, l]) => `<option value="${v}" ${x.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input data-path="sns.${i}.url" value="${esc(x.url)}" placeholder="https://..." type="url">
          ${ord('sns', i, s.length)}
          <button class="icon-btn" data-act="del" data-list="sns" data-i="${i}" data-now aria-label="削除">×</button>
        </div>`).join('')}
        <h3>追加</h3>
        <div class="bar">${SNS_TYPES.map(([v, l]) => `<button class="btn sm" data-act="sns-add" data-type="${v}">＋ ${l}</button>`).join('')}</div>`;
    },

    theme() {
      const t = site.theme;
      return `
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
  }

  // ---------- 入力 ----------
  panel.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'brush') { brush = el.value; return; }
    const path = el.dataset.path;
    if (!path) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
    else if ('list' in el.dataset) v = el.value.split(/[、,，\n]+/).map((x) => x.trim()).filter(Boolean);
    else v = el.value;
    setPath(path, v);
    // 一覧の見出しなど、入力欄以外の表示を追従させる
    panel.querySelectorAll(`[data-label="${path}"]`).forEach((n) => { n.textContent = v || '（名前未入力）'; });
    if (el.type === 'color') el.nextElementSibling.nextElementSibling.textContent = v;
    const structural = el.type === 'checkbox' || el.type === 'color';
    changed({ rerender: structural });
  });

  panel.addEventListener('click', async (e) => {
    const sub = e.target.closest('[data-sub]');
    if (sub) { recruitSub = sub.dataset.sub; renderPanel(); syncPreview(); return; }
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
      const c = { id: uid(), name: '', profile: '', tags: ['新人'], comment: '', photo: '', visible: true };
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
  async function upload(file, max) {
    try {
      toast('画像をアップロード中…');
      if (DEMO) max = Math.min(max, 640); // ブラウザ保存は容量が小さいので控えめに
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', DEMO ? 0.75 : 0.86);
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
    $('#loginForm [name=password]').focus();
  }
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('#loginErr').textContent = '';
    const r = await fetch('../api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) });
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
    renderTabs();
    changed({ rerender: true });
    syncPreview();
  }
  start();
})();
