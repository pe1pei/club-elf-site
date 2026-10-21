// 管理画面のアカウント（ID ＋ パスワード）を PC から設定する。締め出されたときの復旧用。
// 入力したパスワードは画面に表示されず、data/config.json にはハッシュだけを保存する。
// 使い方: node tools/set-password.js
//   ・既にある ID を入れる → その人のパスワードを変更（権限は管理者にする）
//   ・新しい ID を入れる   → 管理者として追加
// ふだんの ID・パスワードの変更やユーザー追加は、管理画面の「アカウント」タブで行う。
// 本番に反映するには、このあと data/config.json をサーバーへアップロードする。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'config.json');
const ITER = 210000;

function ask(label, { hidden = false } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    let buf = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (c === '\u0003') process.exit(1); // Ctrl+C
        if (c === '\u007f' || c === '\b') { if (buf) { buf = buf.slice(0, -1); if (!hidden) process.stdout.write('\b \b'); } continue; }
        buf += c;
        if (!hidden) process.stdout.write(c);
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const cfg = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  // 旧形式（password だけ）は ID「admin」として扱う
  if (!Array.isArray(cfg.users)) {
    cfg.users = cfg.password ? [{ id: 'admin', role: 'admin', password: cfg.password, created: new Date().toISOString() }] : [];
    delete cfg.password;
  }
  if (cfg.users.length) console.log('登録済みの ID: ' + cfg.users.map((u) => u.id).join(', '));

  const id = (await ask('ID（空欄なら admin）: ')).trim() || 'admin';
  if (!/^[A-Za-z0-9_.@-]{3,32}$/.test(id)) { console.error('ID は半角英数字と _ . @ - で3〜32文字にしてください'); process.exit(1); }
  const pw = await ask('新しいパスワード（8文字以上・入力は表示されません）: ', { hidden: true });
  if ([...pw].length < 8) { console.error('8文字以上にしてください'); process.exit(1); }
  const again = await ask('もう一度入力: ', { hidden: true });
  if (pw !== again) { console.error('一致しませんでした。やり直してください'); process.exit(1); }

  const salt = crypto.randomBytes(16);
  const password = { algo: 'pbkdf2-sha256', iter: ITER, salt: salt.toString('base64'), hash: crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256').toString('base64') };
  const i = cfg.users.findIndex((u) => u.id.toLowerCase() === id.toLowerCase());
  if (i >= 0) { cfg.users[i].password = password; cfg.users[i].role = 'admin'; }
  else cfg.users.push({ id, role: 'admin', password, created: new Date().toISOString() });

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${i >= 0 ? '変更' : '追加'}しました（ID: ${id}・管理者）。本番に反映するには data/config.json をサーバーへアップロードしてください。`);
})();
