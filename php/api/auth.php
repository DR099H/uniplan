<?php
require_once __DIR__ . '/../config.php';

const SESSION_COOKIE = 'uniplan_sid';

function hashPassword($password) {
    return password_hash((string)$password, PASSWORD_BCRYPT);
}

function verifyPassword($password, $hash) {
    $password = (string)$password;
    $hash = (string)$hash;
    if (strpos($hash, 'sha256:') === 0) {
        return hash_equals(substr($hash, 7), hash('sha256', $password));
    }
    return password_verify($password, $hash);
}

function generateRandomToken($bytes = 32) {
    if (function_exists('random_bytes')) {
        return bin2hex(random_bytes($bytes));
    }
    return bin2hex(openssl_random_pseudo_bytes($bytes));
}

function createSession(PDO $db, $userId) {
    $token = generateRandomToken(32);
    $expiresAt = time() + SESSION_TTL;
    $stmt = $db->prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
    $stmt->execute([$token, (int)$userId, $expiresAt]);
    return $token;
}

function destroySession(PDO $db, $token) {
    if ($token) {
        $stmt = $db->prepare('DELETE FROM sessions WHERE token = ?');
        $stmt->execute([$token]);
    }
}

function userBySession(PDO $db, $token) {
    if (!$token) return null;
    $stmt = $db->prepare('
        SELECT u.id, u.login, u.name, u.role, u.group_id, u.approved, s.expires_at 
        FROM sessions s 
        JOIN users u ON u.id = s.user_id 
        WHERE s.token = ?
    ');
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    
    if (!$row) return null;
    
    if ((int)$row['expires_at'] < time()) {
        destroySession($db, $token);
        return null;
    }
    
    return $row;
}

function getSessionToken() {
    return isset($_COOKIE[SESSION_COOKIE]) ? $_COOKIE[SESSION_COOKIE] : null;
}

function setSessionCookie($token) {
    header('Set-Cookie: ' . SESSION_COOKIE . '=' . $token
        . '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' . SESSION_TTL, false);
}

function clearSessionCookie() {
    header('Set-Cookie: ' . SESSION_COOKIE . '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0', false);
}
