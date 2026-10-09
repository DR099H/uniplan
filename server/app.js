// HTTP-приложение UniPlan: REST API (/api/*) и раздача клиента.
// Без внешних зависимостей: node:http + node:sqlite.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import {
  SESSION_COOKIE, clearedCookie, createSession, destroySession, hashPassword,
  parseCookies, sessionCookie, userBySession, verifyPassword,
} from './auth.js';
import { transaction } from './db.js';
import { DAY_SHORT, LESSON_TYPES, describeLesson, lessonsOverlap, normalizeLesson, summarize, validateSchedule } from './validate.js';
import { computeCourseAndSemester, isValidISODate, mondayOf, todayISO, weekType } from '../shared/week.js';

const MAX_BODY = 1024 * 1024;
const LOGIN_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
  ].join('; '),
};

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function send(res, status, data, headers = {}) {
  if (status === 204) {
    res.writeHead(204, { ...SECURITY_HEADERS, ...headers });
    return res.end();
  }
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(body);
}

async function readJson(req) {
  if (req.method === 'GET' || req.method === 'DELETE') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос (максимум 1 МБ)');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Тело запроса — некорректный JSON');
  }
}

function compile(pattern) {
  const keys = [];
  const re = pattern.replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { re: new RegExp(`^${re}$`), keys };
}

// ---------- представление данных ----------

const publicUser = (u) => ({
  id: u.id,
  login: u.login,
  name: u.name,
  role: u.role,
  groupId: u.group_id,
  approved: Boolean(u.approved),
});
const publicGroup = (g, dateIso = todayISO()) => {
  if (!g) return null;
  const cs = computeCourseAndSemester(g.name, dateIso, g.course, g.semester);
  return {
    id: g.id,
    name: g.name,
    semesterStart: g.semester_start,
    course: cs.course,
    semester: cs.semester,
    explicitCourse: g.course ?? null,
    explicitSemester: g.semester ?? null,
  };
};
const publicLesson = (l) => ({
  id: l.id, day: l.day, week: l.week, start: l.start_time, end: l.end_time,
  subject: l.subject, type: l.type, room: l.room, teacher: l.teacher,
});
const publicTask = (t, user) => ({
  id: t.id,
  date: t.date,
  text: t.text,
  subject: t.subject,
  done: !!t.done,
  isGroup: Boolean(t.group_id),
  canDelete: t.group_id ? (user && user.role === 'starosta' && user.group_id === t.group_id) : (user ? user.id === t.user_id : true),
});

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

export function createApp({ db, clientDir, sharedDir, demo = true }) {
  const routes = [];
  const route = (method, pattern, auth, handler) => routes.push({ method, ...compile(pattern), auth, handler });

  const getGroup = (id) => db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  // группа вместе с именами старост — чтобы студент видел, кто ведёт расписание
  const groupPayload = (id) => ({
    ...publicGroup(getGroup(id)),
    starostas: db.prepare("SELECT name FROM users WHERE group_id = ? AND role = 'starosta' ORDER BY name").all(id).map((r) => r.name),
  });
  const groupLessons = (groupId) =>
    db.prepare('SELECT * FROM lessons WHERE group_id = ? ORDER BY day, start_time').all(groupId).map(publicLesson);
  const accessibleTask = (user, id) => {
    const task = db.prepare(`
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
    `).get(user.id, Number(id), user.id, user.group_id);
    if (!task) throw new HttpError(404, 'Задача не найдена');
    return task;
  };
  const ownLesson = (user, id) => {
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ? AND group_id = ?').get(Number(id), user.group_id);
    if (!lesson) throw new HttpError(404, 'Пара не найдена в расписании вашей группы');
    return lesson;
  };
  const login = (res, status, user) => {
    const token = createSession(db, user.id);
    send(res, status, { user: publicUser(user), group: groupPayload(user.group_id) }, { 'Set-Cookie': sessionCookie(token) });
  };

  // ---------- справочники ----------

  route('GET', '/api/groups', null, ({ res }) => {
    send(res, 200, { groups: db.prepare('SELECT id, name FROM groups ORDER BY name').all() });
  });

  route('GET', '/api/meta', null, ({ res }) => {
    send(res, 200, { demo, lessonTypes: LESSON_TYPES });
  });

  // ---------- US-01: регистрация, вход, профиль ----------

  route('POST', '/api/auth/register', null, ({ res, body }) => {
    const name = cleanText(body.name, 60);
    const loginName = typeof body.login === 'string' ? body.login.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const groupId = Number(body.groupId);
    const details = [];
    if (name.length < 2) details.push({ path: 'name', message: 'Введите имя (от 2 символов)' });
    if (!LOGIN_RE.test(loginName)) details.push({ path: 'login', message: 'Логин: 3–32 символа, латиница, цифры, точка, _ или -' });
    if (password.length < 6) details.push({ path: 'password', message: 'Пароль должен быть не короче 6 символов' });
    if (password.length > 128) details.push({ path: 'password', message: 'Пароль слишком длинный' });
    if (!getGroup(groupId)) details.push({ path: 'groupId', message: 'Выберите группу из списка' });
    if (details.length) throw new HttpError(400, 'Проверьте поля формы', details);
    if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(loginName)) {
      throw new HttpError(409, 'Этот логин уже занят', [{ path: 'login', message: 'Этот логин уже занят' }]);
    }
    const id = Number(db.prepare('INSERT INTO users (login, name, password_hash, group_id, approved) VALUES (?, ?, ?, ?, 0)')
      .run(loginName, name, hashPassword(password), groupId).lastInsertRowid);
    login(res, 201, db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  });

  route('POST', '/api/auth/login', null, ({ res, body }) => {
    const user = typeof body.login === 'string' && db.prepare('SELECT * FROM users WHERE login = ?').get(body.login.trim());
    if (!user || typeof body.password !== 'string' || !verifyPassword(body.password, user.password_hash)) {
      throw new HttpError(401, 'Неверный логин или пароль');
    }
    login(res, 200, user);
  });

  route('POST', '/api/auth/demo', null, ({ res, body }) => {
    if (!demo) throw new HttpError(404, 'Демо-вход отключён');
    const loginName = body.as === 'starosta' ? 'starosta' : 'student';
    const user = db.prepare('SELECT * FROM users WHERE login = ?').get(loginName);
    if (!user) throw new HttpError(404, 'Демо-аккаунт не найден');
    login(res, 200, user);
  });

  route('POST', '/api/auth/logout', null, ({ res, token }) => {
    destroySession(db, token);
    send(res, 204, null, { 'Set-Cookie': clearedCookie() });
  });

  route('GET', '/api/me', 'user', ({ res, user }) => {
    send(res, 200, { user: publicUser(user), group: groupPayload(user.group_id) });
  });

  route('PATCH', '/api/me', 'user', ({ res, user, body }) => {
    if (body.name !== undefined) {
      const name = cleanText(body.name, 60);
      if (name.length < 2) throw new HttpError(400, 'Введите имя (от 2 символов)', [{ path: 'name', message: 'Введите имя (от 2 символов)' }]);
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    }
    if (body.groupId !== undefined && Number(body.groupId) !== user.group_id) {
      if (user.role === 'starosta') throw new HttpError(403, 'Староста не может сменить группу — обратитесь к администратору');
      if (!getGroup(Number(body.groupId))) throw new HttpError(400, 'Такой группы нет');
      db.prepare('UPDATE users SET group_id = ?, approved = 0 WHERE id = ?').run(Number(body.groupId), user.id);
    }
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    send(res, 200, { user: publicUser(fresh), group: groupPayload(fresh.group_id) });
  });

  // ---------- US-02: расписание и тип недели ----------

  route('GET', '/api/schedule', 'user', ({ res, user, query }) => {
    const groupId = query.has('groupId') ? Number(query.get('groupId')) : user.group_id;
    const group = getGroup(groupId);
    if (!group) throw new HttpError(404, 'Группа не найдена');
    let lessons = groupLessons(groupId);
    if (query.has('week')) {
      const week = Number(query.get('week'));
      if (week !== 1 && week !== 2) throw new HttpError(400, 'Параметр week: 1 или 2');
      lessons = lessons.filter((l) => l.week === 0 || l.week === week);
    }
    if (query.has('day')) {
      const day = Number(query.get('day'));
      if (!(day >= 1 && day <= 7)) throw new HttpError(400, 'Параметр day: 1–7');
      lessons = lessons.filter((l) => l.day === day);
    }
    send(res, 200, { group: publicGroup(group), lessons });
  });

  route('GET', '/api/week-type', 'user', ({ res, user, query }) => {
    const date = query.get('date') || todayISO();
    if (!isValidISODate(date)) throw new HttpError(400, 'Параметр date в формате ГГГГ-ММ-ДД');
    const group = getGroup(user.group_id);
    send(res, 200, { date, monday: mondayOf(date), week: weekType(date, group.semester_start), semesterStart: group.semester_start });
  });

  // ---------- US-04: ручной ввод (только староста) ----------

  const checkLesson = (user, raw, exceptId = null) => {
    const { lesson, errors } = normalizeLesson(raw);
    if (!lesson) throw new HttpError(400, 'Проверьте поля пары', errors);
    const clash = groupLessons(user.group_id).find((l) => l.id !== exceptId && lessonsOverlap(l, lesson));
    if (clash) throw new HttpError(409, `Пересекается с парой: ${describeLesson(clash)}`, [{ path: 'start', message: 'Время занято другой парой' }]);
    return lesson;
  };

  route('POST', '/api/lessons', 'starosta', ({ res, user, body }) => {
    const l = checkLesson(user, body);
    const id = Number(db.prepare(`INSERT INTO lessons (group_id, day, week, start_time, end_time, subject, type, room, teacher)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.group_id, l.day, l.week, l.start, l.end, l.subject, l.type, l.room, l.teacher).lastInsertRowid);
    send(res, 201, { lesson: publicLesson(db.prepare('SELECT * FROM lessons WHERE id = ?').get(id)) });
  });

  route('PUT', '/api/lessons/:id', 'starosta', ({ res, user, body, params }) => {
    const current = ownLesson(user, params.id);
    const l = checkLesson(user, body, current.id);
    db.prepare(`UPDATE lessons SET day = ?, week = ?, start_time = ?, end_time = ?, subject = ?, type = ?, room = ?, teacher = ?
      WHERE id = ?`).run(l.day, l.week, l.start, l.end, l.subject, l.type, l.room, l.teacher, current.id);
    send(res, 200, { lesson: publicLesson(db.prepare('SELECT * FROM lessons WHERE id = ?').get(current.id)) });
  });

  route('DELETE', '/api/lessons/:id', 'starosta', ({ res, user, params }) => {
    const current = ownLesson(user, params.id);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(current.id);
    send(res, 204);
  });

  route('PATCH', '/api/group', 'starosta', ({ res, user, body }) => {
    if (body.semesterStart !== undefined) {
      if (!isValidISODate(body.semesterStart)) {
        throw new HttpError(400, 'Дата начала семестра в формате ГГГГ-ММ-ДД', [{ path: 'semesterStart', message: 'Укажите дату' }]);
      }
      db.prepare('UPDATE groups SET semester_start = ? WHERE id = ?').run(body.semesterStart, user.group_id);
    }
    if (body.course !== undefined) {
      const c = body.course === null || body.course === '' ? null : Number(body.course);
      db.prepare('UPDATE groups SET course = ? WHERE id = ?').run(c, user.group_id);
    }
    if (body.semester !== undefined) {
      const s = body.semester === null || body.semester === '' ? null : Number(body.semester);
      db.prepare('UPDATE groups SET semester = ? WHERE id = ?').run(s, user.group_id);
    }
    send(res, 200, { group: publicGroup(getGroup(user.group_id)) });
  });

  // ---------- управление участниками группы (только староста) ----------

  route('GET', '/api/group/members', 'starosta', ({ res, user }) => {
    const members = db.prepare(`
      SELECT id, login, name, role, approved, created_at
      FROM users
      WHERE group_id = ?
      ORDER BY role DESC, approved ASC, name ASC
    `).all(user.group_id).map((u) => ({
      id: u.id,
      login: u.login,
      name: u.name,
      role: u.role,
      approved: Boolean(u.approved),
      createdAt: u.created_at,
    }));
    send(res, 200, { members });
  });

  route('POST', '/api/group/members/:id/approve', 'starosta', ({ res, user, params }) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ? AND group_id = ?').get(Number(params.id), user.group_id);
    if (!target) throw new HttpError(404, 'Студент не найден в вашей группе');
    db.prepare('UPDATE users SET approved = 1 WHERE id = ?').run(target.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
    send(res, 200, { member: publicUser(updated) });
  });

  route('DELETE', '/api/group/members/:id', 'starosta', ({ res, user, params }) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ? AND group_id = ?').get(Number(params.id), user.group_id);
    if (!target) throw new HttpError(404, 'Студент не найден в вашей группе');
    if (target.role === 'starosta') throw new HttpError(403, 'Нельзя удалить старосту группы');
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    send(res, 204);
  });

  // ---------- US-05: импорт / экспорт JSON ----------

  route('POST', '/api/schedule/import', 'starosta', ({ res, user, body }) => {
    const mode = body.mode === 'append' ? 'append' : 'replace';
    const group = getGroup(user.group_id);
    const existing = mode === 'append' ? groupLessons(user.group_id) : [];
    const result = validateSchedule(body.data, { groupName: group.name, existing });
    if (!result.ok) throw new HttpError(422, 'Файл не прошёл проверку', result.errors);
    const summary = summarize(result.lessons);
    if (body.dryRun) return send(res, 200, { dryRun: true, mode, summary, lessons: result.lessons, semesterStart: result.semesterStart });

    transaction(db, () => {
      if (mode === 'replace') db.prepare('DELETE FROM lessons WHERE group_id = ?').run(user.group_id);
      const ins = db.prepare(`INSERT INTO lessons (group_id, day, week, start_time, end_time, subject, type, room, teacher)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const l of result.lessons) ins.run(user.group_id, l.day, l.week, l.start, l.end, l.subject, l.type, l.room, l.teacher);
      if (result.semesterStart) db.prepare('UPDATE groups SET semester_start = ? WHERE id = ?').run(result.semesterStart, user.group_id);
    });
    send(res, 200, { imported: result.lessons.length, mode, summary, group: publicGroup(getGroup(user.group_id)) });
  });

  const scheduleFile = (group, lessons) => ({
    group: group.name,
    semesterStart: group.semester_start,
    lessons: lessons.map((l) => ({
      day: DAY_SHORT[l.day], week: l.week === 0 ? 'обе' : l.week, start: l.start, end: l.end,
      subject: l.subject, type: l.type, room: l.room, teacher: l.teacher,
    })),
  });

  route('GET', '/api/schedule/template', 'user', ({ res, user }) => {
    const group = getGroup(user.group_id);
    const example = [
      { day: 1, week: 0, start: '08:00', end: '09:30', subject: 'Базы данных', type: 'лекция', room: '7-305', teacher: 'Зайцев К.В.' },
      { day: 2, week: 1, start: '09:45', end: '11:15', subject: 'Базы данных', type: 'лабораторная', room: '7-416', teacher: 'Зайцев К.В.' },
      { day: 2, week: 2, start: '09:45', end: '11:15', subject: 'Компьютерные сети', type: 'практика', room: '7-418', teacher: '' },
    ];
    send(res, 200, scheduleFile(group, example), { 'Content-Disposition': 'attachment; filename="uniplan-template.json"' });
  });

  route('GET', '/api/schedule/export', 'user', ({ res, user }) => {
    const group = getGroup(user.group_id);
    send(res, 200, scheduleFile(group, groupLessons(group.id)), {
      'Content-Disposition': `attachment; filename="uniplan-${encodeURIComponent(group.name)}.json"`,
    });
  });

  // ---------- US-03: TODO-лист дня ----------

  route('GET', '/api/tasks', 'user', ({ res, user, query }) => {
    if (user.role === 'student' && !user.approved) {
      return send(res, 200, { tasks: [], pendingApproval: true });
    }

    let scopeWhere = '((t.user_id = ? AND t.group_id IS NULL) OR t.group_id = ?)';
    let scopeArgs = [user.id, user.group_id];
    if (query.get('scope') === 'personal') {
      scopeWhere = '(t.user_id = ? AND t.group_id IS NULL)';
      scopeArgs = [user.id];
    } else if (query.get('scope') === 'group') {
      scopeWhere = '(t.group_id = ?)';
      scopeArgs = [user.group_id];
    }

    const where = [scopeWhere];
    const args = [...scopeArgs];
    for (const [param, sql] of [['date', 't.date = ?'], ['from', 't.date >= ?'], ['to', 't.date <= ?']]) {
      if (!query.has(param)) continue;
      const v = query.get(param);
      if (!isValidISODate(v)) throw new HttpError(400, `Параметр ${param} в формате ГГГГ-ММ-ДД`);
      where.push(sql);
      args.push(v);
    }
    const rows = db.prepare(`
      SELECT
        t.id, t.user_id, t.group_id, t.date, t.text, t.subject,
        CASE
          WHEN t.group_id IS NOT NULL THEN COALESCE(tc.done, 0)
          ELSE t.done
        END AS done,
        t.created_at
      FROM tasks t
      LEFT JOIN task_completions tc ON tc.task_id = t.id AND tc.user_id = ?
      WHERE ${where.join(' AND ')}
      ORDER BY t.date, done, t.id
    `).all(user.id, ...args);
    send(res, 200, { tasks: rows.map((t) => publicTask(t, user)) });
  });

  route('POST', '/api/tasks', 'user', ({ res, user, body }) => {
    if (user.role === 'student' && !user.approved) {
      throw new HttpError(403, 'Заявка на вступление в группу ожидает подтверждения старосты');
    }

    const text = cleanText(body.text, 201);
    const details = [];
    if (!isValidISODate(body.date)) details.push({ path: 'date', message: 'Дата в формате ГГГГ-ММ-ДД' });
    if (!text) details.push({ path: 'text', message: 'Напишите, что нужно сделать' });
    if (text.length > 200) details.push({ path: 'text', message: 'Не длиннее 200 символов' });
    if (details.length) throw new HttpError(400, details[0].message, details);

    const isGroup = Boolean(body.isGroup);
    if (isGroup && user.role !== 'starosta') {
      throw new HttpError(403, 'Создавать общие дела группы может только староста');
    }
    const groupId = isGroup ? user.group_id : null;
    const subject = cleanText(body.subject, 120) || null;
    const id = Number(db.prepare('INSERT INTO tasks (user_id, group_id, date, text, subject) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, groupId, body.date, text, subject).lastInsertRowid);
    send(res, 201, { task: publicTask(accessibleTask(user, id), user) });
  });

  route('PATCH', '/api/tasks/:id', 'user', ({ res, user, body, params }) => {
    if (user.role === 'student' && !user.approved) {
      throw new HttpError(403, 'Заявка на вступление в группу ожидает подтверждения старосты');
    }

    const task = accessibleTask(user, params.id);
    if (body.done !== undefined) {
      if (task.group_id) {
        db.prepare(`
          INSERT INTO task_completions (task_id, user_id, done) VALUES (?, ?, ?)
          ON CONFLICT(task_id, user_id) DO UPDATE SET done = excluded.done
        `).run(task.id, user.id, body.done ? 1 : 0);
      } else {
        db.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(body.done ? 1 : 0, task.id);
      }
    }
    if (body.text !== undefined) {
      if (task.group_id && user.role !== 'starosta') {
        throw new HttpError(403, 'Редактировать общее дело группы может только староста');
      }
      const text = cleanText(body.text, 201);
      if (!text || text.length > 200) throw new HttpError(400, 'Текст задачи: от 1 до 200 символов');
      db.prepare('UPDATE tasks SET text = ? WHERE id = ?').run(text, task.id);
    }
    send(res, 200, { task: publicTask(accessibleTask(user, task.id), user) });
  });

  route('DELETE', '/api/tasks/:id', 'user', ({ res, user, params }) => {
    if (user.role === 'student' && !user.approved) {
      throw new HttpError(403, 'Заявка на вступление в группу ожидает подтверждения старосты');
    }

    const task = accessibleTask(user, params.id);
    if (task.group_id && user.role !== 'starosta') {
      throw new HttpError(403, 'Удалить общее дело группы может только староста');
    }
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    send(res, 204);
  });

  // ---------- статика ----------

  async function serveStatic(req, res, pathname) {
    let base = clientDir;
    let rel = pathname;
    if (pathname.startsWith('/shared/')) {
      base = sharedDir;
      rel = pathname.slice('/shared'.length);
    }
    const cleanRel = rel.endsWith('/') && rel.length > 1 ? rel.slice(0, -1) : rel;
    if (cleanRel === '/apple-touch-icon' || cleanRel === '/apple-touch-icon-precomposed') {
      rel = cleanRel + '.png';
    }
    let file = normalize(join(base, decodeURIComponent(rel)));
    if (!file.startsWith(normalize(base + sep)) && file !== normalize(base)) return send(res, 403, { error: 'Запрещено' });
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      // Неизвестный путь без расширения — это маршрут SPA, отдаём index.html
      if (extname(file)) return send(res, 404, { error: 'Файл не найден' });
      file = join(clientDir, 'index.html');
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': extname(file) === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=2592000, stale-while-revalidate=86400',
        ...SECURITY_HEADERS,
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      send(res, 404, { error: 'Файл не найден' });
    }
  }

  // ---------- диспетчер ----------

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
        return await serveStatic(req, res, pathname);
      }

      let match = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) };
        break;
      }
      if (!match) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Метод не поддерживается' : 'Нет такого метода API');

      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = userBySession(db, token);
      if (match.r.auth && !user) throw new HttpError(401, 'Нужно войти в систему');
      if (match.r.auth === 'starosta' && user.role !== 'starosta') throw new HttpError(403, 'Действие доступно только старосте группы');

      const body = await readJson(req);
      if (body === null || typeof body !== 'object') throw new HttpError(400, 'Ожидается JSON-объект');
      await match.r.handler({ req, res, body, params: match.params, query: url.searchParams, user, token });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) });
      console.error(err);
      send(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  };
}
