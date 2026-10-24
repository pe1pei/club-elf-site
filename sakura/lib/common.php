<?php
// さくらのレンタルサーバ（PHP）版の共通処理。
// Node 版 server.js と同じ API を提供する。データは data/ に置き、.htaccess で外から見えないようにする。
declare(strict_types=1);

date_default_timezone_set('Asia/Tokyo'); // 日付の区切り・バックアップ名を日本時間に
// エラーは画面に出さず、サーバーのログにだけ残す（ファイルの場所などを外に漏らさない）
ini_set('display_errors', '0');
ini_set('log_errors', '1');
header_remove('X-Powered-By');

const ROOT = __DIR__ . '/..';
const DATA_DIR = ROOT . '/data';
const SITE_FILE = DATA_DIR . '/site.json';
const DEFAULT_SITE_FILE = DATA_DIR . '/site.default.json';
const CONFIG_FILE = DATA_DIR . '/config.json';
const BACKUP_DIR = DATA_DIR . '/backups';
const UPLOAD_DIR = ROOT . '/uploads';
const KEEP_BACKUPS = 30;
const SESSION_TTL = 43200; // 12時間

function json_out(int $code, array $body): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// 初回は同梱の初期データ（site.default.json）から作る。以後のアップロードで本番データは上書きされない
function load_site(): array {
    if (!is_file(SITE_FILE)) {
        if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0705, true);
        copy(DEFAULT_SITE_FILE, SITE_FILE);
    }
    $site = json_decode((string) file_get_contents(SITE_FILE), true);
    return is_array($site) ? $site : [];
}

// $site は配列でもオブジェクトでもよい。管理画面からの保存はオブジェクトのまま受け取り、
// 空の {}（キャストの SNS・出勤など）が [] に化けないようにする（化けると管理画面での入力が保存されなくなる）
function save_site(array|object $site): void {
    if (!is_dir(BACKUP_DIR)) mkdir(BACKUP_DIR, 0705, true);
    if (is_file(SITE_FILE)) copy(SITE_FILE, BACKUP_DIR . '/site-' . date('Ymd-His') . '-' . bin2hex(random_bytes(2)) . '.json');
    $tmp = SITE_FILE . '.tmp';
    file_put_contents($tmp, json_encode($site, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);
    rename($tmp, SITE_FILE);
    $old = glob(BACKUP_DIR . '/site-*.json') ?: [];
    rsort($old);
    foreach (array_slice($old, KEEP_BACKUPS) as $f) @unlink($f);
}

function read_body(int $limit): string {
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > $limit) json_out(413, ['error' => 'サイズが大きすぎます']);
    $body = (string) file_get_contents('php://input', false, null, 0, $limit + 1);
    if (strlen($body) > $limit) json_out(413, ['error' => 'サイズが大きすぎます']);
    return $body;
}

function read_json(int $limit): array {
    $data = json_decode(read_body($limit), true);
    if (!is_array($data)) json_out(400, ['error' => 'データの形式が正しくありません']);
    return $data;
}

// さくらは SSL をプロキシで終端するので、HTTPS 判定は専用ヘッダーも見る
function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || isset($_SERVER['HTTP_X_SAKURA_FORWARDED_FOR'])
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

// 他サイトからの書き込みを弾く（SameSite Cookie と二重の守り）
function same_origin(): bool {
    $o = $_SERVER['HTTP_ORIGIN'] ?? '';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    return $o === '' || $o === "http://$host" || $o === "https://$host";
}

function start_session(): void {
    session_name('elf_admin');
    session_set_cookie_params([
        'lifetime' => SESSION_TTL,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.gc_maxlifetime', (string) SESSION_TTL);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    if (PHP_VERSION_ID < 80400) { // PHP 8.4 以降は初めから十分な長さなので設定しない（8.4 で非推奨になった設定のため）
        ini_set('session.sid_length', '48');
        ini_set('session.sid_bits_per_character', '5'); // 0-9a-v（カンマ等を含まない）
    }
    $dir = DATA_DIR . '/sessions';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    session_save_path($dir);
    ini_set('session.gc_probability', '1');
    ini_set('session.gc_divisor', '100');
    session_start();
}

// ---------- アカウント（ID ＋ パスワード） ----------
// data/config.json の users に [{ id, role: admin|staff, password: PBKDF2 ハッシュ, created }] を持つ。
// 旧形式（password だけ）は ID「admin」の管理者として読み替える。
const PW_ITER = 210000;

function load_config(): array {
    $c = is_file(CONFIG_FILE) ? json_decode((string) file_get_contents(CONFIG_FILE), true) : [];
    if (!is_array($c)) $c = [];
    if (empty($c['users']) && is_array($c['password'] ?? null)) {
        $c['users'] = [['id' => 'admin', 'role' => 'admin', 'password' => $c['password'], 'created' => date('c')]];
        unset($c['password']);
    }
    if (!is_array($c['users'] ?? null)) $c['users'] = [];
    return $c;
}

function save_config(array $c): void {
    if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0700, true);
    $tmp = CONFIG_FILE . '.tmp';
    file_put_contents($tmp, json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);
    @chmod($tmp, 0600);
    rename($tmp, CONFIG_FILE);
}

function hash_pw(string $pw): array {
    $salt = random_bytes(16);
    return ['algo' => 'pbkdf2-sha256', 'iter' => PW_ITER, 'salt' => base64_encode($salt),
            'hash' => base64_encode(hash_pbkdf2('sha256', $pw, $salt, PW_ITER, 32, true))];
}

function verify_pw(?array $p, string $pw): bool {
    if (!$p || ($p['algo'] ?? '') !== 'pbkdf2-sha256') {
        hash_pbkdf2('sha256', $pw, 'dummy-salt-0000', PW_ITER, 32, true); // ID が無いときも同じだけ時間をかける
        return false;
    }
    $calc = hash_pbkdf2('sha256', $pw, base64_decode($p['salt']), (int) $p['iter'], 32, true);
    return hash_equals(base64_decode($p['hash']), $calc);
}

function user_index(array $c, string $id): int {
    foreach ($c['users'] as $i => $u) if (strcasecmp($u['id'], $id) === 0) return $i;
    return -1;
}

function valid_id(string $id): bool { return (bool) preg_match('/^[A-Za-z0-9_.@-]{3,32}$/', $id); }
function valid_pw(string $pw): bool { return mb_strlen($pw) >= 8 && mb_strlen($pw) <= 128; }
function admin_count(array $c): int { return count(array_filter($c['users'], fn ($u) => ($u['role'] ?? '') === 'admin')); }
function public_user(array $u): array { return ['id' => $u['id'], 'role' => $u['role'] ?? 'staff', 'created' => $u['created'] ?? '']; }

// ログイン中のユーザー（期限切れ・削除済みなら null）
function current_user(): ?array {
    $exp = $_SESSION['exp'] ?? 0;
    $uid = (string) ($_SESSION['uid'] ?? '');
    if (!$exp || $exp < time() || $uid === '') return null;
    $c = load_config();
    $i = user_index($c, $uid);
    if ($i < 0) return null;
    $_SESSION['exp'] = time() + SESSION_TTL;
    return $c['users'][$i];
}

function authed(): bool { return current_user() !== null; }

// ---------- ログインの試行回数制限（総当たり対策） ----------
// 同じ端末（接続元）から15分に5回、同じ ID へ15分に10回失敗したら、しばらくログインを受け付けない。
// 接続元は、さくらの SSL プロキシが付けるヘッダー → REMOTE_ADDR の順（利用者が書き換えられる X-Forwarded-For は使わない）
const LOGIN_WINDOW = 900;
const LOGIN_MAX_PER_IP = 5;
const LOGIN_MAX_PER_ID = 10;

function login_ip(): string {
    return trim(explode(',', (string) ($_SERVER['HTTP_X_SAKURA_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? ''))[0]);
}

// 失敗の記録（data/login-failures.json）。キーはハッシュなので IP や ID そのものは残らない
function login_failures(callable $fn) {
    if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0700, true);
    $fp = fopen(DATA_DIR . '/login-failures.json', 'c+');
    flock($fp, LOCK_EX);
    $d = json_decode((string) stream_get_contents($fp), true) ?: [];
    $now = time();
    foreach ($d as $k => $times) { $d[$k] = array_values(array_filter($times, fn ($t) => $t > $now - LOGIN_WINDOW)); if (!$d[$k]) unset($d[$k]); }
    $result = $fn($d, $now);
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($d));
    flock($fp, LOCK_UN); fclose($fp);
    @chmod(DATA_DIR . '/login-failures.json', 0600);
    return $result;
}
function login_keys(string $id): array {
    return ['ip:' . substr(hash('sha256', login_ip()), 0, 20), 'id:' . substr(hash('sha256', strtolower($id)), 0, 20)];
}
function login_blocked(string $id): bool {
    [$ipKey, $idKey] = login_keys($id);
    return login_failures(fn (&$d) => count($d[$ipKey] ?? []) >= LOGIN_MAX_PER_IP || count($d[$idKey] ?? []) >= LOGIN_MAX_PER_ID);
}
function login_failed(string $id): void {
    [$ipKey, $idKey] = login_keys($id);
    login_failures(function (&$d, $now) use ($ipKey, $idKey) { $d[$ipKey][] = $now; $d[$idKey][] = $now; });
}
function login_succeeded(string $id): void {
    [$ipKey, $idKey] = login_keys($id);
    login_failures(function (&$d) use ($ipKey, $idKey) { unset($d[$ipKey], $d[$idKey]); });
}

// ---------- アクセス集計（クッキーなし・IP は保存しない） ----------
// 1日1ファイル data/stats/YYYY-MM-DD.json に、表示回数・訪問者数・流入元・ページ別を数える。
// 訪問者は「日付＋秘密の値＋IP＋ブラウザ」のハッシュで1日だけ区別する（翌日には別人扱い。元の IP には戻せない）。
const STATS_DIR = DATA_DIR . '/stats';
const STATS_KEEP_DAYS = 400;
const STATS_MAX_VISITORS = 20000; // 1日に区別して数える訪問者の上限
const STATS_MAX_SOURCES = 60;     // 1日に記録する流入元の種類の上限（超えた分は「その他」）

function stats_salt(): string {
    $f = STATS_DIR . '/.salt';
    if (!is_file($f)) { if (!is_dir(STATS_DIR)) mkdir(STATS_DIR, 0700, true); file_put_contents($f, bin2hex(random_bytes(16))); }
    return (string) file_get_contents($f);
}

function client_ip(): string {
    foreach (['HTTP_X_SAKURA_FORWARDED_FOR', 'REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', (string) $_SERVER[$k])[0]);
    }
    return '';
}

// 流入元の分類。?from=instagram のような目印があればそれを優先
function classify_source(string $from, string $ref, string $selfHost): string {
    $named = ['instagram' => 'Instagram', 'ig' => 'Instagram', 'tiktok' => 'TikTok', 'x' => 'X（旧Twitter）', 'twitter' => 'X（旧Twitter）',
              'line' => 'LINE', 'youtube' => 'YouTube', 'nightstyle' => 'ナイスタ', 'naisuta' => 'ナイスタ', 'google' => 'Google検索', 'gmb' => 'Googleマップ', 'map' => 'Googleマップ',
              'facebook' => 'Facebook', 'card' => '名刺・ショップカード', 'qr' => 'QRコード', 'flyer' => 'チラシ'];
    $from = strtolower(trim($from));
    if ($from !== '') return $named[$from] ?? ('目印: ' . mb_substr(preg_replace('/[^\w.-]/u', '', $from), 0, 24));
    $host = strtolower((string) parse_url($ref, PHP_URL_HOST));
    if ($host === '') return '直接・アプリ内（不明）';
    $host = preg_replace('/^(www|m|l|lm)\./', '', $host);
    if ($host === preg_replace('/^www\./', '', strtolower($selfHost))) return '';  // サイト内の移動は数えない
    $map = [
        '/(^|\.)google\.[a-z.]+$/' => 'Google検索', '/(^|\.)yahoo\.co\.jp$|(^|\.)yahoo\.com$/' => 'Yahoo!検索', '/(^|\.)bing\.com$/' => 'Bing検索',
        '/(^|\.)instagram\.com$/' => 'Instagram', '/(^|\.)(facebook\.com|fb\.com)$/' => 'Facebook', '/^(t\.co|x\.com|twitter\.com)$/' => 'X（旧Twitter）',
        '/(^|\.)tiktok\.com$/' => 'TikTok', '/(^|\.)line\.me$|(^|\.)line-apps\.com$/' => 'LINE', '/(^|\.)youtube\.com$|^youtu\.be$/' => 'YouTube',
        '/(^|\.)nightstyle\.jp$/' => 'ナイスタ', '/(^|\.)maps\.app\.goo\.gl$|^goo\.gl$/' => 'Googleマップ',
    ];
    foreach ($map as $re => $label) if (preg_match($re, $host)) return $label;
    return $host;
}

function record_hit(string $page, string $ref, string $from): void {
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    if ($ua === '' || preg_match('/bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|curl|wget|python/i', $ua)) return;
    $source = classify_source($from, $ref, (string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($source === '') return;
    $page = in_array($page, ['index', 'recruit'], true) ? $page : 'other';
    if (!is_dir(STATS_DIR)) mkdir(STATS_DIR, 0700, true);
    $day = date('Y-m-d');
    $visitor = substr(hash('sha256', $day . stats_salt() . client_ip() . $ua), 0, 16);
    $f = STATS_DIR . "/$day.json";
    $fp = fopen($f, 'c+');
    if (!$fp) return;
    flock($fp, LOCK_EX);
    $d = json_decode((string) stream_get_contents($fp), true) ?: ['views' => 0, 'v' => [], 'sources' => [], 'pages' => []];
    $d['views']++;
    $new = !in_array($visitor, $d['v'], true);
    if ($new && count($d['v']) >= STATS_MAX_VISITORS) { flock($fp, LOCK_UN); fclose($fp); return; } // 上限を超えた日はそれ以上数えない
    if ($new) $d['v'][] = $visitor;
    if (!isset($d['sources'][$source]) && count($d['sources']) >= STATS_MAX_SOURCES) $source = 'その他';
    if ($new) $d['sources'][$source] = ($d['sources'][$source] ?? 0) + 1; // 流入元は訪問者ごとに1回だけ数える
    $d['pages'][$page] = ($d['pages'][$page] ?? 0) + 1;
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    flock($fp, LOCK_UN); fclose($fp);
    if (random_int(1, 200) === 1) { // たまに古い日を掃除
        $limit = date('Y-m-d', strtotime('-' . STATS_KEEP_DAYS . ' days'));
        foreach (glob(STATS_DIR . '/*.json') ?: [] as $old) if (basename($old, '.json') < $limit) @unlink($old);
    }
}

function stats_summary(int $days): array {
    $days = max(1, min(STATS_KEEP_DAYS, $days));
    $out = ['days' => [], 'sources' => [], 'pages' => [], 'views' => 0, 'visitors' => 0];
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = date('Y-m-d', strtotime("-$i days"));
        $f = STATS_DIR . "/$day.json";
        $d = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
        $views = (int) ($d['views'] ?? 0); $visitors = count($d['v'] ?? []);
        $out['days'][] = ['date' => $day, 'views' => $views, 'visitors' => $visitors];
        $out['views'] += $views; $out['visitors'] += $visitors;
        foreach ($d['sources'] ?? [] as $k => $n) $out['sources'][$k] = ($out['sources'][$k] ?? 0) + $n;
        foreach ($d['pages'] ?? [] as $k => $n) $out['pages'][$k] = ($out['pages'][$k] ?? 0) + $n;
    }
    arsort($out['sources']); arsort($out['pages']);
    return $out;
}

// ---------- あいことばクーポン ----------
// 毎日 3:01 に切り替わる。その日初めて表示されたときに、合言葉と特典をそれぞれランダムに選んで data/coupon.json に記録する
// （その日は誰が見ても同じ。翌日の分は 3:01 になるまで決まらないので先読みできない）。前日と同じものは選ばない。
const COUPON_FILE = DATA_DIR . '/coupon.json';
const COUPON_KEEP_DAYS = 90;

// 3:01 区切りの「営業日」。3:00 までは前日扱い
function coupon_day(?int $t = null): string { return date('Y-m-d', ($t ?? time()) - (3 * 3600 + 60)); }

function coupon_term(string $day): array {
    $from = strtotime("$day 03:01");
    $to = $from + 86400 - 60;
    return ['day' => $day, 'from' => date('n/j G:i', $from), 'to' => date('n/j G:i', $to)];
}

function coupon_active(array $list): array {
    return array_values(array_filter($list, fn ($x) => is_array($x) && ($x['on'] ?? true) !== false && trim((string) ($x['text'] ?? '')) !== '' && ($x['id'] ?? '') !== ''));
}

function coupon_pick(array $active, ?string $avoidId): array {
    $pool = count($active) > 1 ? array_values(array_filter($active, fn ($x) => $x['id'] !== $avoidId)) : $active;
    return $pool[random_int(0, count($pool) - 1)];
}

// 今日のクーポン（表示しない設定・登録なしなら null）
function coupon_today(array $site): ?array {
    $cp = $site['coupon'] ?? [];
    if (empty($cp['enabled'])) return null;
    $words = coupon_active($cp['words'] ?? []);
    $perks = coupon_active($cp['perks'] ?? []);
    if (!$words || !$perks) return null;
    if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0700, true);
    $day = coupon_day();
    $fp = fopen(COUPON_FILE, 'c+');
    flock($fp, LOCK_EX);
    $state = json_decode((string) stream_get_contents($fp), true) ?: [];
    $state['days'] ??= [];
    $today = $state['days'][$day] ?? null;
    $find = fn ($list, $id) => current(array_filter($list, fn ($x) => $x['id'] === $id)) ?: null;
    // 今日の分が決まっていて、選ばれた合言葉・特典がまだ有効ならそのまま。OFF や削除されていたら選び直す
    $w = $today ? $find($words, $today['wordId']) : null;
    $p = $today ? $find($perks, $today['perkId']) : null;
    if (!$w || !$p) {
        $prev = $state['days'][coupon_day(strtotime("$day 12:00") - 86400)] ?? null;
        $w = $w ?: coupon_pick($words, $prev['wordId'] ?? null);
        $p = $p ?: coupon_pick($perks, $prev['perkId'] ?? null);
    }
    $state['days'][$day] = ['wordId' => $w['id'], 'perkId' => $p['id'], 'word' => trim($w['text']), 'perk' => trim($p['text'])];
    krsort($state['days']);
    $state['days'] = array_slice($state['days'], 0, COUPON_KEEP_DAYS, true);
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    flock($fp, LOCK_UN); fclose($fp);
    @chmod(COUPON_FILE, 0600);
    return ['word' => trim($w['text']), 'perk' => trim($p['text'])] + coupon_term($day);
}

function coupon_history(int $days = 14): array {
    $state = is_file(COUPON_FILE) ? (json_decode((string) file_get_contents(COUPON_FILE), true) ?: []) : [];
    $out = [];
    foreach (array_slice($state['days'] ?? [], 0, $days, true) as $day => $d) $out[] = ['word' => $d['word'], 'perk' => $d['perk']] + coupon_term($day);
    return $out;
}

// 公開用のサイトデータ：合言葉・特典の一覧は渡さず、今日の分だけ付ける
function public_site(array $site): array {
    $today = coupon_today($site);
    if (isset($site['coupon'])) $site['coupon'] = ['title' => $site['coupon']['title'] ?? '', 'note' => $site['coupon']['note'] ?? ''];
    $site['couponToday'] = $today;
    return $site;
}
