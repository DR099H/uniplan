<?php
if (!defined('UNIPLAN_APP') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit;
}

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'uniplan');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') !== false ? getenv('DB_PASS') : '');
define('DB_CHARSET', getenv('DB_CHARSET') ?: 'utf8mb4');
define('DEMO_ENABLED', getenv('DEMO_ENABLED') !== false ? filter_var(getenv('DEMO_ENABLED'), FILTER_VALIDATE_BOOLEAN) : true);
define('SESSION_TTL', getenv('SESSION_TTL') ?: 30 * 24 * 60 * 60);
