import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  semester_start TEXT NOT NULL,
  course         INTEGER,
  semester       INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  group_id      INTEGER NOT NULL REFERENCES groups(id),
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'starosta')),
  approved      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- week: 0 — каждую неделю, 1 — только 1-я, 2 — только 2-я
CREATE TABLE IF NOT EXISTS lessons (
  id         INTEGER PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
  week       INTEGER NOT NULL CHECK (week IN (0, 1, 2)),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  type       TEXT NOT NULL,
  room       TEXT NOT NULL,
  teacher    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS lessons_group_day ON lessons (group_id, day);

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  text       TEXT NOT NULL,
  subject    TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tasks_user_date ON tasks (user_id, date);
CREATE INDEX IF NOT EXISTS tasks_group_date ON tasks (group_id, date);

CREATE TABLE IF NOT EXISTS task_completions (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (task_id, user_id)
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE;');
  } catch {
    /* колонка уже есть */
  }
  try {
    db.exec('ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;');
  } catch {
    /* колонка уже есть */
  }
  try {
    db.exec('ALTER TABLE groups ADD COLUMN course INTEGER;');
  } catch {
    /* колонка уже есть */
  }
  try {
    db.exec('ALTER TABLE groups ADD COLUMN semester INTEGER;');
  } catch {
    /* колонка уже есть */
  }
  return db;
}

/** Выполняет fn в транзакции; при исключении откатывает изменения. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
