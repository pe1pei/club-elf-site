// 検索エンジン・SNS 向けの <head> 情報を site.json から作る。
// server.js（配信時）と tools/build-pages.js（GitHub Pages 用の書き出し時）の両方で使う。
// JS 実行前の HTML に入れておかないと、LINE / X のリンクプレビューなどが読めないため。

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function absUrl(siteUrl, p) {
  if (!p) return '';
  if (/^https?:\/\//.test(p)) return p;
  if (!siteUrl) return '';
  try { return new URL(String(p).replace(/^\//, ''), siteUrl.endsWith('/') ? siteUrl : siteUrl + '/').href; } catch { return ''; }
}

// 「〒411-0036 静岡県三島市一番町11-14 …」を構造化データ用に分解する
function parseAddress(addr) {
  const s = String(addr || '');
  const zip = s.match(/〒?\s*(\d{3}-?\d{4})/);
  const rest = s.replace(/〒?\s*\d{3}-?\d{4}\s*/, '').trim();
  const pref = rest.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);
  const afterPref = pref ? rest.slice(pref[1].length) : rest;
  const city = afterPref.match(/^(.+?[市区町村])/);
  return {
    '@type': 'PostalAddress',
    ...(zip && { postalCode: zip[1] }),
    ...(pref && { addressRegion: pref[1] }),
    ...(city && { addressLocality: city[1] }),
    streetAddress: (city ? afterPref.slice(city[1].length) : afterPref).trim(),
    addressCountry: 'JP',
  };
}

const recruitOn = (site) => ['cast', 'staff'].some((k) => site.recruit?.[k]?.enabled);

function pageMeta(site, page) {
  const seo = site.seo || {};
  const shop = site.shop || {};
  if (page === 'recruit') {
    return {
      title: seo.recruitTitle || `求人情報 | ${shop.name || ''}`,
      description: seo.recruitDescription || '',
      path: 'recruit.html',
    };
  }
  return { title: seo.title || shop.name || '', description: seo.description || '', path: '' };
}

function buildHead(site, page) {
  const seo = site.seo || {};
  const shop = site.shop || {};
  const m = pageMeta(site, page);
  const url = absUrl(seo.siteUrl, m.path || './');
  const image = absUrl(seo.siteUrl, seo.ogImage || 'no-photo.webp');
  const tags = [
    `<title>${esc(m.title)}</title>`,
    m.description && `<meta name="description" content="${esc(m.description)}">`,
    (seo.keywords || []).length && `<meta name="keywords" content="${esc(seo.keywords.join(','))}">`,
    url && `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="ja_JP">`,
    `<meta property="og:site_name" content="${esc(shop.name)}">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    m.description && `<meta property="og:description" content="${esc(m.description)}">`,
    url && `<meta property="og:url" content="${esc(url)}">`,
    image && `<meta property="og:image" content="${esc(image)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<link rel="icon" href="no-photo.webp">`,
  ];

  if (page !== 'recruit') {
    const sameAs = (site.sns || []).map((x) => String(x.url || '').trim()).filter((u) => /^https?:\/\//.test(u));
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'NightClub',
      name: shop.name,
      ...(shop.kana && { alternateName: shop.kana }),
      ...(m.description && { description: m.description }),
      ...(url && { url }),
      ...(image && { image }),
      ...(shop.phone && { telephone: shop.phone }),
      ...(seo.priceRange && { priceRange: seo.priceRange }),
      ...(shop.address && { address: parseAddress(shop.address) }),
      ...(sameAs.length && { sameAs }),
    };
    // </script> で閉じられないよう < をエスケープ
    tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  }
  return tags.filter(Boolean).join('\n');
}

// HTML 内の空の <title></title> を、上の情報一式に置き換える
const injectHead = (html, site, page) => html.replace('<title></title>', () => buildHead(site, page));

function sitemap(site) {
  const base = site.seo?.siteUrl;
  if (!base) return '';
  const today = new Date().toISOString().slice(0, 10);
  const pages = [['', '1.0', 'daily']];
  if (recruitOn(site)) pages.push(['recruit.html', '0.8', 'weekly']);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([p, pr, cf]) => `  <url><loc>${esc(absUrl(base, p || './'))}</loc><lastmod>${today}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`;
}

function robots(site) {
  const sm = site.seo?.siteUrl ? `\nSitemap: ${absUrl(site.seo.siteUrl, 'sitemap.xml')}` : '';
  return `User-agent: *\nAllow: /\nDisallow: /admin/\n${sm}\n`;
}

module.exports = { buildHead, injectHead, sitemap, robots, parseAddress };
