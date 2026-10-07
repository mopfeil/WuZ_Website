<?php
// Kerntransformation – KI-Begleiter.
// Leitet eine einzelne Antwort der Person mit dem Prozessstand an die Claude-API weiter und
// liefert eine strukturierte Einschätzung zurück. Der API-Schlüssel bleibt auf dem Server.
//
// Protokoll (POST, JSON):
//   {code, mode:"antwort"|"frage", step, title, ask, answer, frame:{...}, local:[codes]}
//   -> 200 {verdict, nachricht, antwort}
//   -> 401 falscher Zugangscode, 429 Tageslimit, 502/503 API nicht erreichbar
//
// Konfiguration in kerntransformation-config.php NEBEN public_html (siehe config.example.php).
// Dort bleibt sie bei Git-Deploys erhalten und ist vom Web aus nicht erreichbar.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const MAX_BODY   = 20000;
const MAX_ANSWER = 2000;
const DATA_DIR   = __DIR__ . '/data';

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['error' => 'POST erwartet']);
}
// Gesucht wird zuerst außerhalb des Web-Verzeichnisses (übersteht Deploys), dann neben coach.php.
$configFile = null;
foreach ([dirname((string)($_SERVER['DOCUMENT_ROOT'] ?? __DIR__)) . '/kerntransformation-config.php',
          __DIR__ . '/config.php'] as $candidate) {
    if (is_file($candidate)) {
        $configFile = $candidate;
        break;
    }
}
if ($configFile === null) {
    respond(503, ['error' => 'KI-Begleiter ist auf diesem Server nicht eingerichtet']);
}
require $configFile;

// Konfiguration prüfen, damit Tippfehler in der Konfiguration eine verständliche Meldung statt eines
// 500-Fehlers ergeben. Werte (Schlüssel, Hash) werden dabei nie ausgegeben.
$configErrors = [];
foreach (['ANTHROPIC_API_KEY', 'ACCESS_CODE_HASH', 'DAILY_LIMIT'] as $name) {
    if (!defined($name)) {
        $configErrors[] = "$name fehlt";
    }
}
if (defined('ANTHROPIC_API_KEY') && !preg_match('/^sk-ant-[A-Za-z0-9_-]{20,}$/', (string)ANTHROPIC_API_KEY)) {
    $configErrors[] = 'ANTHROPIC_API_KEY sieht nicht wie ein API-Schlüssel aus (sk-ant-…, ohne Leerzeichen)';
}
if (defined('ACCESS_CODE_HASH') && !preg_match('/^\$2y\$\d\d\$[.\/A-Za-z0-9]{53}$/', (string)ACCESS_CODE_HASH)) {
    $configErrors[] = 'ACCESS_CODE_HASH ist kein gültiger Hash (60 Zeichen, beginnt mit $2y$, in einfachen Anführungszeichen)';
}
if (defined('DAILY_LIMIT') && (!is_int(DAILY_LIMIT) || DAILY_LIMIT < 1)) {
    $configErrors[] = 'DAILY_LIMIT muss eine ganze Zahl ohne Anführungszeichen sein';
}
if ($configErrors) {
    respond(503, ['error' => 'config.php fehlerhaft: ' . implode('; ', $configErrors)]);
}

$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || strlen($raw) > MAX_BODY) {
    respond(413, ['error' => 'Anfrage zu groß']);
}
$req = json_decode($raw, true);
if (!is_array($req)) {
    respond(400, ['error' => 'Ungültiges JSON']);
}

// --- Zugang ---------------------------------------------------------------
$code = (string)($req['code'] ?? '');
if ($code === '' || !password_verify($code, ACCESS_CODE_HASH)) {
    usleep(800000); // bremst Rateversuche
    respond(401, ['error' => 'Zugangscode falsch']);
}
if (($req['mode'] ?? '') === 'ping') {
    respond(200, ['ok' => true]);
}

// --- Tageslimit (gesamt, schützt vor Kostenexplosion) --------------------
if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0755, true);
}
if (is_dir(DATA_DIR) && !file_exists(DATA_DIR . '/.htaccess')) {
    @file_put_contents(DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
}
$usageFile = DATA_DIR . '/usage-' . gmdate('Y-m-d') . '.txt';
$fp = fopen($usageFile, 'c+');
if ($fp) {
    flock($fp, LOCK_EX);
    $count = (int)stream_get_contents($fp);
    if ($count >= DAILY_LIMIT) {
        flock($fp, LOCK_UN);
        fclose($fp);
        respond(429, ['error' => 'Tageslimit erreicht']);
    }
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, (string)($count + 1));
    flock($fp, LOCK_UN);
    fclose($fp);
}

// --- Prompt ---------------------------------------------------------------
function clip($v, int $n = 400): string
{
    $s = is_string($v) ? $v : '';
    return mb_substr(trim($s), 0, $n);
}

$guide = (string)@file_get_contents(__DIR__ . '/guide.md');
$guide = preg_replace('/^---.*?---\s*/s', '', $guide); // Frontmatter der Skill-Datei entfernen

$contract = <<<TXT

## Einsatz in der Web-App

Du arbeitest hier nicht im Gespräch, sondern als Begleiter innerhalb einer Web-App. Die App führt
die Schritte selbst; du bekommst den aktuellen Schritt, den bisherigen Stand und die Antwort der
Person (meist per Spracherkennung diktiert – rechne mit Erkennungsfehlern, Füllwörtern und
fehlender Zeichensetzung). Antworte ausschließlich im vorgegebenen JSON-Format:

- verdict:
  - "weiter": Die Antwort passt zum Schritt. Die App geht weiter.
  - "nachfragen": Ein Stolperstein liegt vor (siehe Tabelle). Die App bleibt beim Schritt.
  - "kern_pruefen": Nur im Schritt Ergebniskette – die Antwort könnte ein Kernzustand sein.
  - "erden": Starke Gefühle, Überwältigung. Die App zeigt deine Nachricht als Erdungs-Hinweis.
  - "krise": Hinweise auf akute Gefährdung. Die App hält an und zeigt Hilfsangebote.
- nachricht: Was die App der Person zeigt und vorliest. Deutsch, du-Form, höchstens drei kurze
  Sätze. Bei "weiter" meist leer oder ein kurzer Dank an den Teil. Keine Deutungen.
- antwort: Die Antwort in den eigenen Worten der Person, nur bereinigt um Diktat-Fehler,
  Füllwörter und Rahmungen wie „der Teil sagt, er will …“ (aus „der Teil sagt er will äh Sicherheit“
  wird „Sicherheit“). Nichts hinzufügen, nichts umdeuten. Bei Bestätigungsschritten leer.

Bei mode "frage" stellt die Person dir eine Frage zum Prozess (z. B. weil etwas Unerwartetes
passiert). Beantworte sie in "nachricht" knapp und praktisch nach dem Modell oben; verdict ist
dann "nachfragen" (oder "erden"/"krise", falls angebracht), antwort bleibt leer.

Lokale Hinweise der App (z. B. "negative", "dontKnow") sind Heuristiken – du entscheidest selbst.
Sei großzügig mit "weiter": Ungewöhnliche, bildhafte oder unlogische Antworten des Teils sind
erwünscht. Frag nur nach, wenn ein Stolperstein wirklich vorliegt.
TXT;

$f = is_array($req['frame'] ?? null) ? $req['frame'] : [];
$chain = array_map(fn($e) => clip($e, 200), array_slice(is_array($f['ergebnisse'] ?? null) ? $f['ergebnisse'] : [], 0, 30));
$local = array_map(fn($e) => clip($e, 30), array_slice(is_array($req['local'] ?? null) ? $req['local'] : [], 0, 10));
$mode = ($req['mode'] ?? '') === 'frage' ? 'frage' : 'antwort';

$state = "Modus: $mode\n"
    . 'Schritt: ' . clip($req['title'] ?? '', 80) . ' (' . clip($req['step'] ?? '', 40) . ")\n"
    . 'Frage der App an die Person: ' . clip($req['ask'] ?? '', 600) . "\n"
    . 'Art des Teils: ' . (clip($f['kind'] ?? '', 20) === 'objection' ? 'Einwand-Teil' : 'Ausgangsteil') . "\n"
    . 'Teil: ' . clip($f['teil'] ?? '') . (clip($f['art'] ?? '', 40) ? ' (' . clip($f['art'], 40) . ')' : '') . "\n"
    . 'Situation: ' . clip($f['kontext'] ?? '') . "\n"
    . 'Im Körper: ' . clip($f['koerper'] ?? '') . "\n"
    . 'Ergebniskette bisher: ' . ($chain ? implode(' → ', $chain) : '–') . "\n"
    . 'Kernzustand: ' . (clip($f['kern'] ?? '') ?: '–') . "\n"
    . 'Lokale Hinweise der App: ' . ($local ? implode(', ', $local) : '–') . "\n\n"
    . ($mode === 'frage' ? 'Frage der Person' : 'Antwort der Person') . ":\n"
    . clip($req['answer'] ?? '', MAX_ANSWER);

$schema = [
    'type' => 'object',
    'properties' => [
        'verdict'   => ['type' => 'string', 'enum' => ['weiter', 'nachfragen', 'kern_pruefen', 'erden', 'krise']],
        'nachricht' => ['type' => 'string'],
        'antwort'   => ['type' => 'string'],
    ],
    'required' => ['verdict', 'nachricht', 'antwort'],
    'additionalProperties' => false,
];

$payload = [
    'model'      => defined('MODEL') ? MODEL : 'claude-opus-5-5',
    'max_tokens' => 4000,
    'system'     => $guide . $contract,
    'messages'   => [['role' => 'user', 'content' => $state]],
    // Kurze, dialognahe Einschätzungen: niedrige Effort-Stufe hält die Antwortzeit am Handy klein.
    'output_config' => [
        'effort' => defined('EFFORT') ? EFFORT : 'low',
        'format' => ['type' => 'json_schema', 'schema' => $schema],
    ],
    // Lehnt ein Sicherheitsfilter ab, beantwortet ein Ersatzmodell die Anfrage serverseitig.
    'fallbacks' => 'default',
];

// --- API-Aufruf (curl, sonst PHP-Streams) ----------------------------------
function post_json(string $url, array $headers, string $data): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 60,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POSTFIELDS     => $data,
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$body, $status];
    }
    $ctx = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", $headers),
        'content'       => $data,
        'timeout'       => 60,
        'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
            $status = (int)$m[1];
        }
    }
    return [$body, $status];
}

[$body, $status] = post_json('https://api.anthropic.com/v1/messages', [
    'content-type: application/json',
    'x-api-key: ' . ANTHROPIC_API_KEY,
    'anthropic-version: 2023-06-01',
    'anthropic-beta: server-side-fallback-2026-07-01',
], json_encode($payload, JSON_UNESCAPED_UNICODE));

if ($body === false || $status === 0) {
    respond(502, ['error' => 'Claude-API nicht erreichbar']);
}
$res = json_decode($body, true);
if ($status !== 200 || !is_array($res)) {
    $msg = is_array($res) ? ($res['error']['message'] ?? '') : '';
    error_log("kerntransformation coach: HTTP $status $msg");
    respond($status === 429 || $status === 529 ? 503 : 502, ['error' => 'Claude-API-Fehler']);
}
if (($res['stop_reason'] ?? '') === 'refusal') {
    respond(502, ['error' => 'Keine Einschätzung möglich']);
}

// Letzten Textblock als JSON lesen
$out = null;
foreach (array_reverse($res['content'] ?? []) as $block) {
    if (($block['type'] ?? '') === 'text') {
        $out = json_decode($block['text'], true);
        break;
    }
}
if (!is_array($out) || !isset($out['verdict'])) {
    respond(502, ['error' => 'Unerwartete Antwort']);
}
respond(200, [
    'verdict'   => (string)$out['verdict'],
    'nachricht' => (string)($out['nachricht'] ?? ''),
    'antwort'   => (string)($out['antwort'] ?? ''),
]);
