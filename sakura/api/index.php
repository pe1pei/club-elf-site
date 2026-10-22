<?php
// 管理画面用 API（Node 版 server.js の /api/* と同じ）。.htaccess で /api/xxx → api/index.php?r=xxx に回す
declare(strict_types=1);
require __DIR__ . '/../lib/common.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$route = $method . ' ' . trim((string) ($_GET['r'] ?? ''), '/');
if ($method !== 'GET' && !same_origin()) json_out(403, ['error' => '不正なリクエストです']);

if ($route === 'GET site') json_out(200, load_site());

// 公開ページの表示を1回数える（ログイン中のスタッフの閲覧は数えない）。応答は空
if ($route === 'POST hit') {
    $b = json_decode(read_body(4_000), true) ?: [];
    if (!empty($_COOKIE['elf_admin'])) { start_session(); if (current_user()) { http_response_code(204); exit; } }
    record_hit((string) ($b['page'] ?? ''), (string) ($b['ref'] ?? ''), (string) ($b['from'] ?? ''));
    http_response_code(204);
    exit;
}

start_session();

if ($route === 'POST login') {
    $c = load_config();
    if (!$c['users']) json_out(503, ['error' => '管理アカウントがまだ設定されていません']);
    $body = read_json(10_000);
    $id = mb_substr(trim((string) ($body['id'] ?? '')), 0, 64);
    $pw = mb_substr((string) ($body['password'] ?? ''), 0, 256);
    if (login_blocked($id)) json_out(429, ['error' => 'ログインの失敗が続いたため、15分ほど待ってからお試しください']);
    $i = user_index($c, $id);
    if (!verify_pw($i >= 0 ? $c['users'][$i]['password'] : null, $pw)) {
        login_failed($id);
        sleep(1); // 総当たり対策
        json_out(401, ['error' => 'ID またはパスワードが違います']);
    }
    login_succeeded($id);
    session_regenerate_id(true);
    $_SESSION['uid'] = $c['users'][$i]['id'];
    $_SESSION['exp'] = time() + SESSION_TTL;
    json_out(200, ['ok' => true, 'user' => public_user($c['users'][$i])]);
}
if ($route === 'POST logout') {
    $_SESSION = [];
    session_destroy();
    json_out(200, ['ok' => true]);
}

$me = current_user();
if (!$me) json_out(401, ['error' => 'ログインが必要です']);
$isAdmin = ($me['role'] ?? '') === 'admin';

if ($route === 'GET stats') json_out(200, stats_summary((int) ($_GET['days'] ?? 30)));

if ($route === 'GET me') json_out(200, ['ok' => true, 'defaultPassword' => false, 'user' => public_user($me)]);

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

// ---------- 自分のアカウント：ID・パスワードの変更（今のパスワードが必要） ----------
if ($route === 'POST account') {
    $b = read_json(10_000);
    $c = load_config();
    $i = user_index($c, $me['id']);
    if (!verify_pw($c['users'][$i]['password'], (string) ($b['currentPassword'] ?? ''))) {
        sleep(1);
        json_out(400, ['error' => '今のパスワードが違います']);
    }
    $newId = trim((string) ($b['newId'] ?? ''));
    $newPw = (string) ($b['newPassword'] ?? '');
    if ($newId === '' && $newPw === '') json_out(400, ['error' => '変更する内容を入力してください']);
    if ($newId !== '') {
        if (!valid_id($newId)) json_out(400, ['error' => 'ID は半角英数字と _ . @ - で3〜32文字にしてください']);
        $j = user_index($c, $newId);
        if ($j >= 0 && $j !== $i) json_out(400, ['error' => 'その ID はすでに使われています']);
        $c['users'][$i]['id'] = $newId;
        $_SESSION['uid'] = $newId;
    }
    if ($newPw !== '') {
        if (!valid_pw($newPw)) json_out(400, ['error' => 'パスワードは8文字以上にしてください']);
        $c['users'][$i]['password'] = hash_pw($newPw);
    }
    save_config($c);
    json_out(200, ['ok' => true, 'user' => public_user($c['users'][$i])]);
}

// ---------- ユーザー管理（管理者だけ） ----------
if (str_starts_with($route, 'GET users') || str_starts_with($route, 'POST users')) {
    if (!$isAdmin) json_out(403, ['error' => 'この操作は管理者だけができます']);
    $c = load_config();

    if ($route === 'GET users') json_out(200, ['users' => array_map('public_user', $c['users'])]);

    $b = read_json(10_000);
    $id = trim((string) ($b['id'] ?? ''));
    $role = in_array($b['role'] ?? '', ['admin', 'staff'], true) ? $b['role'] : null;

    if ($route === 'POST users') {
        if (!valid_id($id)) json_out(400, ['error' => 'ID は半角英数字と _ . @ - で3〜32文字にしてください']);
        if (user_index($c, $id) >= 0) json_out(400, ['error' => 'その ID はすでに使われています']);
        $pw = (string) ($b['password'] ?? '');
        if (!valid_pw($pw)) json_out(400, ['error' => 'パスワードは8文字以上にしてください']);
        $c['users'][] = ['id' => $id, 'role' => $role ?? 'staff', 'password' => hash_pw($pw), 'created' => date('c')];
        save_config($c);
        json_out(200, ['ok' => true, 'users' => array_map('public_user', $c['users'])]);
    }

    $i = user_index($c, $id);
    if ($i < 0) json_out(404, ['error' => 'そのユーザーは見つかりません']);

    if ($route === 'POST users/update') {
        if ($role && $role !== 'admin' && ($c['users'][$i]['role'] ?? '') === 'admin' && admin_count($c) <= 1) {
            json_out(400, ['error' => '管理者が1人もいなくなるため変更できません']);
        }
        if ($role) $c['users'][$i]['role'] = $role;
        $pw = (string) ($b['password'] ?? '');
        if ($pw !== '') {
            if (!valid_pw($pw)) json_out(400, ['error' => 'パスワードは8文字以上にしてください']);
            $c['users'][$i]['password'] = hash_pw($pw);
        }
        save_config($c);
        json_out(200, ['ok' => true, 'users' => array_map('public_user', $c['users'])]);
    }

    if ($route === 'POST users/delete') {
        if (strcasecmp($c['users'][$i]['id'], $me['id']) === 0) json_out(400, ['error' => '自分自身は削除できません']);
        if (($c['users'][$i]['role'] ?? '') === 'admin' && admin_count($c) <= 1) json_out(400, ['error' => '最後の管理者は削除できません']);
        array_splice($c['users'], $i, 1);
        save_config($c);
        json_out(200, ['ok' => true, 'users' => array_map('public_user', $c['users'])]);
    }
}

json_out(404, ['error' => 'Not found']);
