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
for (const [file, page] of [['index.html', 'index'], ['recruit.html', 'recruit']]) {
  const p = path.join(out, file);
  fs.writeFileSync(p, seo.injectHead(fs.readFileSync(p, 'utf8'), site, page));
}
const sm = seo.sitemap(site);
if (sm) fs.writeFileSync(path.join(out, 'sitemap.xml'), sm);
fs.writeFileSync(path.join(out, 'robots.txt'), seo.robots(site));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`書き出しました: ${out}`);
