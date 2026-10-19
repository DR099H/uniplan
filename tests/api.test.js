// Сквозные проверки REST API по сценариям US-01 – US-05 (на базе в памяти).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { DEMO_PASSWORD, seed } from '../server/seed.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
let server;
let db;
let base;

before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createServer(createApp({ db, clientDir: join(root, 'client'), sharedDir: join(root, 'shared'), demo: true }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

/** Мини-клиент с cookie-сессией. */
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };
}

async function groupId(name) {
  const { data } = await client()('GET', '/api/groups');
  return data.groups.find((g) => g.name === name).id;
}

test('US-01: регистрация с группой, вход, профиль', async () => {
  const api = client();
  const reg = await api('POST', '/api/auth/register', { name: 'Тест Тестов', login: 'tester', password: 'secret1', groupId: await groupId('25ИП3б') });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.group.name, '25ИП3б');
  assert.equal(reg.data.user.approved, false);

  // Староста одобряет нового студента
  const starosta = client();
  await starosta('POST', '/api/auth/login', { login: 'starosta', password: DEMO_PASSWORD });
  const { data: members } = await starosta('GET', '/api/group/members');
  const target = members.members.find((m) => m.login === 'tester');
  assert.ok(target);
  await starosta('POST', `/api/group/members/${target.id}/approve`);

  const me = await api('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.login, 'tester');
  assert.equal(me.data.user.approved, true);

  const again = await client()('POST', '/api/auth/login', { login: 'tester', password: 'secret1' });
  assert.equal(again.status, 200);
});

test('US-01: неверный пароль и занятый логин дают понятные ошибки', async () => {
  const api = client();
  const bad = await api('POST', '/api/auth/login', { login: 'student', password: 'wrong-pass' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, 'Неверный логин или пароль');

  const dup = await api('POST', '/api/auth/register', { name: 'Ещё один', login: 'student', password: 'secret1', groupId: await groupId('25ИП3б') });
  assert.equal(dup.status, 409);

  const invalid = await api('POST', '/api/auth/register', { name: '', login: 'ы', password: '1', groupId: 999 });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.data.details.map((d) => d.path).sort(), ['groupId', 'login', 'name', 'password']);
});

test('без входа API недоступен', async () => {
  const res = await client()('GET', '/api/schedule');
  assert.equal(res.status, 401);
});

test('US-02: расписание группы фильтруется по дню и неделе', async () => {
  const api = client();
  await api('POST', '/api/auth/login', { login: 'student', password: DEMO_PASSWORD });
  const w1 = await api('GET', '/api/schedule?day=3&week=1');
  const w2 = await api('GET', '/api/schedule?day=3&week=2');
  assert.equal(w1.status, 200);
  assert.deepEqual(w1.data.lessons.map((l) => l.start), ['08:00', '09:45', '15:25']);
  assert.deepEqual(w2.data.lessons.map((l) => l.start), ['08:00', '09:45', '11:30', '15:25']);
  assert.ok(w2.data.lessons.every((l) => l.day === 3 && (l.week === 0 || l.week === 2)));

  const wt = await api('GET', '/api/week-type?date=2026-10-07');
  assert.deepEqual(wt.data, { date: '2026-10-07', monday: '2026-10-05', week: 2, semesterStart: '2026-09-01' });
});

test('US-02: студент другой группы видит своё расписание', async () => {
  const api = client();
  await api('POST', '/api/auth/register', { name: 'Первокурсник', login: 'fresh', password: 'secret1', groupId: await groupId('25ИП1б') });
  const res = await api('GET', '/api/schedule');
  assert.equal(res.data.group.name, '25ИП1б');
  assert.ok(res.data.lessons.some((l) => l.subject === 'Математический анализ'));
  assert.ok(!res.data.lessons.some((l) => l.subject === 'Базы данных'));
});

test('US-03: задачи дня — добавить, отметить, удалить', async () => {
  const api = client();
  const regRes = await api('POST', '/api/auth/register', { name: 'Задачник', login: 'todo.user', password: 'secret1', groupId: await groupId('25ИП3б') });
  assert.equal(regRes.data.user.approved, false);

  // Неодобренный студент не может работать с делами
  const pendingTasks = await api('GET', '/api/tasks?date=2026-10-08');
  assert.equal(pendingTasks.status, 200);
  assert.equal(pendingTasks.data.pendingApproval, true);

  const blockedAdd = await api('POST', '/api/tasks', { date: '2026-10-08', text: 'Попытка без одобрения' });
  assert.equal(blockedAdd.status, 403);

  // Староста одобряет нового студента
  const starosta = client();
  await starosta('POST', '/api/auth/login', { login: 'starosta', password: DEMO_PASSWORD });
  const { data: membersData } = await starosta('GET', '/api/group/members');
  const target = membersData.members.find((m) => m.login === 'todo.user');
  assert.ok(target, 'Студент найден в заявках');
  assert.equal(target.approved, false);
  const approveRes = await starosta('POST', `/api/group/members/${target.id}/approve`);
  assert.equal(approveRes.status, 200);

  // Теперь одобренный студент успешно добавляет задачу
  const add = await api('POST', '/api/tasks', { date: '2026-10-08', text: 'Сдать лабу №3', subject: 'Базы данных' });
  assert.equal(add.status, 201);
  const id = add.data.task.id;

  const day = await api('GET', '/api/tasks?date=2026-10-08');
  assert.equal(day.data.tasks.length, 1);

  const done = await api('PATCH', `/api/tasks/${id}`, { done: true });
  assert.equal(done.data.task.done, true);

  const edited = await api('PATCH', `/api/tasks/${id}`, { text: 'Сдать лабу №3 (исправлено)' });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.task.text, 'Сдать лабу №3 (исправлено)');

  const empty = await api('POST', '/api/tasks', { date: '2026-10-08', text: '   ' });
  assert.equal(empty.status, 400);

  assert.equal((await api('DELETE', `/api/tasks/${id}`)).status, 204);
  assert.equal((await api('GET', '/api/tasks?date=2026-10-08')).data.tasks.length, 0);
});

test('US-03: чужую задачу нельзя изменить или удалить', async () => {
  const owner = client();
  await owner('POST', '/api/auth/login', { login: 'student', password: DEMO_PASSWORD });
  const { data } = await owner('POST', '/api/tasks', { date: '2026-10-09', text: 'Личное' });

  const stranger = client();
  await stranger('POST', '/api/auth/login', { login: 'tester', password: 'secret1' });
  assert.equal((await stranger('PATCH', `/api/tasks/${data.task.id}`, { done: true })).status, 404);
  assert.equal((await stranger('DELETE', `/api/tasks/${data.task.id}`)).status, 404);
});

test('US-03: староста создаёт общее дело для группы, студенты отмечают у себя, удаление только старостой', async () => {
  const starosta = client();
  await starosta('POST', '/api/auth/login', { login: 'starosta', password: DEMO_PASSWORD });

  // Староста создаёт общее дело группы
  const createRes = await starosta('POST', '/api/tasks', { date: '2026-10-15', text: 'Принести отчёты по лабе', isGroup: true });
  assert.equal(createRes.status, 201);
  const taskId = createRes.data.task.id;
  assert.equal(createRes.data.task.isGroup, true);
  assert.equal(createRes.data.task.canDelete, true);

  // Обычный студент этой же группы видит задачу
  const student = client();
  await student('POST', '/api/auth/login', { login: 'student', password: DEMO_PASSWORD });
  const studentTasks = await student('GET', '/api/tasks?date=2026-10-15');
  const found = studentTasks.data.tasks.find((t) => t.id === taskId);
  assert.ok(found, 'Студент должен видеть общее дело группы');
  assert.equal(found.isGroup, true);
  assert.equal(found.canDelete, false);
  assert.equal(found.done, false);

  // Студент другой группы НЕ видит это общее дело
  const stranger = client();
  await stranger('POST', '/api/auth/login', { login: 'fresh', password: 'secret1' });
  const strangerTasks = await stranger('GET', '/api/tasks?date=2026-10-15');
  assert.ok(!strangerTasks.data.tasks.some((t) => t.id === taskId));

  // Обычный студент не может создать общее дело
  const forbiddenCreate = await student('POST', '/api/tasks', { date: '2026-10-15', text: 'Попытка студента', isGroup: true });
  assert.equal(forbiddenCreate.status, 403);

  // Обычный студент отмечает выполнение у себя
  const toggleRes = await student('PATCH', `/api/tasks/${taskId}`, { done: true });
  assert.equal(toggleRes.status, 200);
  assert.equal(toggleRes.data.task.done, true);

  // Для старосты задача всё ещё не выполнена (у каждого студента своя отметка)
  const starostaCheck = await starosta('GET', '/api/tasks?date=2026-10-15');
  const starostaTask = starostaCheck.data.tasks.find((t) => t.id === taskId);
  assert.equal(starostaTask.done, false);

  // Обычный студент не может удалить общее дело
  const studentDelete = await student('DELETE', `/api/tasks/${taskId}`);
  assert.equal(studentDelete.status, 403);

  // Староста может удалить общее дело
  const starostaDelete = await starosta('DELETE', `/api/tasks/${taskId}`);
  assert.equal(starostaDelete.status, 204);

  // После удаления задачи больше нет
  const afterDelete = await student('GET', '/api/tasks?date=2026-10-15');
  assert.ok(!afterDelete.data.tasks.some((t) => t.id === taskId));
});

test('US-04: староста добавляет пару, пересечение отклоняется, студенту запрещено', async () => {
  const starosta = client();
  await starosta('POST', '/api/auth/login', { login: 'starosta', password: DEMO_PASSWORD });
  const lesson = { day: 6, week: 2, start: '08:00', end: '09:30', subject: 'Консультация', type: 'другое', room: '7-101' };

  const created = await starosta('POST', '/api/lessons', lesson);
  assert.equal(created.status, 201);
  const week2 = await starosta('GET', '/api/schedule?day=6&week=2');
  assert.ok(week2.data.lessons.some((l) => l.subject === 'Консультация'));

  const clash = await starosta('POST', '/api/lessons', { ...lesson, subject: 'Другая', week: 0 });
  assert.equal(clash.status, 409);

  const student = client();
  await student('POST', '/api/auth/login', { login: 'student', password: DEMO_PASSWORD });
  assert.equal((await student('POST', '/api/lessons', { ...lesson, day: 7 })).status, 403);

  assert.equal((await starosta('DELETE', `/api/lessons/${created.data.lesson.id}`)).status, 204);
});

test('US-05: импорт JSON — проверка, ошибки, замена расписания', async () => {
  const starosta = client();
  await starosta('POST', '/api/auth/login', { login: 'starosta1', password: DEMO_PASSWORD });

  const broken = await starosta('POST', '/api/schedule/import', { data: { lessons: [{ day: 'Пн', start: '8', end: '9:30', subject: 'X', room: '1' }] } });
  assert.equal(broken.status, 422);
  assert.equal(broken.data.details[0].path, 'lessons[0].start');

  const file = {
    group: '25ИП1б',
    semesterStart: '2026-09-07',
    lessons: [
      { day: 'Пн', week: 'обе', start: '08:00', end: '09:30', subject: 'Алгебра', type: 'лекция', room: '1-101' },
      { day: 'Вт', week: 1, start: '09:45', end: '11:15', subject: 'Python', type: 'лабораторная', room: '7-410' },
    ],
  };
  const dry = await starosta('POST', '/api/schedule/import', { data: file, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.data.summary.total, 2);
  assert.equal((await starosta('GET', '/api/schedule')).data.lessons.length, 7, 'dry run не меняет БД');

  const real = await starosta('POST', '/api/schedule/import', { data: file, mode: 'replace' });
  assert.equal(real.status, 200);
  assert.equal(real.data.imported, 2);
  const after = await starosta('GET', '/api/schedule');
  assert.deepEqual(after.data.lessons.map((l) => l.subject), ['Алгебра', 'Python']);
  assert.equal(after.data.group.semesterStart, '2026-09-07');

  const exported = await starosta('GET', '/api/schedule/export');
  assert.equal(exported.data.lessons.length, 2);
});

test('статика: клиент и общий модуль отдаются, выход за каталог запрещён', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /UniPlan/);
  assert.equal(index.headers.get('cache-control'), 'no-cache, must-revalidate');
  const weekJs = await fetch(`${base}/shared/week.js`);
  assert.equal(weekJs.status, 200);
  assert.match(weekJs.headers.get('cache-control'), /public, max-age=/);
  const appleIcon = await fetch(`${base}/apple-touch-icon.png`);
  assert.equal(appleIcon.status, 200);
  assert.equal(appleIcon.headers.get('content-type'), 'image/png');
  const applePre = await fetch(`${base}/apple-touch-icon-precomposed.png`);
  assert.equal(applePre.status, 200);
  assert.equal(applePre.headers.get('content-type'), 'image/png');
  const appleAlias = await fetch(`${base}/apple-touch-icon`);
  assert.equal(appleAlias.status, 200);
  assert.equal(appleAlias.headers.get('content-type'), 'image/png');
  const favIco = await fetch(`${base}/favicon.ico`);
  assert.equal(favIco.status, 200);
  assert.equal(favIco.headers.get('content-type'), 'image/x-icon');
  const evil = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.notEqual(evil.status, 200);
});

test('роль старосты назначается администратором и сразу действует', async () => {
  const { setRole } = await import('../server/manage.js');
  const api = client();
  await api('POST', '/api/auth/register', { name: 'Будущий Староста', login: 'future.st', password: 'secret1', groupId: await groupId('25ИП2б') });
  assert.equal((await api('POST', '/api/lessons', { day: 1, start: '08:00', end: '09:30', subject: 'X', room: '1' })).status, 403);

  setRole(db, 'future.st', 'starosta');
  const me = await api('GET', '/api/me');
  assert.equal(me.data.user.role, 'starosta');
  assert.deepEqual(me.data.group.starostas, ['Будущий Староста']);
  assert.equal((await api('POST', '/api/lessons', { day: 1, start: '08:00', end: '09:30', subject: 'X', room: '1' })).status, 201);

  assert.throws(() => setRole(db, 'nobody', 'starosta'), /не найден/);
  assert.throws(() => setRole(db, 'future.st', 'admin'), /Роль/);
});

test('староста управляет заявками студентов, настраивает курс и семестр', async () => {
  const starosta = client();
  await starosta('POST', '/api/auth/login', { login: 'starosta', password: DEMO_PASSWORD });

  // Проверяем авторасчет курса и семестра для 25ИП3б
  const me = await starosta('GET', '/api/me');
  assert.ok(me.data.group.course >= 1);
  assert.ok(me.data.group.semester >= 1);

  // Ручная настройка курса и семестра старостой
  const patchGroup = await starosta('PATCH', '/api/group', { course: 3, semester: 6 });
  assert.equal(patchGroup.status, 200);
  assert.equal(patchGroup.data.group.course, 3);
  assert.equal(patchGroup.data.group.semester, 6);

  // Студент регистрируется и отклоняется старостой
  const applicant = client();
  const reg = await applicant('POST', '/api/auth/register', { name: 'Кандидат', login: 'candidate', password: 'secret1', groupId: await groupId('25ИП3б') });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.approved, false);

  const { data: membersList } = await starosta('GET', '/api/group/members');
  const target = membersList.members.find((m) => m.login === 'candidate');
  assert.ok(target);

  // Отклонение заявки (удаление)
  const delRes = await starosta('DELETE', `/api/group/members/${target.id}`);
  assert.equal(delRes.status, 204);

  // Повторный вход удаленного кандидата возвращает 401
  const checkLogin = await applicant('POST', '/api/auth/login', { login: 'candidate', password: 'secret1' });
  assert.equal(checkLogin.status, 401);
});
