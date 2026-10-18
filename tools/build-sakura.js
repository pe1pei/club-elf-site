// さくらのレンタルサーバ（PHP）にアップロードするフォルダを作る。
// 使い方: node tools/build-sakura.js [出力先]   （省略時は dist-sakura/）
//
// 出来上がったフォルダの中身を、ドメインの公開フォルダにそのままアップロードする。
// ・data/site.json（本番で入力したデータ）は含めないので、更新時に上書きされない
//   （初回だけ data/site.default.json から自動で作られる）
// ・uploads/ の中の画像も含めない（本番でアップロードした写真を消さないため）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist-sakura'));
const pub = path.join(root, 'public');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 公開ファイル（HTML はテンプレートとして templates/ へ。uploads/ の中身は除く）
fs.cpSync(pub, out, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(pub, src).replace(/\\/g, '/');
    return !/^(index\.html|recruit\.html|admin\/index\.html)$/.test(rel) && !/^uploads\/.+/.test(rel);
  },
});
// PHP・.htaccess
fs.cpSync(path.join(root, 'sakura'), out, { recursive: true });
// テンプレート
fs.copyFileSync(path.join(pub, 'index.html'), path.join(out, 'templates', 'index.html'));
fs.copyFileSync(path.join(pub, 'recruit.html'), path.join(out, 'templates', 'recruit.html'));
fs.copyFileSync(path.join(pub, 'admin', 'index.html'), path.join(out, 'templates', 'admin.html'));
// 初期データとパスワード
fs.copyFileSync(path.join(root, 'data', 'site.json'), path.join(out, 'data', 'site.default.json'));
const cfg = path.join(root, 'data', 'config.json');
if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(out, 'data', 'config.json'));
else console.warn('※ data/config.json がありません。先に node tools/set-password.js でパスワードを設定してください。');

console.log(`作成しました: ${out}`);
