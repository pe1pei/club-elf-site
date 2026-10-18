<?php
// 手元での動作確認用（php -S のルーター）。本番では .htaccess が同じ振り分けをする。アップロード不要。
// 使い方: php -S localhost:3400 -t dist-sakura tools/php-router.php
$uri = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$root = $_SERVER['DOCUMENT_ROOT'];
$pages = ['/' => 'index', '/index.html' => 'index', '/recruit' => 'recruit', '/recruit.html' => 'recruit',
  '/sitemap.xml' => 'sitemap', '/robots.txt' => 'robots', '/admin/' => 'admin', '/admin/index.html' => 'admin'];
if ($uri === '/admin') { header('Location: /admin/', true, 301); return true; }
if (isset($pages[$uri])) { $_GET['p'] = $pages[$uri]; $_SERVER['SCRIPT_NAME'] = '/page.php'; require $root . '/page.php'; return true; }
if (preg_match('#^/api/(.*)$#', $uri, $m)) { $_GET['r'] = $m[1]; $_SERVER['SCRIPT_NAME'] = '/api/index.php'; require $root . '/api/index.php'; return true; }
// .htaccess で拒否しているフォルダ
if (preg_match('#^/(data|lib|templates)(/|$)#', $uri) || preg_match('#^/uploads/(?!.*\.(jpe?g|png|webp|gif)$)#i', $uri)) {
  http_response_code(403); echo 'Forbidden'; return true;
}
return false;
