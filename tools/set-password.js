// 管理画面のパスワードを設定する。入力は画面に表示されず、data/config.json にはハッシュだけを保存する。
// 使い方: node tools/set-password.js
// （PHP 版・Node 版のどちらの管理画面もこのファイルで照合する。config.json は Git に入れない）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'config.json');
const ITER = 210000;

function ask(label) {
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
        if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const pw = await ask('新しい管理パスワード（8文字以上・入力は表示されません）: ');
  if ([...pw].length < 8) { console.error('8文字以上にしてください'); process.exit(1); }
  const again = await ask('もう一度入力: ');
  if (pw !== again) { console.error('一致しませんでした。やり直してください'); process.exit(1); }
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256');
  const cfg = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  cfg.password = { algo: 'pbkdf2-sha256', iter: ITER, salt: salt.toString('base64'), hash: hash.toString('base64') };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
  console.log('設定しました（data/config.json）。さくらに反映するには build-sakura のあと data/config.json もアップロードしてください。');
})();
