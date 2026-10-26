<?php
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit("Run from CLI\n");
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../api/db.php';

$db = getDb(false);

if (ensureDatabaseSeeded($db)) {
    echo "Данные успешно добавлены.\n";
} else {
    echo "База уже содержит данные. Для сброса используйте php tools/reset.php.\n";
}
