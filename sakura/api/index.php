<?php
// 管理画面用 API（Node 版 server.js の /api/* と同じ）。.htaccess で /api/xxx → api/index.php?r=xxx に回す
declare(strict_types=1);
require __DIR__ . '/../lib/common.php';

$route = ($_SERVER['REQUEST_METHOD'] ?? 'GET') . ' ' . trim((string) ($_GET['r'] ?? ''), '/');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' && !same_origin()) json_out(403, ['error' => '不正なリクエストです']);

if ($route === 'GET site') json_out(200, load_site());

start_session();

if ($route === 'POST login') {
    if (!password_config()) json_out(503, ['error' => '管理パスワードがまだ設定されていません']);
    $pw = (string) (read_json(10_000)['password'] ?? '');
    if (!password_ok($pw)) {
        sleep(1); // 総当たり対策
        json_out(401, ['error' => 'パスワードが違います']);
    }
    session_regenerate_id(true);
    $_SESSION['exp'] = time() + SESSION_TTL;
    json_out(200, ['ok' => true]);
}
if ($route === 'POST logout') {
    $_SESSION = [];
    session_destroy();
    json_out(200, ['ok' => true]);
}

if (!authed()) json_out(401, ['error' => 'ログインが必要です']);

if ($route === 'GET me') json_out(200, ['ok' => true, 'defaultPassword' => false]);

if ($route === 'PUT site') {
    $site = read_json(2_000_000);
    if (!is_array($site['shop'] ?? null) || !is_array($site['casts'] ?? null)) json_out(400, ['error' => 'データの形式が正しくありません']);
    save_site($site);
    json_out(200, ['ok' => true]);
}

if ($route === 'POST upload') {
    $data = read_json(14_000_000);
    if (!preg_match('#^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$#', (string) ($data['dataUrl'] ?? ''), $m)) {
        json_out(400, ['error' => '画像ファイルを選んでください']);
    }
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > 10_000_000) json_out(413, ['error' => '画像が大きすぎます（10MBまで）']);
    if (@getimagesizefromstring($bin) === false) json_out(400, ['error' => '画像として読み込めませんでした']);
    if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0705, true);
    $name = base_convert((string) time(), 10, 36) . '-' . bin2hex(random_bytes(6)) . '.' . ($m[1] === 'jpeg' ? 'jpg' : $m[1]);
    file_put_contents(UPLOAD_DIR . '/' . $name, $bin);
    json_out(200, ['url' => 'uploads/' . $name]);
}

json_out(404, ['error' => 'Not found']);
