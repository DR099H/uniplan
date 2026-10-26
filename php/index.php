<?php
define('UNIPLAN_APP', true);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/auth.php';
require_once __DIR__ . '/api/validate.php';
require_once __DIR__ . '/api/week.php';

const MAX_BODY = 1048576;
const LOGIN_RE = '/^[a-zA-Z0-9_.-]{3,32}$/';

function sendJson($status, $data = null, array $extraHeaders = []) {
    http_response_code((int)$status);
    $headers = [
        'X-Content-Type-Options' => 'nosniff',
        'Referrer-Policy' => 'same-origin',
        'Content-Security-Policy' => "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
    ];
    
    foreach ($extraHeaders as $k => $v) {
        $headers[$k] = $v;
    }

    if ((int)$status === 204) {
        foreach ($headers as $k => $v) {
            header("$k: $v");
        }
        exit;
    }
    
    $headers['Content-Type'] = 'application/json; charset=utf-8';
    $headers['Cache-Control'] = 'no-store';
    
    foreach ($headers as $k => $v) {
        header("$k: $v");
    }
    
    if ($data !== null) {
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    exit;
}

function sendError($status, $message, array $details = []) {
    $data = ['error' => $message];
    if (!empty($details)) {
        $data['details'] = $details;
    }
    sendJson((int)$status, $data);
}

function readJsonBody() {
    $body = file_get_contents('php://input');
    if (strlen($body) > MAX_BODY) {
        sendError(413, 'Слишком большой запрос (максимум 1 МБ)');
    }
    if (empty($body)) {
        return [];
    }
    $decoded = json_decode($body, true);
    if ($decoded === null) {
        sendError(400, 'Тело запроса — некорректный JSON');
    }
    if (!is_array($decoded)) {
        sendError(400, 'Ожидается JSON-объект');
    }
    return $decoded;
}

function cleanText($value, $max) {
    if (!is_string($value)) {
        return '';
    }
    $value = trim($value);
    $value = preg_replace('/\s+/', ' ', $value);
    return mb_substr($value, 0, (int)$max, 'UTF-8');
}

function getUser() {
    $token = getSessionToken();
    if (!$token) return null;
    return userBySession(getDb(), $token);
}

function requireUser() {
    $user = getUser();
    if (!$user) {
        sendError(401, 'Нужно войти в систему');
    }
    return $user;
}

function requireStarosta() {
    $user = requireUser();
    if ($user['role'] !== 'starosta') {
        sendError(403, 'Действие доступно только старосте группы');
    }
    return $user;
}

function publicUser(array $u) {
    return [
        'id' => (int)$u['id'],
        'login' => $u['login'],
        'name' => $u['name'],
        'role' => $u['role'],
        'groupId' => (int)$u['group_id'],
        'approved' => !empty($u['approved'])
    ];
}

function publicGroup($g, $dateIso = null) {
    if (!$g || !is_array($g)) return null;
    $date = $dateIso ? $dateIso : todayISO();
    $course = isset($g['course']) ? $g['course'] : null;
    $semester = isset($g['semester']) ? $g['semester'] : null;
    $cs = computeCourseAndSemester($g['name'], $date, $course, $semester);
    return [
        'id' => (int)$g['id'],
        'name' => $g['name'],
        'semesterStart' => $g['semester_start'],
        'course' => (int)$cs['course'],
        'semester' => (int)$cs['semester'],
        'explicitCourse' => $course !== null ? (int)$course : null,
        'explicitSemester' => $semester !== null ? (int)$semester : null
    ];
}

function publicLesson(array $l) {
    return [
        'id' => (int)$l['id'],
        'day' => (int)$l['day'],
        'week' => (int)$l['week'],
        'start' => $l['start_time'],
        'end' => $l['end_time'],
        'subject' => $l['subject'],
        'type' => $l['type'],
        'room' => $l['room'],
        'teacher' => $l['teacher']
    ];
}

function publicTask(array $t, $user = null) {
    $isGroup = !empty($t['group_id']);
    $canDelete = true;
    if ($isGroup) {
        $canDelete = ($user && isset($user['role']) && $user['role'] === 'starosta' && (int)$user['group_id'] === (int)$t['group_id']);
    } else if ($user) {
        $canDelete = ((int)$user['id'] === (int)$t['user_id']);
    }
    return [
        'id' => (int)$t['id'],
        'date' => $t['date'],
        'text' => $t['text'],
        'subject' => $t['subject'],
        'done' => (bool)$t['done'],
        'isGroup' => $isGroup,
        'canDelete' => $canDelete
    ];
}

function getGroup(PDO $db, $id) {
    $stmt = $db->prepare('SELECT * FROM groups WHERE id = ?');
    $stmt->execute([(int)$id]);
    $group = $stmt->fetch(PDO::FETCH_ASSOC);
    return $group ? $group : null;
}

function groupPayload(PDO $db, $id) {
    $group = publicGroup(getGroup($db, (int)$id));
    if (!$group) return [];
    
    $stmt = $db->prepare("SELECT name FROM users WHERE group_id = ? AND role = 'starosta' ORDER BY name");
    $stmt->execute([(int)$id]);
    $starostas = $stmt->fetchAll(PDO::FETCH_COLUMN);
    
    $group['starostas'] = $starostas;
    return $group;
}

function groupLessons(PDO $db, $groupId) {
    $stmt = $db->prepare('SELECT * FROM lessons WHERE group_id = ? ORDER BY day, start_time');
    $stmt->execute([(int)$groupId]);
    return array_map('publicLesson', $stmt->fetchAll(PDO::FETCH_ASSOC));
}

function accessibleTask(PDO $db, array $user, $id) {
    $stmt = $db->prepare('
        SELECT
            t.id, t.user_id, t.group_id, t.date, t.text, t.subject,
            CASE
                WHEN t.group_id IS NOT NULL THEN COALESCE(tc.done, 0)
                ELSE t.done
            END AS done,
            t.created_at
        FROM tasks t
        LEFT JOIN task_completions tc ON tc.task_id = t.id AND tc.user_id = ?
        WHERE t.id = ? AND ((t.user_id = ? AND t.group_id IS NULL) OR t.group_id = ?)
    ');
    $stmt->execute([(int)$user['id'], (int)$id, (int)$user['id'], (int)$user['group_id']]);
    $task = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$task) {
        sendError(404, 'Задача не найдена');
    }
    return $task;
}

function ownTask(PDO $db, array $user, $id) {
    return accessibleTask($db, $user, $id);
}

function ownLesson(PDO $db, array $user, $id) {
    $stmt = $db->prepare('SELECT * FROM lessons WHERE id = ? AND group_id = ?');
    $stmt->execute([(int)$id, (int)$user['group_id']]);
    $lesson = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$lesson) {
        sendError(404, 'Пара не найдена в расписании вашей группы');
    }
    return $lesson;
}

function loginResponse(PDO $db, $res_unused, $status, array $user) {
    $token = createSession($db, (int)$user['id']);
    setSessionCookie($token);
    sendJson((int)$status, [
        'user' => publicUser($user),
        'group' => groupPayload($db, (int)$user['group_id'])
    ]);
}

function checkLesson(PDO $db, array $user, array $raw, $exceptId = null) {
    $res = normalizeLesson($raw);
    if (!$res['lesson']) sendError(400, 'Проверьте поля пары', $res['errors']);
    
    $lessons = groupLessons($db, (int)$user['group_id']);
    $clash = null;
    foreach ($lessons as $l) {
        if ($exceptId !== null && (int)$l['id'] === (int)$exceptId) continue;
        if (lessonsOverlap($l, $res['lesson'])) {
            $clash = $l;
            break;
        }
    }
    if ($clash) {
        sendError(409, 'Пересекается с парой: ' . describeLesson($clash), [['path' => 'start', 'message' => 'Время занято другой парой']]);
    }
    return $res['lesson'];
}

function scheduleFile(array $group, array $lessons) {
    return [
        'group' => $group['name'],
        'semesterStart' => $group['semester_start'],
        'lessons' => array_map(function($l) {
            return [
                'day' => isset(DAY_SHORT[$l['day']]) ? DAY_SHORT[$l['day']] : $l['day'],
                'week' => (int)$l['week'] === 0 ? 'обе' : (int)$l['week'],
                'start' => $l['start'],
                'end' => $l['end'],
                'subject' => $l['subject'],
                'type' => $l['type'],
                'room' => $l['room'],
                'teacher' => $l['teacher']
            ];
        }, $lessons)
    ];
}

// ---------------------------------------------------------
// ROUTER LOGIC
// ---------------------------------------------------------

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
$requestUri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
$path = parse_url($requestUri, PHP_URL_PATH);

if (isset($_GET['_route']) && is_string($_GET['_route']) && $_GET['_route'] !== '') {
    $path = $_GET['_route'];
} else {
    // Strip subfolder prefix only if index.php resides in that URL subfolder
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? realpath($_SERVER['DOCUMENT_ROOT']) : false;
    $appRoot = realpath(__DIR__);
    if ($docRoot && $appRoot && strpos($appRoot, $docRoot) === 0 && strlen($appRoot) > strlen($docRoot)) {
        $subDir = str_replace('\\', '/', substr($appRoot, strlen($docRoot)));
        if ($subDir !== '' && $subDir !== '/' && strpos($path, $subDir) === 0) {
            $path = substr($path, strlen($subDir));
        }
    }
}

if ($path === '' || $path === false || $path === '/index.php' || $path === '/index.html') {
    $path = '/';
}

if (strpos($path, '/api/') !== 0) {
    if ($method !== 'GET' && $method !== 'HEAD') {
        sendError(405, 'Метод не поддерживается');
    }
    
    if (is_dir(__DIR__ . '/client')) {
        $clientRoot = __DIR__ . '/client';
    } elseif (file_exists(__DIR__ . '/index.html')) {
        $clientRoot = __DIR__;
    } else {
        $clientRoot = __DIR__ . '/../client';
    }

    if (is_dir(__DIR__ . '/shared')) {
        $sharedRoot = __DIR__ . '/shared';
    } else {
        $sharedRoot = __DIR__ . '/../shared';
    }

    $base = $clientRoot;
    $rel = $path;
    if (strpos($path, '/shared/') === 0) {
        $base = $sharedRoot;
        $rel = substr($path, strlen('/shared'));
    }
    
    $cleanRel = rtrim($rel, '/');
    if ($cleanRel === '/apple-touch-icon' || $cleanRel === '/apple-touch-icon-precomposed') {
        $rel = $cleanRel . '.png';
    }
    
    $baseReal = @realpath($base);
    $file = ($baseReal && $rel !== '/') ? @realpath($baseReal . '/' . ltrim(urldecode($rel), '/')) : false;
    
    if ($file && is_dir($file)) {
        $file = @realpath($file . '/index.html');
    }
    
    if (!$file || !$baseReal || strpos($file, $baseReal) !== 0) {
        $ext = pathinfo(urldecode($rel), PATHINFO_EXTENSION);
        if ($ext && $rel !== '/index.php' && $rel !== '/index.html') {
            sendError(404, 'Файл не найден');
        }
        $file = $baseReal ? @realpath($baseReal . '/index.html') : false;
    }
    
    if (!$file || !file_exists($file)) {
        sendError(404, 'Файл не найден (проверьте, что папки client/ и shared/ загружены на сервер)');
    }
    
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if ($ext === 'php' || $ext === 'sql') {
        sendError(403, 'Запрещено');
    }
    $mimeTypes = [
        'html' => 'text/html; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'ico' => 'image/x-icon',
        'webmanifest' => 'application/manifest+json',
    ];
    $mime = isset($mimeTypes[$ext]) ? $mimeTypes[$ext] : 'application/octet-stream';
    
    $mtime = @filemtime($file) ?: time();
    $etag = '"' . dechex($mtime) . '-' . dechex(@filesize($file) ?: 0) . '"';

    header("Content-Type: $mime");
    header("ETag: $etag");
    header("Last-Modified: " . gmdate('D, d M Y H:i:s \G\M\T', $mtime));
    header("X-Content-Type-Options: nosniff");
    header("Referrer-Policy: same-origin");
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'");
    
    if ($ext === 'html') {
        header("Cache-Control: no-cache, must-revalidate");
        header("Pragma: no-cache");
    } else {
        header("Cache-Control: public, max-age=2592000, stale-while-revalidate=86400");
    }

    // Conditional HTTP request (304 Not Modified)
    $ifNoneMatch = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : '';
    $ifModifiedSince = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) ? strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE']) : false;

    if ($ifNoneMatch === $etag || ($ifModifiedSince && $ifModifiedSince >= $mtime)) {
        header("HTTP/1.1 304 Not Modified");
        exit;
    }
    
    if ($method !== 'HEAD') {
        if ($ext === 'html') {
            $html = file_get_contents($file);
            $hasMinCss = file_exists($baseReal . '/css/app.min.css');
            $hasMinJs = file_exists($baseReal . '/js/main.min.js');

            $cssFile = $hasMinCss ? '/css/app.min.css' : '/css/app.css';
            $cssVer = @filemtime($baseReal . $cssFile) ?: time();

            $jsFile = $hasMinJs ? '/js/main.min.js' : '/js/main.js';
            $jsVer = @filemtime($baseReal . $jsFile) ?: time();

            $themeFile = ($hasMinJs && file_exists($baseReal . '/js/theme-init.min.js')) ? '/js/theme-init.min.js' : '/js/theme-init.js';
            $themeVer = @filemtime($baseReal . $themeFile) ?: time();

            $html = preg_replace('#/css/app(\.min)?\.css(\?[^"\']*)?#', $cssFile . '?v=' . $cssVer, $html);
            $html = preg_replace('#/js/theme-init(\.min)?\.js(\?[^"\']*)?#', $themeFile . '?v=' . $themeVer, $html);
            $html = preg_replace('#/js/main(\.min)?\.js(\?[^"\']*)?#', $jsFile . '?v=' . $jsVer, $html);
            echo $html;
        } else {
            readfile($file);
        }
    }
    exit;
}

try {
    $db = getDb();

    // ---------- справочники ----------
    
    if ($method === 'GET' && $path === '/api/groups') {
        $stmt = $db->query('SELECT id, name FROM groups ORDER BY name');
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
        }
        unset($r);
        sendJson(200, ['groups' => $rows]);
    }
    
    if ($method === 'GET' && $path === '/api/meta') {
        sendJson(200, ['demo' => (bool)DEMO_ENABLED, 'lessonTypes' => LESSON_TYPES]);
    }
    
    // ---------- US-01: регистрация, вход, профиль ----------
    
    if ($method === 'POST' && $path === '/api/auth/register') {
        $body = readJsonBody();
        $name = cleanText(isset($body['name']) ? $body['name'] : '', 60);
        $loginName = (isset($body['login']) && is_string($body['login'])) ? trim($body['login']) : '';
        $password = (isset($body['password']) && is_string($body['password'])) ? $body['password'] : '';
        $groupId = isset($body['groupId']) ? (int)$body['groupId'] : 0;
        
        $details = [];
        if (mb_strlen($name, 'UTF-8') < 2) $details[] = ['path' => 'name', 'message' => 'Введите имя (от 2 символов)'];
        if (!preg_match(LOGIN_RE, $loginName)) $details[] = ['path' => 'login', 'message' => 'Логин: 3–32 символа, латиница, цифры, точка, _ или -'];
        if (mb_strlen($password, 'UTF-8') < 6) $details[] = ['path' => 'password', 'message' => 'Пароль должен быть не короче 6 символов'];
        if (mb_strlen($password, 'UTF-8') > 128) $details[] = ['path' => 'password', 'message' => 'Пароль слишком длинный'];
        if (!getGroup($db, $groupId)) $details[] = ['path' => 'groupId', 'message' => 'Выберите группу из списка'];
        
        if (!empty($details)) {
            sendError(400, 'Проверьте поля формы', $details);
        }
        
        $stmt = $db->prepare('SELECT 1 FROM users WHERE LOWER(login) = LOWER(?)');
        $stmt->execute([$loginName]);
        if ($stmt->fetch()) {
            sendError(409, 'Этот логин уже занят', [['path' => 'login', 'message' => 'Этот логин уже занят']]);
        }
        
        $stmt = $db->prepare('INSERT INTO users (login, name, password_hash, group_id, approved) VALUES (?, ?, ?, ?, 0)');
        $stmt->execute([$loginName, $name, hashPassword($password), $groupId]);
        $id = (int)$db->lastInsertId();
        
        $stmt = $db->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        loginResponse($db, null, 201, $stmt->fetch(PDO::FETCH_ASSOC));
    }
    
    if ($method === 'POST' && $path === '/api/auth/login') {
        $body = readJsonBody();
        $loginName = (isset($body['login']) && is_string($body['login'])) ? trim($body['login']) : '';
        $stmt = $db->prepare('SELECT * FROM users WHERE LOWER(login) = LOWER(?)');
        $stmt->execute([$loginName]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        $password = (isset($body['password']) && is_string($body['password'])) ? $body['password'] : null;
        if (!$user || $password === null || !verifyPassword($password, $user['password_hash'])) {
            sendError(401, 'Неверный логин или пароль');
        }
        loginResponse($db, null, 200, $user);
    }
    
    if ($method === 'POST' && $path === '/api/auth/demo') {
        if (!DEMO_ENABLED) sendError(404, 'Демо-вход отключён');
        $body = readJsonBody();
        $as = isset($body['as']) ? $body['as'] : '';
        $loginName = $as === 'starosta' ? 'starosta' : 'student';
        $stmt = $db->prepare('SELECT * FROM users WHERE LOWER(login) = LOWER(?)');
        $stmt->execute([$loginName]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user) sendError(404, 'Демо-аккаунт не найден');
        loginResponse($db, null, 200, $user);
    }
    
    if ($method === 'POST' && $path === '/api/auth/logout') {
        $token = getSessionToken();
        if ($token) {
            destroySession($db, $token);
        }
        clearSessionCookie();
        sendJson(204);
    }
    
    if ($method === 'GET' && $path === '/api/me') {
        $user = requireUser();
        sendJson(200, ['user' => publicUser($user), 'group' => groupPayload($db, $user['group_id'])]);
    }
    
    if ($method === 'PATCH' && $path === '/api/me') {
        $user = requireUser();
        $body = readJsonBody();
        
        if (array_key_exists('name', $body)) {
            $name = cleanText($body['name'], 60);
            if (mb_strlen($name, 'UTF-8') < 2) {
                sendError(400, 'Введите имя (от 2 символов)', [['path' => 'name', 'message' => 'Введите имя (от 2 символов)']]);
            }
            $stmt = $db->prepare('UPDATE users SET name = ? WHERE id = ?');
            $stmt->execute([$name, $user['id']]);
        }
        
        if (array_key_exists('groupId', $body) && (int)$body['groupId'] !== (int)$user['group_id']) {
            if ($user['role'] === 'starosta') {
                sendError(403, 'Староста не может сменить группу — обратитесь к администратору');
            }
            if (!getGroup($db, (int)$body['groupId'])) {
                sendError(400, 'Такой группы нет');
            }
            $stmt = $db->prepare('UPDATE users SET group_id = ?, approved = 0 WHERE id = ?');
            $stmt->execute([(int)$body['groupId'], $user['id']]);
        }
        
        $stmt = $db->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$user['id']]);
        $fresh = $stmt->fetch(PDO::FETCH_ASSOC);
        sendJson(200, ['user' => publicUser($fresh), 'group' => groupPayload($db, $fresh['group_id'])]);
    }
    
    // ---------- US-02: расписание и тип недели ----------
    
    if ($method === 'GET' && $path === '/api/schedule') {
        $user = requireUser();
        $groupId = isset($_GET['groupId']) ? (int)$_GET['groupId'] : (int)$user['group_id'];
        $group = getGroup($db, $groupId);
        if (!$group) sendError(404, 'Группа не найдена');
        
        $lessons = groupLessons($db, $groupId);
        
        if (isset($_GET['week'])) {
            $week = (int)$_GET['week'];
            if ($week !== 1 && $week !== 2) sendError(400, 'Параметр week: 1 или 2');
            $lessons = array_values(array_filter($lessons, function($l) use ($week) {
                return (int)$l['week'] === 0 || (int)$l['week'] === $week;
            }));
        }
        if (isset($_GET['day'])) {
            $day = (int)$_GET['day'];
            if (!($day >= 1 && $day <= 7)) sendError(400, 'Параметр day: 1–7');
            $lessons = array_values(array_filter($lessons, function($l) use ($day) {
                return (int)$l['day'] === $day;
            }));
        }
        
        sendJson(200, ['group' => publicGroup($group), 'lessons' => $lessons]);
    }
    
    if ($method === 'GET' && $path === '/api/week-type') {
        $user = requireUser();
        $date = (isset($_GET['date']) && $_GET['date'] !== '') ? $_GET['date'] : todayISO();
        if (!isValidISODate($date)) sendError(400, 'Параметр date в формате ГГГГ-ММ-ДД');
        $group = getGroup($db, $user['group_id']);
        
        sendJson(200, [
            'date' => $date,
            'monday' => mondayOf($date),
            'week' => weekType($date, $group['semester_start']),
            'semesterStart' => $group['semester_start']
        ]);
    }
    
    // ---------- US-04: ручной ввод (только староста) ----------
    
    if ($method === 'POST' && $path === '/api/lessons') {
        $user = requireStarosta();
        $body = readJsonBody();
        $l = checkLesson($db, $user, $body);
        
        $stmt = $db->prepare('INSERT INTO lessons (group_id, day, week, start_time, end_time, subject, type, room, teacher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$user['group_id'], $l['day'], $l['week'], $l['start'], $l['end'], $l['subject'], $l['type'], $l['room'], $l['teacher']]);
        $id = (int)$db->lastInsertId();
        
        $stmt = $db->prepare('SELECT * FROM lessons WHERE id = ?');
        $stmt->execute([$id]);
        sendJson(201, ['lesson' => publicLesson($stmt->fetch(PDO::FETCH_ASSOC))]);
    }
    
    if ($method === 'PUT' && preg_match('#^/api/lessons/(\d+)$#', $path, $matches)) {
        $user = requireStarosta();
        $id = (int)$matches[1];
        $current = ownLesson($db, $user, $id);
        $body = readJsonBody();
        $l = checkLesson($db, $user, $body, $current['id']);
        
        $stmt = $db->prepare('UPDATE lessons SET day = ?, week = ?, start_time = ?, end_time = ?, subject = ?, type = ?, room = ?, teacher = ? WHERE id = ?');
        $stmt->execute([$l['day'], $l['week'], $l['start'], $l['end'], $l['subject'], $l['type'], $l['room'], $l['teacher'], $current['id']]);
        
        $stmt = $db->prepare('SELECT * FROM lessons WHERE id = ?');
        $stmt->execute([$current['id']]);
        sendJson(200, ['lesson' => publicLesson($stmt->fetch(PDO::FETCH_ASSOC))]);
    }
    
    if ($method === 'DELETE' && preg_match('#^/api/lessons/(\d+)$#', $path, $matches)) {
        $user = requireStarosta();
        $id = (int)$matches[1];
        $current = ownLesson($db, $user, $id);
        
        $stmt = $db->prepare('DELETE FROM lessons WHERE id = ?');
        $stmt->execute([$current['id']]);
        sendJson(204);
    }
    
    if ($method === 'PATCH' && $path === '/api/group') {
        $user = requireStarosta();
        $body = readJsonBody();
        if (isset($body['semesterStart'])) {
            if (!isValidISODate($body['semesterStart'])) {
                sendError(400, 'Дата начала семестра в формате ГГГГ-ММ-ДД', [['path' => 'semesterStart', 'message' => 'Укажите дату']]);
            }
            $stmt = $db->prepare('UPDATE groups SET semester_start = ? WHERE id = ?');
            $stmt->execute([$body['semesterStart'], $user['group_id']]);
        }
        if (array_key_exists('course', $body)) {
            $c = ($body['course'] === null || $body['course'] === '') ? null : (int)$body['course'];
            $stmt = $db->prepare('UPDATE groups SET course = ? WHERE id = ?');
            $stmt->execute([$c, $user['group_id']]);
        }
        if (array_key_exists('semester', $body)) {
            $s = ($body['semester'] === null || $body['semester'] === '') ? null : (int)$body['semester'];
            $stmt = $db->prepare('UPDATE groups SET semester = ? WHERE id = ?');
            $stmt->execute([$s, $user['group_id']]);
        }
        sendJson(200, ['group' => publicGroup(getGroup($db, $user['group_id']))]);
    }
    
    // ---------- управление участниками группы (только староста) ----------
    
    if ($method === 'GET' && $path === '/api/group/members') {
        $user = requireStarosta();
        $stmt = $db->prepare('
            SELECT id, login, name, role, approved, created_at
            FROM users
            WHERE group_id = ?
            ORDER BY role DESC, approved ASC, name ASC
        ');
        $stmt->execute([(int)$user['group_id']]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $members = array_map(function($u) {
            return [
                'id' => (int)$u['id'],
                'login' => $u['login'],
                'name' => $u['name'],
                'role' => $u['role'],
                'approved' => !empty($u['approved']),
                'createdAt' => $u['created_at']
            ];
        }, $rows);
        sendJson(200, ['members' => $members]);
    }
    
    if ($method === 'POST' && preg_match('#^/api/group/members/(\d+)/approve$#', $path, $matches)) {
        $user = requireStarosta();
        $id = (int)$matches[1];
        $stmt = $db->prepare('SELECT * FROM users WHERE id = ? AND group_id = ?');
        $stmt->execute([$id, (int)$user['group_id']]);
        $target = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$target) sendError(404, 'Студент не найден в вашей группе');
        $stmt = $db->prepare('UPDATE users SET approved = 1 WHERE id = ?');
        $stmt->execute([$id]);
        $stmt = $db->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        sendJson(200, ['member' => publicUser($stmt->fetch(PDO::FETCH_ASSOC))]);
    }
    
    if ($method === 'DELETE' && preg_match('#^/api/group/members/(\d+)$#', $path, $matches)) {
        $user = requireStarosta();
        $id = (int)$matches[1];
        $stmt = $db->prepare('SELECT * FROM users WHERE id = ? AND group_id = ?');
        $stmt->execute([$id, (int)$user['group_id']]);
        $target = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$target) sendError(404, 'Студент не найден в вашей группе');
        if ($target['role'] === 'starosta') sendError(403, 'Нельзя удалить старосту группы');
        $stmt = $db->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$id]);
        sendJson(204);
    }
    
    // ---------- US-05: импорт / экспорт JSON ----------
    
    if ($method === 'POST' && $path === '/api/schedule/import') {
        $user = requireStarosta();
        $body = readJsonBody();
        $mode = (isset($body['mode']) && $body['mode'] === 'append') ? 'append' : 'replace';
        $group = getGroup($db, $user['group_id']);
        $existing = $mode === 'append' ? groupLessons($db, $user['group_id']) : [];
        
        $dataPayload = isset($body['data']) ? $body['data'] : null;
        $result = validateSchedule($dataPayload, ['groupName' => $group['name'], 'existing' => $existing]);
        if (!$result['ok']) {
            sendError(422, 'Файл не прошёл проверку', $result['errors']);
        }
        $summary = summarize($result['lessons']);
        
        if (!empty($body['dryRun'])) {
            sendJson(200, [
                'dryRun' => true,
                'mode' => $mode,
                'summary' => $summary,
                'lessons' => $result['lessons'],
                'semesterStart' => $result['semesterStart']
            ]);
        }
        
        transaction(function() use ($db, $mode, $user, $result) {
            if ($mode === 'replace') {
                $stmt = $db->prepare('DELETE FROM lessons WHERE group_id = ?');
                $stmt->execute([$user['group_id']]);
            }
            $ins = $db->prepare('INSERT INTO lessons (group_id, day, week, start_time, end_time, subject, type, room, teacher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            foreach ($result['lessons'] as $l) {
                $ins->execute([$user['group_id'], $l['day'], $l['week'], $l['start'], $l['end'], $l['subject'], $l['type'], $l['room'], $l['teacher']]);
            }
            if ($result['semesterStart']) {
                $stmt = $db->prepare('UPDATE groups SET semester_start = ? WHERE id = ?');
                $stmt->execute([$result['semesterStart'], $user['group_id']]);
            }
        });
        
        sendJson(200, [
            'imported' => count($result['lessons']),
            'mode' => $mode,
            'summary' => $summary,
            'group' => publicGroup(getGroup($db, $user['group_id']))
        ]);
    }
    
    if ($method === 'GET' && $path === '/api/schedule/template') {
        $user = requireUser();
        $group = getGroup($db, $user['group_id']);
        $example = [
            ['day' => 1, 'week' => 0, 'start' => '08:00', 'end' => '09:30', 'subject' => 'Базы данных', 'type' => 'лекция', 'room' => '7-305', 'teacher' => 'Зайцев К.В.'],
            ['day' => 2, 'week' => 1, 'start' => '09:45', 'end' => '11:15', 'subject' => 'Базы данных', 'type' => 'лабораторная', 'room' => '7-416', 'teacher' => 'Зайцев К.В.'],
            ['day' => 2, 'week' => 2, 'start' => '09:45', 'end' => '11:15', 'subject' => 'Компьютерные сети', 'type' => 'практика', 'room' => '7-418', 'teacher' => '']
        ];
        sendJson(200, scheduleFile($group, $example), ['Content-Disposition' => 'attachment; filename="uniplan-template.json"']);
    }
    
    if ($method === 'GET' && $path === '/api/schedule/export') {
        $user = requireUser();
        $group = getGroup($db, $user['group_id']);
        $filename = "uniplan-" . rawurlencode($group['name']) . ".json";
        sendJson(200, scheduleFile($group, groupLessons($db, $group['id'])), ['Content-Disposition' => "attachment; filename=\"$filename\""]);
    }
    
    // ---------- US-03: TODO-лист дня ----------
    
    if ($method === 'GET' && $path === '/api/tasks') {
        $user = requireUser();
        if ($user['role'] === 'student' && empty($user['approved'])) {
            sendJson(200, ['tasks' => [], 'pendingApproval' => true]);
        }
        $scope = isset($_GET['scope']) ? $_GET['scope'] : null;
        if ($scope === 'personal') {
            $scopeWhere = '(t.user_id = ? AND t.group_id IS NULL)';
            $scopeArgs = [(int)$user['id']];
        } else if ($scope === 'group') {
            $scopeWhere = '(t.group_id = ?)';
            $scopeArgs = [(int)$user['group_id']];
        } else {
            $scopeWhere = '((t.user_id = ? AND t.group_id IS NULL) OR t.group_id = ?)';
            $scopeArgs = [(int)$user['id'], (int)$user['group_id']];
        }
        $where = [$scopeWhere];
        $filterArgs = [];
        
        $filters = [['date', 't.date = ?'], ['from', 't.date >= ?'], ['to', 't.date <= ?']];
        foreach ($filters as $f) {
            $param = $f[0];
            $sql = $f[1];
            if (isset($_GET[$param]) && $_GET[$param] !== '') {
                $v = $_GET[$param];
                if (!isValidISODate($v)) sendError(400, "Параметр $param в формате ГГГГ-ММ-ДД");
                $where[] = $sql;
                $filterArgs[] = $v;
            }
        }
        
        $sql = "
            SELECT
                t.id, t.user_id, t.group_id, t.date, t.text, t.subject,
                CASE
                    WHEN t.group_id IS NOT NULL THEN COALESCE(tc.done, 0)
                    ELSE t.done
                END AS done,
                t.created_at
            FROM tasks t
            LEFT JOIN task_completions tc ON tc.task_id = t.id AND tc.user_id = ?
            WHERE " . implode(' AND ', $where) . "
            ORDER BY t.date, done, t.id
        ";
        $args = array_merge([(int)$user['id']], $scopeArgs, $filterArgs);
        $stmt = $db->prepare($sql);
        $stmt->execute($args);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $tasks = array_map(function($t) use ($user) {
            return publicTask($t, $user);
        }, $rows);
        sendJson(200, ['tasks' => $tasks]);
    }
    
    if ($method === 'POST' && $path === '/api/tasks') {
        $user = requireUser();
        if ($user['role'] === 'student' && empty($user['approved'])) {
            sendError(403, 'Заявка на вступление в группу ожидает подтверждения старосты');
        }
        $body = readJsonBody();
        $text = cleanText(isset($body['text']) ? $body['text'] : '', 201);
        
        $details = [];
        if (!isset($body['date']) || !isValidISODate($body['date'])) $details[] = ['path' => 'date', 'message' => 'Дата в формате ГГГГ-ММ-ДД'];
        if (!$text) $details[] = ['path' => 'text', 'message' => 'Напишите, что нужно сделать'];
        elseif (mb_strlen($text, 'UTF-8') > 200) $details[] = ['path' => 'text', 'message' => 'Не длиннее 200 символов'];
        
        if (!empty($details)) sendError(400, $details[0]['message'], $details);
        
        $isGroup = !empty($body['isGroup']);
        if ($isGroup && $user['role'] !== 'starosta') {
            sendError(403, 'Создавать общие дела группы может только староста');
        }
        $groupId = $isGroup ? (int)$user['group_id'] : null;
        $subject = cleanText(isset($body['subject']) ? $body['subject'] : '', 120);
        if ($subject === '') $subject = null;
        
        $stmt = $db->prepare('INSERT INTO tasks (user_id, group_id, date, text, subject) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([(int)$user['id'], $groupId, $body['date'], $text, $subject]);
        $id = (int)$db->lastInsertId();
        
        sendJson(201, ['task' => publicTask(accessibleTask($db, $user, $id), $user)]);
    }
    
    if ($method === 'PATCH' && preg_match('#^/api/tasks/(\d+)$#', $path, $matches)) {
        $user = requireUser();
        if ($user['role'] === 'student' && empty($user['approved'])) {
            sendError(403, 'Заявка на вступление в группу ожидает подтверждения старосты');
        }
        $id = (int)$matches[1];
        $task = accessibleTask($db, $user, $id);
        $body = readJsonBody();
        
        if (array_key_exists('done', $body)) {
            $doneVal = $body['done'] ? 1 : 0;
            if (!empty($task['group_id'])) {
                $stmt = $db->prepare('
                    INSERT INTO task_completions (task_id, user_id, done) VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE done = VALUES(done)
                ');
                $stmt->execute([(int)$task['id'], (int)$user['id'], $doneVal]);
            } else {
                $stmt = $db->prepare('UPDATE tasks SET done = ? WHERE id = ?');
                $stmt->execute([$doneVal, (int)$task['id']]);
            }
        }
        
        if (array_key_exists('text', $body)) {
            if (!empty($task['group_id']) && $user['role'] !== 'starosta') {
                sendError(403, 'Редактировать общее дело группы может только староста');
            }
            $text = cleanText($body['text'], 201);
            if (!$text || mb_strlen($text, 'UTF-8') > 200) sendError(400, 'Текст задачи: от 1 до 200 символов');
            $stmt = $db->prepare('UPDATE tasks SET text = ? WHERE id = ?');
            $stmt->execute([$text, (int)$task['id']]);
        }
        
        sendJson(200, ['task' => publicTask(accessibleTask($db, $user, $task['id']), $user)]);
    }
    
    if ($method === 'DELETE' && preg_match('#^/api/tasks/(\d+)$#', $path, $matches)) {
        $user = requireUser();
        if ($user['role'] === 'student' && empty($user['approved'])) {
            sendError(403, 'Заявка на вступление в группу ожидает подтверждения старосты');
        }
        $id = (int)$matches[1];
        $task = accessibleTask($db, $user, $id);
        if (!empty($task['group_id']) && $user['role'] !== 'starosta') {
            sendError(403, 'Удалить общее дело группы может только староста');
        }
        $stmt = $db->prepare('DELETE FROM tasks WHERE id = ?');
        $stmt->execute([(int)$task['id']]);
        sendJson(204);
    }
    
    // Если дошли сюда, значит метод/путь не найден
    sendError(404, 'Нет такого метода API');

} catch (Exception $e) {
    error_log($e->getMessage() . "\n" . $e->getTraceAsString());
    sendError(500, 'Внутренняя ошибка сервера');
}
