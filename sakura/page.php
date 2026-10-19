<?php
// 公開ページ・管理画面の HTML、sitemap.xml、robots.txt を返す（.htaccess から呼ばれる）
declare(strict_types=1);
require __DIR__ . '/lib/common.php';
require __DIR__ . '/lib/seo.php';

$p = (string) ($_GET['p'] ?? 'index');
if (!in_array($p, ['index', 'recruit', 'admin', 'sitemap', 'robots'], true)) $p = 'index';

// http や www・初期ドメイン（○○.sakura.ne.jp）で来たら、SEO タブの「サイトのURL」へ 301 転送して1つにまとめる。
// API（保存など）は転送しない。手元確認（localhost）も対象外。
(function (array $site): void {
    $u = trim((string) ($site['seo']['siteUrl'] ?? ''));
    $want = parse_url($u);
    if ($u === '' || str_contains($u, 'github.io') || empty($want['host'])) return;
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if (preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/', $host)) return;
    $wantHttps = ($want['scheme'] ?? 'https') === 'https';
    if ($host === strtolower($want['host']) && is_https() === $wantHttps) return;
    header('Location: ' . ($wantHttps ? 'https' : 'http') . '://' . $want['host'] . ($_SERVER['REQUEST_URI'] ?? '/'), true, 301);
    exit;
})(load_site());

if ($p === 'sitemap' || $p === 'robots') {
    header('Content-Type: ' . ($p === 'sitemap' ? 'application/xml' : 'text/plain') . '; charset=utf-8');
    echo $p === 'sitemap' ? sitemap(load_site()) : robots(load_site());
    exit;
}

$html = (string) file_get_contents(__DIR__ . "/templates/$p.html");
if ($p !== 'admin') $html = inject_head($html, load_site(), $p);

// JS / CSS が更新されたら URL が変わるようにして、古いキャッシュとの食い違いを防ぐ
$html = preg_replace_callback('/(href|src)="((?:site|admin)\.(?:css|js))"/', function ($m) use ($p) {
    $file = __DIR__ . ($p === 'admin' ? '/admin/' : '/') . $m[2];
    return $m[1] . '="' . $m[2] . '?v=' . (is_file($file) ? filemtime($file) : '0') . '"';
}, $html);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Content-Type-Options: nosniff');
echo $html;
