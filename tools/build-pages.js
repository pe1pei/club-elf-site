// GitHub Pages（サーバーなし）用に静的ファイルを書き出す。
// 使い方: node tools/build-pages.js <出力先フォルダ>
// public/ の中身に、site.json・検索/SNS 向けの <head> 情報・sitemap.xml・robots.txt を加える。
const fs = require('fs');
const path = require('path');
const seo = require('../lib/seo');

const root = path.join(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('出力先フォルダを指定してください'); process.exit(1); }

const site = JSON.parse(fs.readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.copyFileSync(path.join(root, 'data', 'site.json'), path.join(out, 'site.json'));
// GitHub Pages はファイルを約10分キャッシュさせるため、更新直後に「古い JS ＋ 新しいデータ」が混ざる。
// 書き出しごとに JS / CSS の URL に版番号を付けて、HTML が新しければ必ず新しい JS / CSS を読ませる。
const ver = Date.now().toString(36);
const bust = (html) => html.replace(/(href|src)="((?:site|admin)\.(?:css|js))"/g, `$1="$2?v=${ver}"`);
const adminIndex = path.join(out, 'admin', 'index.html');
fs.writeFileSync(adminIndex, bust(fs.readFileSync(adminIndex, 'utf8')));
for (const [file, page] of [['index.html', 'index'], ['recruit.html', 'recruit']]) {
  const p = path.join(out, file);
  fs.writeFileSync(p, bust(seo.injectHead(fs.readFileSync(p, 'utf8'), site, page)));
}
const sm = seo.sitemap(site);
if (sm) fs.writeFileSync(path.join(out, 'sitemap.xml'), sm);
fs.writeFileSync(path.join(out, 'robots.txt'), seo.robots(site));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`書き出しました: ${out}`);
