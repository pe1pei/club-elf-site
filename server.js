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

const sessions = new Map(); // sid -> 有効期限
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

function authed(req) {
  const sid = sessionId(req);
  const exp = sid && sessions.get(sid);
  if (!exp || exp < Date.now()) { if (sid) sessions.delete(sid); return false; }
  sessions.set(sid, Date.now() + SESSION_TTL);
  return true;
}

// 他サイトからの書き込みリクエストを弾く（SameSite Cookie と二重の守り）
function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || o === `http://${req.headers.host}` || o === `https://${req.headers.host}`;
}

function passwordOk(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
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
    return json(res, 200, JSON.parse(await fsp.readFile(DATA, 'utf8')));
  }
  if (route === 'POST /api/login') {
    const { password } = JSON.parse(await readBody(req, 10e3) || '{}');
    if (!passwordOk(password || '')) {
      await new Promise((r) => setTimeout(r, 800)); // 総当たり対策の遅延
      return json(res, 401, { error: 'パスワードが違います' });
    }
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, Date.now() + SESSION_TTL);
    return json(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}` });
  }
  if (route === 'POST /api/logout') {
    sessions.delete(sessionId(req));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (!authed(req)) return json(res, 401, { error: 'ログインが必要です' });

  if (route === 'GET /api/me') {
    return json(res, 200, { ok: true, defaultPassword: PASSWORD === 'changeme' });
  }
  if (route === 'PUT /api/site') {
    const site = JSON.parse(await readBody(req, 2e6));
    if (!site || typeof site !== 'object' || !site.shop || !Array.isArray(site.casts)) {
      return json(res, 400, { error: 'データの形式が正しくありません' });
    }
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
