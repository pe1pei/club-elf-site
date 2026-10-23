// 依存パッケージなしで動く小さなサーバー。`node server.js` で起動。
// 公開ページ: http://localhost:3200/   管理画面: http://localhost:3200/admin/
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const seo = require('./lib/seo');

const PORT = Number(process.env.PORT) || 3200;
const PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const PUB = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA = path.join(DATA_DIR, 'site.json');
const BACKUP = path.join(DATA_DIR, 'backups');
const UPLOADS = path.join(PUB, 'uploads');
const SESSION_TTL = 12 * 3600e3;
const KEEP_BACKUPS = 30;

for (const d of [BACKUP, UPLOADS]) fs.mkdirSync(d, { recursive: true });

const sessions = new Map(); // sid -> { exp: 有効期限, uid: ユーザーID }
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('サイズが大きすぎます'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sessionId(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{48})/.exec(req.headers.cookie || '');
  return m && m[1];
}

// 他サイトからの書き込みリクエストを弾く（SameSite Cookie と二重の守り）
function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || o === `http://${req.headers.host}` || o === `https://${req.headers.host}`;
}

// ---------- アカウント（ID ＋ パスワード）。PHP 版と同じ data/config.json を使う ----------
// users: [{ id, role: admin|staff, password: PBKDF2 ハッシュ, created }]。旧形式（password だけ）は ID「admin」として読む。
// config.json が無いとき（手元の開発用）は ID「admin」/ ADMIN_PASSWORD でログインできる。
const CONFIG = path.join(DATA_DIR, 'config.json');
const PW_ITER = 210000;
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return { algo: 'pbkdf2-sha256', iter: PW_ITER, salt: salt.toString('base64'), hash: crypto.pbkdf2Sync(pw, salt, PW_ITER, 32, 'sha256').toString('base64') };
}
function verifyPw(p, pw) {
  if (!p || p.algo !== 'pbkdf2-sha256') { crypto.pbkdf2Sync(String(pw), 'dummy-salt-0000', PW_ITER, 32, 'sha256'); return false; }
  const calc = crypto.pbkdf2Sync(String(pw), Buffer.from(p.salt, 'base64'), p.iter, 32, 'sha256');
  return crypto.timingSafeEqual(calc, Buffer.from(p.hash, 'base64'));
}
let devUsers = null;
function loadConfig() {
  if (!fs.existsSync(CONFIG)) {
    devUsers ||= [{ id: 'admin', role: 'admin', password: hashPw(PASSWORD), created: new Date().toISOString() }];
    return { users: devUsers, dev: true };
  }
  const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (!Array.isArray(c.users) && c.password) {
    c.users = [{ id: 'admin', role: 'admin', password: c.password, created: new Date().toISOString() }];
    delete c.password;
  }
  c.users ||= [];
  return c;
}
function saveConfig(c) {
  delete c.dev;
  fs.writeFileSync(CONFIG + '.tmp', JSON.stringify(c, null, 2));
  fs.renameSync(CONFIG + '.tmp', CONFIG);
}
const userIndex = (c, id) => c.users.findIndex((u) => u.id.toLowerCase() === String(id).toLowerCase());
const validId = (id) => /^[A-Za-z0-9_.@-]{3,32}$/.test(id);
const validPw = (pw) => [...pw].length >= 8 && [...pw].length <= 128;
const adminCount = (c) => c.users.filter((u) => u.role === 'admin').length;
const publicUser = (u) => ({ id: u.id, role: u.role || 'staff', created: u.created || '' });

function currentUser(req) {
  const sid = sessionId(req);
  const s = sid && sessions.get(sid);
  if (!s || s.exp < Date.now()) { if (sid) sessions.delete(sid); return null; }
  const c = loadConfig();
  const i = userIndex(c, s.uid);
  if (i < 0) return null;
  s.exp = Date.now() + SESSION_TTL;
  return c.users[i];
}

// ---------- あいことばクーポン（PHP 版と同じ規則。3:01 区切り・前日と同じものは選ばない） ----------
const COUPON_FILE = path.join(DATA_DIR, 'coupon.json');
const jst = (t) => new Date(t + 9 * 3600e3); // 日本時間の日付計算用
const couponDay = (t = Date.now()) => jst(t - (3 * 3600 + 60) * 1000).toISOString().slice(0, 10);
function couponTerm(day) {
  const from = Date.parse(day + 'T03:01:00+09:00'), to = from + 86400e3 - 60e3;
  const f = (t) => { const d = jst(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  return { day, from: f(from), to: f(to) };
}
const couponActive = (list) => (list || []).filter((x) => x && x.on !== false && String(x.text || '').trim() && x.id);
function couponPick(active, avoid) {
  const pool = active.length > 1 ? active.filter((x) => x.id !== avoid) : active;
  return pool[crypto.randomInt(pool.length)];
}
function couponToday(site) {
  const cp = site.coupon || {};
  if (!cp.enabled) return null;
  const words = couponActive(cp.words), perks = couponActive(cp.perks);
  if (!words.length || !perks.length) return null;
  const state = fs.existsSync(COUPON_FILE) ? JSON.parse(fs.readFileSync(COUPON_FILE, 'utf8')) : { days: {} };
  const day = couponDay();
  const today = state.days[day];
  let w = today && words.find((x) => x.id === today.wordId);
  let p = today && perks.find((x) => x.id === today.perkId);
  if (!w || !p) {
    const prev = state.days[couponDay(Date.parse(day + 'T12:00:00+09:00') - 86400e3)] || {};
    w ||= couponPick(words, prev.wordId);
    p ||= couponPick(perks, prev.perkId);
  }
  state.days[day] = { wordId: w.id, perkId: p.id, word: w.text.trim(), perk: p.text.trim() };
  state.days = Object.fromEntries(Object.entries(state.days).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 90));
  fs.writeFileSync(COUPON_FILE, JSON.stringify(state, null, 2));
  return { word: w.text.trim(), perk: p.text.trim(), ...couponTerm(day) };
}
function couponHistory(n = 14) {
  const state = fs.existsSync(COUPON_FILE) ? JSON.parse(fs.readFileSync(COUPON_FILE, 'utf8')) : { days: {} };
  return Object.entries(state.days).slice(0, n).map(([day, d]) => ({ word: d.word, perk: d.perk, ...couponTerm(day) }));
}
function publicSite(site) {
  const out = { ...site, couponToday: couponToday(site) };
  if (site.coupon) out.coupon = { title: site.coupon.title || '', note: site.coupon.note || '' };
  return out;
}

async function saveSite(site) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(DATA)) await fsp.copyFile(DATA, path.join(BACKUP, `site-${stamp}.json`));
  const tmp = DATA + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(site, null, 2));
  await fsp.rename(tmp, DATA);
  const old = (await fsp.readdir(BACKUP)).filter((f) => f.endsWith('.json')).sort().reverse().slice(KEEP_BACKUPS);
  await Promise.all(old.map((f) => fsp.unlink(path.join(BACKUP, f))));
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: '不正なリクエストです' });

  if (route === 'GET /api/site') {
    const site = JSON.parse(await fsp.readFile(DATA, 'utf8'));
    // ログイン中（管理画面）は全部、一般の閲覧者には合言葉・特典の一覧を渡さず今日の分だけ
    return json(res, 200, currentUser(req) ? { ...site, couponToday: couponToday(site) } : publicSite(site));
  }
  // アクセス集計は本番（さくら・PHP 版）で行う。手元の Node 版では受け取るだけ
  if (route === 'POST /api/hit') { res.writeHead(204); return res.end(); }
  if (route === 'POST /api/login') {
    const c = loadConfig();
    const { id = '', password = '' } = JSON.parse(await readBody(req, 10e3) || '{}');
    const i = userIndex(c, String(id).trim());
    if (!verifyPw(i >= 0 ? c.users[i].password : null, password)) {
      await new Promise((r) => setTimeout(r, 800)); // 総当たり対策の遅延
      return json(res, 401, { error: 'ID またはパスワードが違います' });
    }
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { exp: Date.now() + SESSION_TTL, uid: c.users[i].id });
    return json(res, 200, { ok: true, user: publicUser(c.users[i]) }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}` });
  }
  if (route === 'POST /api/logout') {
    sessions.delete(sessionId(req));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  const me = currentUser(req);
  if (!me) return json(res, 401, { error: 'ログインが必要です' });

  if (route === 'GET /api/coupon') {
    return json(res, 200, { today: couponToday(JSON.parse(await fsp.readFile(DATA, 'utf8'))), history: couponHistory(14) });
  }
  if (route === 'GET /api/stats') {
    const days = Math.max(1, Math.min(400, Number(url.searchParams.get('days')) || 30));
    const list = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 864e5);
      return { date: d.toISOString().slice(0, 10), views: 0, visitors: 0 };
    });
    return json(res, 200, { days: list, sources: {}, pages: {}, views: 0, visitors: 0, local: true });
  }
  if (route === 'GET /api/me') {
    return json(res, 200, { ok: true, defaultPassword: !!loadConfig().dev && PASSWORD === 'changeme', user: publicUser(me) });
  }
  // 自分の ID・パスワードの変更（今のパスワードが必要）
  if (route === 'POST /api/account') {
    const b = JSON.parse(await readBody(req, 10e3) || '{}');
    const c = loadConfig();
    const i = userIndex(c, me.id);
    if (!verifyPw(c.users[i].password, b.currentPassword || '')) {
      await new Promise((r) => setTimeout(r, 800));
      return json(res, 400, { error: '今のパスワードが違います' });
    }
    const newId = String(b.newId || '').trim();
    const newPw = String(b.newPassword || '');
    if (!newId && !newPw) return json(res, 400, { error: '変更する内容を入力してください' });
    if (newId) {
      if (!validId(newId)) return json(res, 400, { error: 'ID は半角英数字と _ . @ - で3〜32文字にしてください' });
      const j = userIndex(c, newId);
      if (j >= 0 && j !== i) return json(res, 400, { error: 'その ID はすでに使われています' });
      c.users[i].id = newId;
      sessions.get(sessionId(req)).uid = newId;
    }
    if (newPw) {
      if (!validPw(newPw)) return json(res, 400, { error: 'パスワードは8文字以上にしてください' });
      c.users[i].password = hashPw(newPw);
    }
    saveConfig(c);
    return json(res, 200, { ok: true, user: publicUser(c.users[i]) });
  }
  // ユーザー管理（管理者だけ）
  if (url.pathname.startsWith('/api/users')) {
    if (me.role !== 'admin') return json(res, 403, { error: 'この操作は管理者だけができます' });
    const c = loadConfig();
    const list = () => c.users.map(publicUser);
    if (route === 'GET /api/users') return json(res, 200, { users: list() });
    const b = JSON.parse(await readBody(req, 10e3) || '{}');
    const id = String(b.id || '').trim();
    const role = ['admin', 'staff'].includes(b.role) ? b.role : null;
    if (route === 'POST /api/users') {
      if (!validId(id)) return json(res, 400, { error: 'ID は半角英数字と _ . @ - で3〜32文字にしてください' });
      if (userIndex(c, id) >= 0) return json(res, 400, { error: 'その ID はすでに使われています' });
      if (!validPw(String(b.password || ''))) return json(res, 400, { error: 'パスワードは8文字以上にしてください' });
      c.users.push({ id, role: role || 'staff', password: hashPw(String(b.password)), created: new Date().toISOString() });
      saveConfig(c);
      return json(res, 200, { ok: true, users: list() });
    }
    const i = userIndex(c, id);
    if (i < 0) return json(res, 404, { error: 'そのユーザーは見つかりません' });
    if (route === 'POST /api/users/update') {
      if (role && role !== 'admin' && c.users[i].role === 'admin' && adminCount(c) <= 1) return json(res, 400, { error: '管理者が1人もいなくなるため変更できません' });
      if (role) c.users[i].role = role;
      if (b.password) {
        if (!validPw(String(b.password))) return json(res, 400, { error: 'パスワードは8文字以上にしてください' });
        c.users[i].password = hashPw(String(b.password));
      }
      saveConfig(c);
      return json(res, 200, { ok: true, users: list() });
    }
    if (route === 'POST /api/users/delete') {
      if (c.users[i].id.toLowerCase() === me.id.toLowerCase()) return json(res, 400, { error: '自分自身は削除できません' });
      if (c.users[i].role === 'admin' && adminCount(c) <= 1) return json(res, 400, { error: '最後の管理者は削除できません' });
      c.users.splice(i, 1);
      saveConfig(c);
      return json(res, 200, { ok: true, users: list() });
    }
  }
  if (route === 'PUT /api/site') {
    const site = JSON.parse(await readBody(req, 2e6));
    if (!site || typeof site !== 'object' || !site.shop || !Array.isArray(site.casts)) {
      return json(res, 400, { error: 'データの形式が正しくありません' });
    }
    delete site.couponToday; // 表示用に付けた値は保存しない
    await saveSite(site);
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/upload') {
    const { dataUrl } = JSON.parse(await readBody(req, 14e6));
    const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) return json(res, 400, { error: '画像ファイルを選んでください' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 10e6) return json(res, 413, { error: '画像が大きすぎます（10MBまで）' });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    await fsp.writeFile(path.join(UPLOADS, name), buf);
    return json(res, 200, { url: `uploads/${name}` });
  }
  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  if (rel === '/recruit') rel = '/recruit.html';
  if (rel.endsWith('/')) rel += 'index.html';

  // 公開ページは、検索・SNS 向けの <head> 情報を最新データで埋め込んで返す
  const page = { '/index.html': 'index', '/recruit.html': 'recruit' }[rel];
  if (page || rel === '/sitemap.xml' || rel === '/robots.txt') {
    const site = JSON.parse(await fsp.readFile(DATA, 'utf8'));
    let body, type;
    if (page) { body = seo.injectHead(await fsp.readFile(path.join(PUB, rel), 'utf8'), site, page); type = MIME['.html']; }
    else if (rel === '/sitemap.xml') { body = seo.sitemap(site); type = 'application/xml; charset=utf-8'; }
    else { body = seo.robots(site); type = 'text/plain; charset=utf-8'; }
    res.writeHead(body ? 200 : 404, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return res.end(body);
  }
  const file = path.join(PUB, path.normalize(rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error();
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      // アップロード画像は名前が毎回変わるので長期キャッシュしてよい
      'Cache-Control': rel.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    res.end('<!doctype html><meta charset="utf-8"><title>404</title><p>ページが見つかりません。<a href="/">トップへ</a></p>');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    if (!res.headersSent) json(res, e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.status ? e.message : 'サーバーエラーが発生しました' });
    if (!e.status && !(e instanceof SyntaxError)) console.error(e);
  }
}).listen(PORT, () => {
  console.log(`公開ページ : http://localhost:${PORT}/`);
  console.log(`管理画面   : http://localhost:${PORT}/admin/`);
  if (PASSWORD === 'changeme') console.log('※ 管理パスワードが初期値(changeme)です。ADMIN_PASSWORD を設定してください。');
});
