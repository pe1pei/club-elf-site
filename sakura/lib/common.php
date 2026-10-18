<?php
// さくらのレンタルサーバ（PHP）版の共通処理。
// Node 版 server.js と同じ API を提供する。データは data/ に置き、.htaccess で外から見えないようにする。
declare(strict_types=1);

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

function save_site(array $site): void {
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
    session_start();
}

function authed(): bool {
    $exp = $_SESSION['exp'] ?? 0;
    if (!$exp || $exp < time()) return false;
    $_SESSION['exp'] = time() + SESSION_TTL;
    return true;
}

// パスワードは tools/set-password.js が作る PBKDF2 ハッシュ（data/config.json）で照合する
function password_config(): ?array {
    if (!is_file(CONFIG_FILE)) return null;
    $c = json_decode((string) file_get_contents(CONFIG_FILE), true);
    return is_array($c['password'] ?? null) ? $c['password'] : null;
}

function password_ok(string $input): bool {
    $p = password_config();
    if (!$p || ($p['algo'] ?? '') !== 'pbkdf2-sha256') return false;
    $calc = hash_pbkdf2('sha256', $input, base64_decode($p['salt']), (int) $p['iter'], 32, true);
    return hash_equals(base64_decode($p['hash']), $calc);
}
