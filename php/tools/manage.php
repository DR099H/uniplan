<?php
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit("Run from CLI\n");
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../api/db.php';

$db = getDb();

if (!function_exists('mb_str_pad')) {
    function mb_str_pad($input, $pad_length, $pad_string = ' ', $pad_type = STR_PAD_RIGHT) {
        $diff = strlen($input) - mb_strlen($input, 'UTF-8');
        return str_pad($input, $pad_length + $diff, $pad_string, $pad_type);
    }
}

function listUsers($db, $groupName = null) {
    $sql = "SELECT u.login, u.name, u.role, g.name AS groupName
            FROM users u JOIN groups g ON g.id = u.group_id";
    $params = [];
    if ($groupName !== null) {
        $sql .= " WHERE LOWER(g.name) = LOWER(?)";
        $params[] = $groupName;
    }
    $sql .= " ORDER BY g.name, u.role, u.name";
    
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function setRole($db, $login, $role) {
    $roles = ['student', 'starosta'];
    if (!in_array($role, $roles, true)) {
        throw new Exception("Роль должна быть одной из: " . implode(', ', $roles));
    }
    
    $stmt = $db->prepare("SELECT u.id, u.login, u.name, g.name AS groupName
                          FROM users u JOIN groups g ON g.id = u.group_id
                          WHERE u.login = ?");
    $stmt->execute([$login]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$user) {
        throw new Exception("Пользователь «{$login}» не найден");
    }
    
    $updateStmt = $db->prepare("UPDATE users SET role = ? WHERE id = ?");
    $updateStmt->execute([$role, $user['id']]);
    
    $user['role'] = $role;
    return $user;
}

array_shift($argv); // remove script name
$command = array_shift($argv);

if ($command === 'users') {
    $groupName = array_shift($argv);
    try {
        $rows = listUsers($db, $groupName);
        if (empty($rows)) {
            echo "Пользователей не найдено.\n";
            exit(0);
        }
        foreach ($rows as $r) {
            $group = mb_str_pad($r['groupName'], 10);
            $login = mb_str_pad($r['login'], 16);
            $roleStr = mb_str_pad($r['role'] === 'starosta' ? 'староста' : 'студент', 9);
            echo "{$group} {$login} {$roleStr} {$r['name']}\n";
        }
    } catch (Exception $e) {
        echo "Ошибка: " . $e->getMessage() . "\n";
        exit(1);
    }
    exit(0);
}

if ($command === 'role' && count($argv) >= 2) {
    $login = array_shift($argv);
    $role = array_shift($argv);
    try {
        $u = setRole($db, $login, $role);
        $what = $u['role'] === 'starosta' ? "назначен(а) старостой группы {$u['groupName']}" : "теперь студент группы {$u['groupName']}";
        echo "{$u['name']} (@{$u['login']}) {$what}. Изменение действует сразу; пользователю достаточно обновить страницу.\n";
    } catch (Exception $e) {
        echo "Ошибка: " . $e->getMessage() . "\n";
        exit(1);
    }
    exit(0);
}

echo implode("\n", [
    'Использование:',
    '  php tools/manage.php users [группа]',
    '  php tools/manage.php role <логин> starosta|student'
]) . "\n";
exit(1);
