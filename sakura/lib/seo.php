<?php
// 検索エンジン・SNS 向けの <head> 情報を作る（Node 版 lib/seo.js の PHP 移植。中身は同じ）
declare(strict_types=1);

function h(mixed $s): string {
    return htmlspecialchars((string) ($s ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function abs_url(string $siteUrl, string $p): string {
    if ($p === '') return '';
    if (preg_match('#^https?://#', $p)) return $p;
    if ($siteUrl === '') return '';
    $base = rtrim($siteUrl, '/') . '/';
    $p = ltrim($p, '/');
    return $p === './' ? $base : $base . $p;
}

// サイトの URL。SEO タブで未設定なら、今アクセスされているドメインから作る
function site_url(array $site): string {
    $u = trim((string) ($site['seo']['siteUrl'] ?? ''));
    if ($u !== '' && !str_contains($u, 'github.io')) return $u;
    $scheme = is_https() ? 'https' : 'http';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';
}

// 「〒411-0036 静岡県三島市一番町11-14 …」を構造化データ用に分解する
function parse_address(string $addr): array {
    $zip = preg_match('/〒?\s*(\d{3}-?\d{4})/u', $addr, $m) ? $m[1] : null;
    $rest = trim((string) preg_replace('/〒?\s*\d{3}-?\d{4}\s*/u', '', $addr, 1));
    $pref = preg_match('/^(東京都|北海道|(?:京都|大阪)府|.{2,3}?県)/u', $rest, $m) ? $m[1] : null;
    $after = $pref ? mb_substr($rest, mb_strlen($pref)) : $rest;
    $city = preg_match('/^(.+?[市区町村])/u', $after, $m) ? $m[1] : null;
    $out = ['@type' => 'PostalAddress'];
    if ($zip) $out['postalCode'] = $zip;
    if ($pref) $out['addressRegion'] = $pref;
    if ($city) $out['addressLocality'] = $city;
    $out['streetAddress'] = trim($city ? mb_substr($after, mb_strlen($city)) : $after);
    $out['addressCountry'] = 'JP';
    return $out;
}

function recruit_on(array $site): bool {
    return !empty($site['recruit']['cast']['enabled']) || !empty($site['recruit']['staff']['enabled']);
}

function build_head(array $site, string $page): string {
    $seo = $site['seo'] ?? [];
    $shop = $site['shop'] ?? [];
    $base = site_url($site);
    if ($page === 'recruit') {
        $title = ($seo['recruitTitle'] ?? '') ?: '求人情報 | ' . ($shop['name'] ?? '');
        $desc = $seo['recruitDescription'] ?? '';
        $url = abs_url($base, 'recruit.html');
    } else {
        $title = ($seo['title'] ?? '') ?: ($shop['name'] ?? '');
        $desc = $seo['description'] ?? '';
        $url = $base;
    }
    $image = abs_url($base, ($seo['ogImage'] ?? '') ?: 'no-photo.jpg');
    $kw = $seo['keywords'] ?? [];
    $tags = array_filter([
        '<title>' . h($title) . '</title>',
        $desc ? '<meta name="description" content="' . h($desc) . '">' : '',
        $kw ? '<meta name="keywords" content="' . h(implode(',', $kw)) . '">' : '',
        '<link rel="canonical" href="' . h($url) . '">',
        '<meta property="og:type" content="website">',
        '<meta property="og:locale" content="ja_JP">',
        '<meta property="og:site_name" content="' . h($shop['name'] ?? '') . '">',
        '<meta property="og:title" content="' . h($title) . '">',
        $desc ? '<meta property="og:description" content="' . h($desc) . '">' : '',
        '<meta property="og:url" content="' . h($url) . '">',
        '<meta property="og:image" content="' . h($image) . '">',
        '<meta name="twitter:card" content="summary">',
        '<link rel="icon" href="no-photo.jpg">',
    ]);
    if ($page !== 'recruit') {
        $sameAs = array_values(array_filter(array_map(fn ($x) => trim((string) ($x['url'] ?? '')), $site['sns'] ?? []), fn ($u) => preg_match('#^https?://#', $u)));
        $ld = array_filter([
            '@context' => 'https://schema.org',
            '@type' => 'NightClub',
            'name' => $shop['name'] ?? '',
            'alternateName' => $shop['kana'] ?? '',
            'description' => $desc,
            'url' => $url,
            'image' => $image,
            'telephone' => $shop['phone'] ?? '',
            'priceRange' => $seo['priceRange'] ?? '',
            'address' => !empty($shop['address']) ? parse_address($shop['address']) : null,
            'sameAs' => $sameAs ?: null,
        ]);
        // JSON_HEX_TAG で < > をエスケープし、</script> で閉じられないようにする
        $tags[] = '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . '</script>';
    }
    return implode("\n", $tags);
}

function inject_head(string $html, array $site, string $page): string {
    $pos = strpos($html, '<title></title>');
    return $pos === false ? $html : substr_replace($html, build_head($site, $page), $pos, strlen('<title></title>'));
}

function sitemap(array $site): string {
    $base = site_url($site);
    $today = date('Y-m-d');
    $pages = [['', '1.0', 'daily']];
    if (recruit_on($site)) $pages[] = ['recruit.html', '0.8', 'weekly'];
    $rows = array_map(fn ($p) => '  <url><loc>' . h($p[0] === '' ? $base : abs_url($base, $p[0])) . "</loc><lastmod>$today</lastmod><changefreq>{$p[2]}</changefreq><priority>{$p[1]}</priority></url>", $pages);
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" . implode("\n", $rows) . "\n</urlset>\n";
}

function robots(array $site): string {
    return "User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: " . abs_url(site_url($site), 'sitemap.xml') . "\n";
}
