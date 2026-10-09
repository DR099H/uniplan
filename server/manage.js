// Администрирование из консоли (роль старосты в MVP назначается администратором, не через интерфейс).
//
//   npm run manage -- users [группа]            список пользователей
//   npm run manage -- role <логин> starosta     назначить старостой
//   npm run manage -- role <логин> student      снять роль старосты

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb } from './db.js';

export const ROLES = ['student', 'starosta'];

export function setRole(db, login, role) {
  if (!ROLES.includes(role)) throw new Error(`Роль должна быть одной из: ${ROLES.join(', ')}`);
  const user = db.prepare(`
    SELECT u.id, u.login, u.name, g.name AS groupName
    FROM users u JOIN groups g ON g.id = u.group_id
    WHERE u.login = ?`).get(login);
  if (!user) throw new Error(`Пользователь «${login}» не найден`);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  return { ...user, role };
}

export function listUsers(db, groupName) {
  const rows = db.prepare(`
    SELECT u.login, u.name, u.role, g.name AS groupName
    FROM users u JOIN groups g ON g.id = u.group_id
    ORDER BY g.name, u.role, u.name`).all();
  return groupName ? rows.filter((r) => r.groupName.toLowerCase() === groupName.toLowerCase()) : rows;
}

function main(args) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const db = openDb(process.env.DB_FILE || join(root, 'data', 'uniplan.db'));
  const [command, ...rest] = args;

  if (command === 'users') {
    const rows = listUsers(db, rest[0]);
    if (!rows.length) return console.log('Пользователей не найдено.');
    for (const r of rows) {
      console.log(`${r.groupName.padEnd(10)} ${r.login.padEnd(16)} ${(r.role === 'starosta' ? 'староста' : 'студент').padEnd(9)} ${r.name}`);
    }
    return;
  }

  if (command === 'role' && rest.length === 2) {
    const u = setRole(db, rest[0], rest[1]);
    const what = u.role === 'starosta' ? `назначен(а) старостой группы ${u.groupName}` : `теперь студент группы ${u.groupName}`;
    console.log(`${u.name} (@${u.login}) ${what}. Изменение действует сразу; пользователю достаточно обновить страницу.`);
    return;
  }

  console.log([
    'Использование:',
    '  npm run manage -- users [группа]',
    '  npm run manage -- role <логин> starosta|student',
  ].join('\n'));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`Ошибка: ${err.message}`);
    process.exitCode = 1;
  }
}
