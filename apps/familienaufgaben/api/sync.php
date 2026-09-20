<?php
// Familienaufgaben – Sync-Ablage.
// Speichert pro Familie genau einen verschluesselten Datenblock samt Versionsnummer.
// Der Server sieht nur Chiffretext; Schluessel und Passwort verlassen die iPhones nie.
//
// Protokoll (immer POST mit JSON-Body):
//   {action:"pull", family:<64 hex>, known:<int>}  -> {version, data} | {version, unchanged:true}
//   {action:"push", family:<64 hex>, base:<int>, data:<base64>}
//        -> 200 {version}            wenn base der aktuellen Version entspricht
//        -> 409 {version, data}      sonst (Client fuehrt zusammen und versucht es erneut)

declare(strict_types=1);

const MAX_BYTES    = 8 * 1024 * 1024; // maximale Groesse eines Datenblocks
const MAX_FAMILIES = 25;              // Schutz gegen Missbrauch der Ablage
const DATA_DIR     = __DIR__ . '/data';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['error' => 'POST erwartet']);
}

$raw = file_get_contents('php://input', false, null, 0, MAX_BYTES + 4096);
if ($raw === false || strlen($raw) > MAX_BYTES + 2048) {
    respond(413, ['error' => 'Zu gross']);
}
$req = json_decode($raw, true);
if (!is_array($req)) {
    respond(400, ['error' => 'Ungueltiges JSON']);
}

$family = $req['family'] ?? '';
if (!is_string($family) || !preg_match('/^[a-f0-9]{64}$/', $family)) {
    respond(400, ['error' => 'Ungueltige Familien-ID']);
}
$action = $req['action'] ?? '';
$file   = DATA_DIR . '/' . $family . '.json';

if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0755, true);
}
// Datenordner nie direkt ueber das Web ausliefern.
if (is_dir(DATA_DIR) && !file_exists(DATA_DIR . '/.htaccess')) {
    @file_put_contents(DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
}

function read_current($fp): array
{
    rewind($fp);
    $content = stream_get_contents($fp);
    $cur = $content ? json_decode($content, true) : null;
    if (!is_array($cur) || !isset($cur['version'])) {
        return ['version' => 0, 'data' => null];
    }
    return $cur;
}

if ($action === 'pull') {
    if (!file_exists($file)) {
        respond(200, ['version' => 0, 'data' => null]);
    }
    $fp = fopen($file, 'r');
    if (!$fp) {
        respond(500, ['error' => 'Lesefehler']);
    }
    flock($fp, LOCK_SH);
    $cur = read_current($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    if ((int)($req['known'] ?? -1) === (int)$cur['version']) {
        respond(200, ['version' => (int)$cur['version'], 'unchanged' => true]);
    }
    respond(200, ['version' => (int)$cur['version'], 'data' => $cur['data']]);
}

if ($action === 'push') {
    $data = $req['data'] ?? null;
    if (!is_string($data) || $data === '' || !preg_match('/^[A-Za-z0-9+\/=]+$/', $data)) {
        respond(400, ['error' => 'Ungueltige Daten']);
    }
    if (!file_exists($file)) {
        $count = count(glob(DATA_DIR . '/*.json') ?: []);
        if ($count >= MAX_FAMILIES) {
            respond(507, ['error' => 'Ablage voll']);
        }
    }
    $fp = fopen($file, 'c+');
    if (!$fp) {
        respond(500, ['error' => 'Schreibfehler']);
    }
    flock($fp, LOCK_EX);
    $cur = read_current($fp);
    if ((int)($req['base'] ?? -1) !== (int)$cur['version']) {
        flock($fp, LOCK_UN);
        fclose($fp);
        respond(409, ['version' => (int)$cur['version'], 'data' => $cur['data']]);
    }
    $next = ['version' => (int)$cur['version'] + 1, 'data' => $data, 'updated' => gmdate('c')];
    rewind($fp);
    ftruncate($fp, 0);
    fwrite($fp, json_encode($next));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    respond(200, ['version' => $next['version']]);
}

respond(400, ['error' => 'Unbekannte Aktion']);
