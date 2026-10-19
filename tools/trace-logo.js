// 使い方（ロゴを差し替えたとき）:
//   別フォルダで  npm i potrace@2.1.8  をしてから
//   node tools/trace-logo.js public/no-photo.jpg public/logo-elf-v2.svg（作り直したら名前を変えると古いキャッシュが残らない）
// ※紋章・文字の切り出し位置（em / tx）は元画像に合わせて調整が必要
// 縦長ロゴ（白背景JPG）を紋章と文字に分けてベクター化し、横並びの SVG にする
const Jimp = require('jimp');
const { Potrace } = require('potrace');
const fs = require('fs');
const SRC = process.argv[2], OUT = process.argv[3];
const UP = 4; // 4倍に滑らかに拡大してから輪郭をとる（曲線がなめらかになる）

// 細い線（C の左上のヘアラインなど）は薄い金色なので、基準を上げて拾う。上げすぎると JPEG のノイズまで拾う
const T_EMBLEM = Number(process.env.T_EMBLEM || 228), T_TEXT = Number(process.env.T_TEXT || 236);
const trace = (img, threshold) => new Promise((ok, ng) => {
  const p = new Potrace({ threshold, turdSize: 6, optTolerance: 0.25, alphaMax: 1.0, turnPolicy: Potrace.TURNPOLICY_MINORITY });
  p.loadImage(img, (e) => (e ? ng(e) : ok(p.getPathTag('#000').match(/ d="([^"]+)"/)[1])));
});

(async () => {
  const src = await Jimp.read(SRC);
  // 金色の代表色（濃い画素の平均）
  let r = 0, g = 0, b = 0, n = 0;
  src.scan(0, 0, src.bitmap.width, src.bitmap.height, function (x, y, i) {
    const d = this.bitmap.data; if (Math.min(d[i], d[i+1], d[i+2]) < 120) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
  });
  const gold = [r / n, g / n, b / n].map(Math.round);
  // 境目は前回の解析結果（紋章 21-296 行 / 文字 346-507 行）。左右は余白込みで広めに
  const part = (x, y, w, h) => src.clone().crop(x, y, w, h).resize(w * UP, h * UP, Jimp.RESIZE_BICUBIC);
  const em = { x: 28, y: 17, w: 368, h: 284 }, tx = { x: 90, y: 342, w: 251, h: 170 };
  const emD = await trace(part(em.x, em.y, em.w, em.h), T_EMBLEM);
  const txD = await trace(part(tx.x, tx.y, tx.w, tx.h), T_TEXT);
  // 配置（単位は拡大後の px）。文字ブロックは紋章の 7 割の高さ
  const EW = em.w * UP, EH = em.h * UP, TW = tx.w * UP, TH = tx.h * UP;
  const s = (EH * 0.7) / TH, gap = EH * 0.12;
  const W = Math.round(EW + gap + TW * s), H = EH;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="CLUB ELF">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#f4dc9a"/><stop offset=".48" stop-color="rgb(${gold})"/><stop offset="1" stop-color="#e2bd6a"/>
</linearGradient></defs>
<g fill="url(#g)" fill-rule="evenodd">
<path d="${emD}"/>
<path transform="translate(${(EW + gap).toFixed(1)} ${((EH - TH * s) / 2).toFixed(1)}) scale(${s.toFixed(4)})" d="${txD}"/>
</g></svg>
`;
  fs.writeFileSync(OUT, svg);
  console.log({ gold, W, H, kb: Math.round(svg.length / 1024) });
})().catch((e) => { console.error(e); process.exit(1); });
