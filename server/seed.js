// Тестовые данные (TSK-03): справочник групп, демо-аккаунты и расписание группы 25ИП3б.
// Запускается автоматически, если база пустая.

import { hashPassword } from './auth.js';
import { transaction } from './db.js';
import { addDays, todayISO } from '../shared/week.js';

export const SEMESTER_START = '2026-09-01';
export const GROUPS = ['24ИП3б', '25ИВТ1б', '25ИП1б', '25ИП2б', '25ИП3б'];

// Демо-аккаунты. Пароль у всех одинаковый — только для локальной демонстрации.
export const DEMO_PASSWORD = 'uniplan2026';
export const DEMO_USERS = [
  { login: 'student', name: 'Дмитрий Лебедев', group: '25ИП3б', role: 'student' },
  { login: 'starosta', name: 'Ольга Миронова', group: '25ИП3б', role: 'starosta' },
  { login: 'starosta1', name: 'Кирилл Афанасьев', group: '25ИП1б', role: 'starosta' },
];

// Звонки: 1 08:00–09:30 · 2 09:45–11:15 · 3 11:30–13:00 · 4 13:40–15:10 · 5 15:25–16:55 · 6 17:10–18:40
const P = {
  1: ['08:00', '09:30'], 2: ['09:45', '11:15'], 3: ['11:30', '13:00'],
  4: ['13:40', '15:10'], 5: ['15:25', '16:55'], 6: ['17:10', '18:40'],
};

const TKRPO = 'Технологии командной разработки ПО';
const BD = 'Базы данных';
const OOP = 'Объектно-ориентированное программирование';
const TV = 'Теория вероятностей и мат. статистика';
const NET = 'Компьютерные сети';
const OS = 'Операционные системы';
const WEB = 'Web-программирование';
const ENG = 'Иностранный язык';
const PE = 'Физическая культура';
const PHIL = 'Философия';

// [день, неделя (0 — обе), номер пары, предмет, тип, аудитория, преподаватель]
const SCHEDULE_25IP3B = [
  [1, 0, 1, TV, 'лекция', '1-201', 'Мельникова Т.С.'],
  [1, 0, 2, OOP, 'лекция', '7-305', 'Фролов А.И.'],
  [1, 1, 3, OOP, 'лабораторная', '7-412', 'Фролов А.И.'],
  [1, 2, 3, TV, 'практика', '1-118', 'Мельникова Т.С.'],

  [2, 0, 2, TKRPO, 'лекция', '7-210', 'Орлова Н.Ю.'],
  [2, 1, 3, TKRPO, 'лабораторная', '7-414', 'Орлова Н.Ю.'],
  [2, 2, 3, BD, 'лабораторная', '7-416', 'Зайцев К.В.'],
  [2, 0, 4, ENG, 'практика', '3-108', 'Королёва Е.П.'],

  [3, 0, 1, BD, 'лекция', '7-305', 'Зайцев К.В.'],
  [3, 0, 2, NET, 'лекция', '7-201', 'Савин Д.М.'],
  [3, 2, 3, NET, 'лабораторная', '7-418', 'Савин Д.М.'],
  [3, 0, 5, PE, 'практика', 'Спортзал', ''],

  [4, 1, 2, OS, 'лекция', '7-210', 'Громов П.Д.'],
  [4, 1, 3, OS, 'лабораторная', '7-412', 'Громов П.Д.'],
  [4, 2, 3, WEB, 'лабораторная', '7-414', 'Белов С.Н.'],
  [4, 2, 4, WEB, 'лабораторная', '7-414', 'Белов С.Н.'],
  [4, 1, 4, ENG, 'практика', '3-108', 'Королёва Е.П.'],

  [5, 0, 2, WEB, 'лекция', '7-305', 'Белов С.Н.'],
  [5, 1, 3, TV, 'практика', '1-118', 'Мельникова Т.С.'],
  [5, 2, 3, PE, 'практика', 'Спортзал', ''],
  [5, 0, 4, PHIL, 'семинар', '2-301', 'Лебедева О.Р.'],

  [6, 1, 1, PHIL, 'лекция', '2-101', 'Лебедева О.Р.'],
  [6, 1, 2, ENG, 'практика', '3-108', 'Королёва Е.П.'],
];

const SCHEDULE_25IP1B = [
  [1, 0, 2, 'Математический анализ', 'лекция', '1-201', 'Ершов В.Л.'],
  [1, 0, 3, 'Программирование на C++', 'лабораторная', '7-410', 'Никитина А.А.'],
  [2, 1, 1, 'Дискретная математика', 'лекция', '1-120', 'Ершов В.Л.'],
  [2, 2, 1, 'Дискретная математика', 'практика', '1-118', 'Ершов В.Л.'],
  [3, 0, 2, 'История России', 'семинар', '2-204', 'Павлова И.Г.'],
  [4, 0, 3, 'Программирование на C++', 'лекция', '7-305', 'Никитина А.А.'],
  [5, 0, 1, ENG, 'практика', '3-110', 'Королёва Е.П.'],
];

export function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM groups').get().n;
  if (count > 0) return false;

  transaction(db, () => {
    const insGroup = db.prepare('INSERT INTO groups (name, semester_start) VALUES (?, ?)');
    const groupId = {};
    for (const name of GROUPS) groupId[name] = Number(insGroup.run(name, SEMESTER_START).lastInsertRowid);

    const insLesson = db.prepare(`INSERT INTO lessons (group_id, day, week, start_time, end_time, subject, type, room, teacher)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const addSchedule = (group, rows) => {
      for (const [day, week, pair, subject, type, room, teacher] of rows) {
        insLesson.run(groupId[group], day, week, P[pair][0], P[pair][1], subject, type, room, teacher);
      }
    };
    addSchedule('25ИП3б', SCHEDULE_25IP3B);
    addSchedule('25ИП1б', SCHEDULE_25IP1B);

    const insUser = db.prepare('INSERT INTO users (login, name, password_hash, group_id, role, approved) VALUES (?, ?, ?, ?, ?, 1)');
    const userId = {};
    for (const u of DEMO_USERS) {
      userId[u.login] = Number(insUser.run(u.login, u.name, hashPassword(DEMO_PASSWORD), groupId[u.group], u.role).lastInsertRowid);
    }

    // Несколько задач у демо-студента вокруг сегодняшней даты, чтобы экран не был пустым.
    const today = todayISO();
    const insTask = db.prepare('INSERT INTO tasks (user_id, date, text, subject, done) VALUES (?, ?, ?, ?, ?)');
    const tasks = [
      [-1, 'Дочитать конспект по ТВиМС', TV, 0],
      [0, 'Оформить отчёт по лабе №2', NET, 0],
      [0, 'Взять справку для физкультуры', PE, 1],
      [0, 'Скинуть старосте фото конспекта', null, 0],
      [1, 'Защитить лабу №3 (ветки и Pull Request)', TKRPO, 0],
      [1, 'Повторить нормальные формы', BD, 0],
      [3, 'Тест по английскому: Unit 4', ENG, 0],
      [6, 'Подготовить вопросы к семинару', PHIL, 0],
    ];
    for (const [shift, text, subject, done] of tasks) insTask.run(userId.student, addDays(today, shift), text, subject, done);
  });
  return true;
}
