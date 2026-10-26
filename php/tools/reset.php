<?php
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit("Run from CLI\n");
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../api/db.php';

$db = getDb(false);

try {
    $db->exec('SET FOREIGN_KEY_CHECKS = 0');
    
    $tables = ['tasks', 'lessons', 'sessions', 'users', 'groups'];
    foreach ($tables as $table) {
        $db->exec("DROP TABLE IF EXISTS `{$table}`");
    }
    
    $db->exec('SET FOREIGN_KEY_CHECKS = 1');
    
    ensureDatabaseSeeded($db);
    echo "Таблицы успешно пересозданы и заполнены тестовыми данными.\n";
} catch (PDOException $e) {
    echo "Ошибка базы данных: " . $e->getMessage() . "\n";
    exit(1);
}
