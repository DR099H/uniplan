<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/seed.php';

/**
 * Returns a singleton PDO connection and auto-initializes schema/seed if DB is empty.
 * @param bool $autoSeed
 * @return PDO
 */
function getDb($autoSeed = true) {
    static $db = null;
    static $seeded = false;
    if ($db === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        $db = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    if ($autoSeed && !$seeded) {
        $seeded = true;
        ensureDatabaseSeeded($db);
        try {
            $db->exec('ALTER TABLE tasks ADD COLUMN group_id INT DEFAULT NULL');
        } catch (Exception $e) {
            // column already exists
        }
        try {
            $db->exec('ALTER TABLE users ADD COLUMN approved TINYINT(1) NOT NULL DEFAULT 1');
        } catch (Exception $e) {
            // column already exists
        }
        try {
            $db->exec('ALTER TABLE groups ADD COLUMN course INT DEFAULT NULL');
        } catch (Exception $e) {
            // column already exists
        }
        try {
            $db->exec('ALTER TABLE groups ADD COLUMN semester INT DEFAULT NULL');
        } catch (Exception $e) {
            // column already exists
        }
        try {
            $db->exec('CREATE TABLE IF NOT EXISTS task_completions (
              task_id INT NOT NULL,
              user_id INT NOT NULL,
              done    TINYINT(1) NOT NULL DEFAULT 1,
              PRIMARY KEY (task_id, user_id),
              FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        } catch (Exception $e) {
            // table already exists
        }
    }
    return $db;
}

/**
 * Wraps a callable in a transaction.
 * @param callable $fn
 * @return mixed
 * @throws Exception
 */
function transaction(callable $fn) {
    $db = getDb();
    $db->beginTransaction();
    try {
        $result = $fn();
        $db->commit();
        return $result;
    } catch (Exception $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}
