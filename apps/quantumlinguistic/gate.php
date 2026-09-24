<?php
// Passwortschranke fuer /apps/quantumlinguistic/ (Ordnerebene).
//
// Die .htaccess leitet JEDE Anfrage unterhalb dieses Ordners hierher. Ohne gueltige
// Sitzung wird nur das Anmeldeformular ausgeliefert.
//
// Verschluesselung im Ruhezustand: Die Anwendungsdateien liegen nur als AES-256-GCM-
// Chiffretext in enc/ (auch im oeffentlichen Git-Repository). Ein zufaelliger
// Dateischluessel K ist in keyring.json mit einem aus dem Passwort abgeleiteten Schluessel
// (PBKDF2-HMAC-SHA256) verpackt. Beim Login wird K entpackt (das ist zugleich die
// Passwortpruefung) und nur in der serverseitigen Sitzung gehalten; jede Datei wird
// pro Anfrage im Speicher entschluesselt. Das Passwort steht nirgends.

declare(strict_types=1);

const BASE      = '/apps/quantumlinguistic/';
const ENC_DIR   = __DIR__ . '/enc';
const KEYRING   = __DIR__ . '/keyring.json';
const SESSION_S = 12 * 3600;   // Anmeldung gilt 12 Stunden
const MAX_FAILS = 8;           // Fehlversuche je IP ...
const WINDOW_S  = 900;         // ... innerhalb von 15 Minuten

// ---------------------------------------------------------------- Header
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('Cache-Control: private, no-cache');

// ---------------------------------------------------------------- Sitzung
session_name('qlgate');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => BASE,
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

function authed(): bool
{
    return isset($_SESSION['ok'], $_SESSION['k']) && is_int($_SESSION['ok']) && (time() - $_SESSION['ok']) < SESSION_S;
}

/** Entpackt den Dateischluessel K mit dem Passwort; null bei falschem Passwort. */
function unwrap_key(string $pw): ?string
{
    $kr = json_decode((string) @file_get_contents(KEYRING), true);
    if (!is_array($kr) || ($kr['v'] ?? 0) !== 1) {
        return null;
    }
    $salt = base64_decode($kr['salt'], true);
    $nonce = base64_decode($kr['nonce'], true);
    $wrapped = base64_decode($kr['wrapped'], true);
    $iter = (int) ($kr['iter'] ?? 0);
    if ($salt === false || $nonce === false || $wrapped === false || $iter < 100000 || strlen($wrapped) < 17) {
        return null;
    }
    $kek = hash_pbkdf2('sha256', $pw, $salt, $iter, 32, true);
    $k = openssl_decrypt(substr($wrapped, 0, -16), 'aes-256-gcm', $kek, OPENSSL_RAW_DATA, $nonce, substr($wrapped, -16), 'ql-keywrap-v1');
    return ($k === false || strlen($k) !== 32) ? null : $k;
}

// ---------------------------------------------------------------- Drosselung
function fail_file(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'x';
    return sys_get_temp_dir() . '/ql_gate_' . hash('sha256', $ip . '|ql-throttle');
}
function recent_fails(): int
{
    $f = fail_file();
    if (!is_file($f)) {
        return 0;
    }
    $times = array_filter(array_map('intval', file($f, FILE_IGNORE_NEW_LINES) ?: []), fn ($t) => $t > time() - WINDOW_S);
    return count($times);
}
function record_fail(): void
{
    $f = fail_file();
    $times = is_file($f) ? array_filter(array_map('intval', file($f, FILE_IGNORE_NEW_LINES) ?: []), fn ($t) => $t > time() - WINDOW_S) : [];
    $times[] = time();
    @file_put_contents($f, implode("\n", $times), LOCK_EX);
}

// ---------------------------------------------------------------- Abmelden
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($method === 'POST' && ($_POST['action'] ?? '') === 'logout') {
    $_SESSION = [];
    session_destroy();
    header('Location: ' . BASE, true, 303);
    exit;
}

// ---------------------------------------------------------------- Anmeldung
$error = '';
if ($method === 'POST' && ($_POST['action'] ?? '') === 'login') {
    if (recent_fails() >= MAX_FAILS) {
        http_response_code(429);
        $error = 'Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.';
    } elseif (is_string($_POST['pw'] ?? null) && ($fileKey = unwrap_key($_POST['pw'])) !== null) {
        session_regenerate_id(true);
        $_SESSION['ok'] = time();
        $_SESSION['k'] = base64_encode($fileKey);
        header('Location: ' . BASE, true, 303);
        exit;
    } else {
        record_fail();
        usleep(900000);
        http_response_code(401);
        $error = 'Passwort nicht korrekt.';
    }
}

// ---------------------------------------------------------------- Formular
function login_page(string $error): never
{
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    $msg = $error !== '' ? '<p class="err" role="alert">' . htmlspecialchars($error, ENT_QUOTES) . '</p>' : '';
    echo <<<HTML
<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Anmeldung</title>
<style>
:root{--navy:#0e2244;--gold:#E8B73A;--paper:#f6f1e4;--ink:#14213d;--muted:#6b624f}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--navy);color:var(--paper);font:16px/1.5 "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif}
main{width:min(92vw,380px);background:var(--paper);color:var(--ink);padding:28px 26px;border-radius:14px;box-shadow:0 24px 60px -20px rgba(0,0,0,.6)}
.k{font:12px/1 ui-monospace,Consolas,monospace;letter-spacing:.24em;text-transform:uppercase;color:#a67c00;margin:0 0 10px}
h1{font:600 1.5rem/1.15 "Iowan Old Style",Palatino,Georgia,serif;margin:0 0 6px}
p{margin:0 0 16px;color:var(--muted);font-size:.93rem}
label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:4px}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid #cabd9f;border-radius:8px;background:#fff}
button{margin-top:14px;width:100%;font:inherit;font-weight:600;padding:10px;border:0;border-radius:8px;background:var(--navy);color:var(--paper);cursor:pointer}
button:hover{background:#1E3C6E} :focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.err{color:#7c3b32;font-weight:600;margin:12px 0 0}
</style></head><body><main>
<p class="k">Nicht öffentlich</p>
<h1>Quantenlinguistik</h1>
<p>Dieser Bereich ist passwortgeschützt.</p>
<form method="post" action="/apps/quantumlinguistic/" autocomplete="off">
<input type="hidden" name="action" value="login">
<label for="pw">Passwort</label>
<input id="pw" name="pw" type="password" required autofocus autocomplete="current-password">
<button type="submit">Anmelden</button>
$msg
</form></main></body></html>
HTML;
    exit;
}

if (!authed()) {
    // Nur die Startadresse zeigt das Formular; alles andere ohne Anmeldung: 401, kein Inhalt.
    if ($uri === BASE || $uri === rtrim(BASE, '/') || basename($uri) === 'gate.php' || $method === 'POST') {
        login_page($error);
    }
    http_response_code(401);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Anmeldung erforderlich.\n";
    exit;
}

// ---------------------------------------------------------------- Auslieferung
if (basename($uri) === 'gate.php') {
    header('Location: ' . BASE, true, 302);
    exit;
}
if (strncmp($uri, BASE, strlen(BASE)) !== 0) {
    http_response_code(404);
    exit;
}
$rel = rawurldecode(substr($uri, strlen(BASE)));
if ($rel === '' || substr($rel, -1) === '/') {
    $rel .= 'index.html';
}
// Pfad haerten: keine Nullbytes, keine Rueckwaerts-Segmente, keine versteckten Dateien.
if (strpos($rel, "\0") !== false || preg_match('#(^|/)\.\.?(/|$)#', $rel) || preg_match('#(^|/)\.#', $rel) || strpos($rel, '\\') !== false) {
    http_response_code(400);
    exit;
}
$blob = ENC_DIR . '/' . hash('sha256', 'ql1|' . $rel) . '.bin';
if (!is_file($blob)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Nicht gefunden.\n";
    exit;
}

$types = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'json' => 'application/json; charset=utf-8',
    'zip' => 'application/zip', 'png' => 'image/png', 'svg' => 'image/svg+xml',
    'txt' => 'text/plain; charset=utf-8', 'wasm' => 'application/wasm',
];
$ext  = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
$type = $types[$ext] ?? null;
if ($type === null) {
    http_response_code(404);   // unbekannte Dateitypen werden nicht ausgeliefert
    exit;
}
$etag = '"' . md5_file($blob) . '"';
header('ETag: ' . $etag);
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
$raw = (string) file_get_contents($blob);
$key = base64_decode((string) ($_SESSION['k'] ?? ''), true);
$plain = ($key !== false && strlen($raw) > 28)
    ? openssl_decrypt(substr($raw, 12, -16), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, -16), 'ql1|' . $rel)
    : false;
if ($plain === false) {
    // Schluessel veraltet (neue Version eingespielt) oder Datei beschaedigt: neu anmelden
    $_SESSION = [];
    session_destroy();
    http_response_code(401);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Sitzung abgelaufen. Bitte neu anmelden.\n";
    exit;
}
header('Content-Type: ' . $type);
header('Content-Length: ' . strlen($plain));
// Skripte und Worker laden Pyodide vom CDN; alles andere nur von der eigenen Herkunft.
if ($ext === 'html' || $ext === 'js') {
    header("Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; "
         . "connect-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
         . "worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
echo $plain;
