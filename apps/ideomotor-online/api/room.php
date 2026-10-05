<?php
// Ideomotor-Pendel online – Raumverwaltung fuer den Wettbewerbsmodus.
// Pro Raum genau eine JSON-Datei; alle Zugriffe mit flock. Die Messung laeuft
// vollstaendig auf den Telefonen, der Server sammelt nur Kennwerte und gibt
// allen Teilnehmern denselben Zeitplan (Serverzeit in Millisekunden).
//
// Protokoll (immer POST mit JSON-Body):
//   {action:"create", settings}                 -> {room, hostKey}
//   {action:"join",   room, nick}               -> {pid, token, nick}
//   {action:"sync",   room, pid?, token?, report?} -> Raumzustand
//   {action:"start",  room, hostKey, settings?}  -> Raumzustand (neue Runde)
//   {action:"stop",   room, hostKey}            -> Raumzustand (Runde vorzeitig beenden)
//   {action:"kick",   room, hostKey, pid}       -> Raumzustand

declare(strict_types=1);

const MAX_BODY     = 16 * 1024;
const MAX_ROOMS    = 300;
const MAX_PLAYERS  = 200;
const ROOM_TTL_S   = 48 * 3600;    // unbenutzte Raeume werden danach geloescht
const ACTIVE_MS    = 25000;        // ohne Meldung so lange gilt ein Telefon als weg
const COUNTDOWN_MS = 5000;
const FINAL_GRACE  = 60000;        // Endwerte werden bis so lange nach Rundenende angenommen
const DATA_DIR     = __DIR__ . '/data';
const CODE_CHARS   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function now_ms(): int
{
    return (int)floor(microtime(true) * 1000);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['error' => 'POST erwartet']);
}
$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || strlen($raw) > MAX_BODY) {
    respond(413, ['error' => 'Zu gross']);
}
$req = json_decode($raw, true);
if (!is_array($req)) {
    respond(400, ['error' => 'Ungueltiges JSON']);
}

if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0755, true);
}
// Datenordner nie direkt ueber das Web ausliefern.
if (is_dir(DATA_DIR) && !file_exists(DATA_DIR . '/.htaccess')) {
    @file_put_contents(DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function num($v, float $lo, float $hi, float $def): float
{
    if (!is_int($v) && !is_float($v)) {
        return $def;
    }
    $f = (float)$v;
    if (!is_finite($f)) {
        return $def;
    }
    return max($lo, min($hi, $f));
}

function clean_settings($in, array $base): array
{
    $in = is_array($in) ? $in : [];
    $title = isset($in['title']) && is_string($in['title']) ? $in['title'] : ($base['title'] ?? '');
    $title = mb_substr(trim(preg_replace('/[\x00-\x1F\x7F<>]/u', '', $title) ?? ''), 0, 60);
    return [
        'title'      => $title,
        'duration'   => (int)num($in['duration'] ?? null, 15, 300, (float)($base['duration'] ?? 60)),
        'L'          => round(num($in['L'] ?? null, 0.15, 1.5, (float)($base['L'] ?? 0.5)), 2),
        'Q'          => (int)num($in['Q'] ?? null, 5, 80, (float)($base['Q'] ?? 30)),
        'targetFrac' => round(num($in['targetFrac'] ?? null, 0.1, 0.95, (float)($base['targetFrac'] ?? 0.5)), 2),
        'thetaMaxDeg' => 12,
    ];
}

function clean_nick($s): string
{
    $s = is_string($s) ? $s : '';
    $s = preg_replace('/[\x00-\x1F\x7F<>&"\']/u', '', $s) ?? '';
    $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
    return mb_substr($s, 0, 20);
}

// Kennwerte eines Telefons auf plausible Bereiche begrenzen.
function clean_report($r): ?array
{
    if (!is_array($r)) {
        return null;
    }
    return [
        'pts'   => (int)round(num($r['pts'] ?? null, 0, 1000, 0)),
        'ratio' => round(num($r['ratio'] ?? null, 0, 500, 0), 2),
        'mov'   => round(num($r['mov'] ?? null, 0, 500, 0), 3),     // mittlere Bewegung [mm]
        'tilt'  => round(num($r['tilt'] ?? null, 0, 90, 0), 3),     // mittleres Kippen [Grad]
        'peak'  => round(num($r['peak'] ?? null, 0, 1000, 0), 1),   // groesster Ausschlag [mm]
        'amp'   => round(num($r['amp'] ?? null, 0, 1000, 0), 1),    // momentaner Ausschlag [mm]
        'reach' => round(num($r['reach'] ?? null, 0, 1, 0), 3),     // Anteil Zielmarke
        'sync'  => round(num($r['sync'] ?? null, 0, 1, 0), 3),      // Takttreue
        't'     => round(num($r['t'] ?? null, 0, 400, 0), 1),       // ausgewertete Zeit [s]
    ];
}

function room_file(string $code): string
{
    return DATA_DIR . '/' . $code . '.json';
}

function valid_code($c): bool
{
    return is_string($c) && preg_match('/^[A-Z2-9]{4}$/', $c) === 1;
}

function phase(array $room, int $now): string
{
    if ((int)$room['round'] === 0) {
        return 'lobby';
    }
    if ($now < (int)$room['startAt']) {
        return 'countdown';
    }
    if ($now < (int)$room['endAt']) {
        return 'running';
    }
    return 'done';
}

function public_state(array $room, int $now, ?string $pid): array
{
    $players = [];
    foreach ($room['players'] as $id => $p) {
        $sameRound = (int)($p['round'] ?? 0) === (int)$room['round'];
        $players[] = [
            'pid'    => $id,
            'nick'   => $p['nick'],
            'active' => ($now - (int)$p['seen']) < ACTIVE_MS,
            'src'    => $p['src'] ?? '',
            'ready'  => (bool)($p['ready'] ?? false),
            'live'   => $sameRound ? ($p['live'] ?? null) : null,
            'final'  => $sameRound ? ($p['final'] ?? null) : null,
        ];
    }
    $out = [
        'room'     => $room['code'],
        'now'      => $now,
        'settings' => $room['settings'],
        'round'    => (int)$room['round'],
        'phase'    => phase($room, $now),
        'startAt'  => (int)$room['startAt'],
        'endAt'    => (int)$room['endAt'],
        'players'  => $players,
    ];
    if ($pid !== null) {
        $out['me'] = $pid;
    }
    return $out;
}

// Raumdatei sperren, lesen, mit $fn veraendern und zurueckschreiben.
function with_room(string $code, bool $write, callable $fn): array
{
    $file = room_file($code);
    if (!file_exists($file)) {
        respond(404, ['error' => 'Raum nicht gefunden']);
    }
    $fp = fopen($file, $write ? 'c+' : 'r');
    if (!$fp) {
        respond(500, ['error' => 'Dateifehler']);
    }
    flock($fp, $write ? LOCK_EX : LOCK_SH);
    $content = stream_get_contents($fp);
    $room = $content ? json_decode($content, true) : null;
    if (!is_array($room)) {
        flock($fp, LOCK_UN);
        fclose($fp);
        respond(404, ['error' => 'Raum beschaedigt']);
    }
    $changed = false;
    $result = $fn($room, $changed);
    if ($write && $changed) {
        rewind($fp);
        ftruncate($fp, 0);
        fwrite($fp, json_encode($room, JSON_UNESCAPED_UNICODE));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return $result;
}

function require_host(array $room, $key): void
{
    if (!is_string($key) || !hash_equals((string)$room['hostKey'], $key)) {
        respond(403, ['error' => 'Nur die Spielleitung darf das']);
    }
}

/* ------------------------------------------------------------------ */
/* Aktionen                                                            */
/* ------------------------------------------------------------------ */

$action = $req['action'] ?? '';
$now = now_ms();

if ($action === 'create') {
    // Alte Raeume aufraeumen.
    $files = glob(DATA_DIR . '/*.json') ?: [];
    foreach ($files as $f) {
        if (filemtime($f) < time() - ROOM_TTL_S) {
            @unlink($f);
        }
    }
    if (count(glob(DATA_DIR . '/*.json') ?: []) >= MAX_ROOMS) {
        respond(507, ['error' => 'Zu viele Raeume']);
    }
    $code = '';
    for ($try = 0; $try < 50; $try++) {
        $code = '';
        for ($i = 0; $i < 4; $i++) {
            $code .= CODE_CHARS[random_int(0, strlen(CODE_CHARS) - 1)];
        }
        $fp = @fopen(room_file($code), 'x');
        if ($fp) {
            break;
        }
        $code = '';
    }
    if ($code === '') {
        respond(500, ['error' => 'Kein freier Raumcode']);
    }
    $hostKey = bin2hex(random_bytes(16));
    $room = [
        'code'     => $code,
        'created'  => $now,
        'hostKey'  => $hostKey,
        'settings' => clean_settings($req['settings'] ?? null, []),
        'round'    => 0,
        'startAt'  => 0,
        'endAt'    => 0,
        'players'  => new stdClass(),
    ];
    fwrite($fp, json_encode($room, JSON_UNESCAPED_UNICODE));
    fclose($fp);
    respond(200, ['room' => $code, 'hostKey' => $hostKey]);
}

$code = strtoupper((string)($req['room'] ?? ''));
if (!valid_code($code)) {
    respond(400, ['error' => 'Ungueltiger Raumcode']);
}

if ($action === 'join') {
    $nick = clean_nick($req['nick'] ?? '');
    if ($nick === '') {
        respond(400, ['error' => 'Bitte einen Namen eingeben']);
    }
    $res = with_room($code, true, function (array &$room, bool &$changed) use ($nick, $now) {
        if (count($room['players']) >= MAX_PLAYERS) {
            respond(507, ['error' => 'Raum ist voll']);
        }
        // Gleiche Namen durchnummerieren.
        $taken = array_map(fn($p) => mb_strtolower($p['nick']), array_values($room['players']));
        $final = $nick;
        for ($n = 2; in_array(mb_strtolower($final), $taken, true); $n++) {
            $final = mb_substr($nick, 0, 17) . ' ' . $n;
        }
        $pid = 'p' . bin2hex(random_bytes(4));   // Praefix: sonst wird die ID zum Zahlenschluessel
        $token = bin2hex(random_bytes(16));
        $room['players'][$pid] = [
            'nick' => $final, 'token' => $token, 'joined' => $now, 'seen' => $now,
            'round' => 0, 'live' => null, 'final' => null, 'src' => '', 'ready' => false,
        ];
        $changed = true;
        return ['pid' => $pid, 'token' => $token, 'nick' => $final];
    });
    respond(200, $res);
}

if ($action === 'sync') {
    $pid = $req['pid'] ?? null;
    $isPlayer = is_string($pid) && preg_match('/^p[a-f0-9]{8}$/', $pid) === 1;
    $state = with_room($code, $isPlayer, function (array &$room, bool &$changed) use ($req, $pid, $isPlayer, $now) {
        if (!$isPlayer) {
            return public_state($room, $now, null);
        }
        $p = $room['players'][$pid] ?? null;
        if (!is_array($p) || !hash_equals((string)$p['token'], (string)($req['token'] ?? ''))) {
            respond(403, ['error' => 'Unbekannter Teilnehmer', 'rejoin' => true]);
        }
        $p['seen'] = $now;
        $src = $req['src'] ?? '';
        $p['src'] = in_array($src, ['motion', 'pointer'], true) ? $src : '';
        $p['ready'] = (bool)($req['ready'] ?? false);

        $rep = $req['report'] ?? null;
        $round = (int)$room['round'];
        if (is_array($rep) && (int)($rep['round'] ?? -1) === $round && $round > 0) {
            if ((int)($p['round'] ?? 0) !== $round) {
                $p['round'] = $round;
                $p['live'] = null;
                $p['final'] = null;
            }
            $ph = phase($room, $now);
            if (isset($rep['live']) && ($ph === 'running' || $now < (int)$room['endAt'] + 3000)) {
                $p['live'] = clean_report($rep['live']);
            }
            if (isset($rep['final']) && $p['final'] === null
                && $now >= (int)$room['endAt'] - 2000 && $now < (int)$room['endAt'] + FINAL_GRACE) {
                $p['final'] = clean_report($rep['final']);
            }
        }
        $room['players'][$pid] = $p;
        $changed = true;
        return public_state($room, $now, $pid);
    });
    respond(200, $state);
}

if ($action === 'start') {
    $state = with_room($code, true, function (array &$room, bool &$changed) use ($req, $now) {
        require_host($room, $req['hostKey'] ?? null);
        $ph = phase($room, $now);
        if ($ph === 'running' || $ph === 'countdown') {
            respond(409, ['error' => 'Es laeuft bereits eine Runde']);
        }
        if (isset($req['settings'])) {
            $room['settings'] = clean_settings($req['settings'], $room['settings']);
        }
        $room['round'] = (int)$room['round'] + 1;
        $room['startAt'] = $now + COUNTDOWN_MS;
        $room['endAt'] = $room['startAt'] + 1000 * (int)$room['settings']['duration'];
        $changed = true;
        return public_state($room, $now, null);
    });
    respond(200, $state);
}

if ($action === 'stop') {
    $state = with_room($code, true, function (array &$room, bool &$changed) use ($req, $now) {
        require_host($room, $req['hostKey'] ?? null);
        $ph = phase($room, $now);
        if ($ph === 'countdown') {
            // Abbruch vor dem Start: Runde zuruecknehmen.
            $room['round'] = (int)$room['round'] - 1;
            $room['startAt'] = $room['endAt'] = $room['round'] > 0 ? $now - 1 : 0;
            $changed = true;
        } elseif ($ph === 'running') {
            $room['endAt'] = $now;
            $changed = true;
        }
        return public_state($room, $now, null);
    });
    respond(200, $state);
}

if ($action === 'kick') {
    $state = with_room($code, true, function (array &$room, bool &$changed) use ($req, $now) {
        require_host($room, $req['hostKey'] ?? null);
        $pid = (string)($req['pid'] ?? '');
        if (isset($room['players'][$pid])) {
            unset($room['players'][$pid]);
            $changed = true;
        }
        return public_state($room, $now, null);
    });
    respond(200, $state);
}

respond(400, ['error' => 'Unbekannte Aktion']);
