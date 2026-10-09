// Точка входа: node server/server.js  (или npm start / start.bat)
// Переменные окружения: PORT (по умолчанию 3000), DB_FILE, DEMO=0 — отключить демо-вход.

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seed } from './seed.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.DB_FILE || join(root, 'data', 'uniplan.db');
const port = Number(process.env.PORT) || 3000;

if (process.argv.includes('--reset') || process.argv.includes('--reset-only')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true });
  console.log('База данных удалена, будет создана заново с тестовыми данными.');
}

const db = openDb(dbFile);
if (seed(db)) console.log('Загружены тестовые данные: группы, демо-аккаунты, расписание 25ИП3б.');
if (process.argv.includes('--reset-only')) process.exit(0);

const handler = createApp({
  db,
  clientDir: join(root, 'client'),
  sharedDir: join(root, 'shared'),
  demo: process.env.DEMO !== '0',
});

createServer(handler).listen(port, () => {
  console.log(`UniPlan запущен: http://localhost:${port}`);
});
