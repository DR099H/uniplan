// Проверка пар расписания: одна пара из формы или целый JSON-файл импорта.
// Ошибки возвращаются списком { path, message }, чтобы клиент мог показать их рядом с полем
// или строкой файла.

import { isValidISODate, timeToMinutes } from '../shared/week.js';

export const LESSON_TYPES = ['лекция', 'практика', 'лабораторная', 'семинар', 'другое'];
export const DAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const MAX_IMPORT_LESSONS = 300;

const DAY_ALIASES = {
  пн: 1, понедельник: 1, mon: 1, monday: 1,
  вт: 2, вторник: 2, tue: 2, tuesday: 2,
  ср: 3, среда: 3, wed: 3, wednesday: 3,
  чт: 4, четверг: 4, thu: 4, thursday: 4,
  пт: 5, пятница: 5, fri: 5, friday: 5,
  сб: 6, суббота: 6, sat: 6, saturday: 6,
  вс: 7, воскресенье: 7, sun: 7, sunday: 7,
};

const WEEK_ALIASES = {
  0: 0, обе: 0, каждая: 0, все: 0, both: 0, all: 0,
  1: 1, i: 1, первая: 1, нечетная: 1, нечётная: 1,
  2: 2, ii: 2, вторая: 2, четная: 2, чётная: 2,
};

const TYPE_ALIASES = {
  лекция: 'лекция', лек: 'лекция', лк: 'лекция', lecture: 'лекция',
  практика: 'практика', практ: 'практика', пр: 'практика', 'практическое занятие': 'практика', practice: 'практика',
  лабораторная: 'лабораторная', лаба: 'лабораторная', лаб: 'лабораторная', лр: 'лабораторная',
  'лабораторная работа': 'лабораторная', lab: 'лабораторная',
  семинар: 'семинар', сем: 'семинар', seminar: 'семинар',
  другое: 'другое', other: 'другое',
};

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function normTime(value) {
  const m = TIME_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function normText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/**
 * Приводит «сырую» пару к каноническому виду.
 * @returns {{ lesson: object|null, errors: {path: string, message: string}[] }}
 */
export function normalizeLesson(raw, prefix = '') {
  const errors = [];
  const err = (field, message) => errors.push({ path: prefix ? `${prefix}.${field}` : field, message });

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { lesson: null, errors: [{ path: prefix || 'lesson', message: 'Ожидается объект с описанием пары' }] };
  }

  let day = null;
  if (Number.isInteger(raw.day) && raw.day >= 1 && raw.day <= 7) day = raw.day;
  else if (typeof raw.day === 'string') day = DAY_ALIASES[raw.day.trim().toLowerCase().replace(/\.$/, '')] ?? null;
  if (day === null) err('day', 'Укажите день недели: число 1–7 или название (Пн, Вт, …)');

  let week = null;
  if (raw.week === undefined || raw.week === null || raw.week === '') week = 0;
  else week = WEEK_ALIASES[String(raw.week).trim().toLowerCase()] ?? null;
  if (week === null) err('week', 'Неделя должна быть 1, 2 или «обе»');

  const start = normTime(raw.start);
  const end = normTime(raw.end);
  if (!start) err('start', 'Время начала в формате ЧЧ:ММ, например 08:00');
  if (!end) err('end', 'Время окончания в формате ЧЧ:ММ, например 09:30');
  if (start && end && timeToMinutes(end) <= timeToMinutes(start)) {
    err('end', 'Пара должна заканчиваться позже, чем начинается');
  }

  const subject = normText(raw.subject);
  if (!subject) err('subject', 'Укажите название предмета');
  else if (subject.length > 120) err('subject', 'Название предмета длиннее 120 символов');

  let type = 'другое';
  if (raw.type !== undefined && raw.type !== null && raw.type !== '') {
    type = TYPE_ALIASES[normText(raw.type).toLowerCase()] ?? null;
    if (type === null) err('type', `Тип занятия: ${LESSON_TYPES.join(', ')}`);
  }

  const room = normText(raw.room);
  if (!room) err('room', 'Укажите аудиторию');
  else if (room.length > 40) err('room', 'Аудитория длиннее 40 символов');

  const teacher = normText(raw.teacher);
  if (teacher.length > 80) err('teacher', 'Имя преподавателя длиннее 80 символов');

  if (errors.length) return { lesson: null, errors };
  return { lesson: { day, week, start, end, subject, type, room, teacher }, errors };
}

/** Пересекаются ли две пары: один день, общие недели и наложение по времени. */
export function lessonsOverlap(a, b) {
  if (a.day !== b.day) return false;
  if (a.week !== 0 && b.week !== 0 && a.week !== b.week) return false;
  return timeToMinutes(a.start) < timeToMinutes(b.end) && timeToMinutes(b.start) < timeToMinutes(a.end);
}

export function describeLesson(l) {
  const week = l.week === 0 ? 'обе недели' : `${l.week}-я неделя`;
  return `${DAY_SHORT[l.day]} ${l.start}–${l.end}, ${week}: ${l.subject}`;
}

/**
 * Проверяет содержимое JSON-файла расписания.
 * Допускается объект { group?, semesterStart?, lessons: [...] } или просто массив пар.
 * @param existing пары, уже лежащие в БД (для режима «добавить»), — с ними тоже проверяются пересечения
 */
export function validateSchedule(data, { groupName, existing = [] } = {}) {
  const errors = [];
  if (Array.isArray(data)) data = { lessons: data };
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: [{ path: '', message: 'Файл должен содержать объект с полем "lessons"' }] };
  }

  if (data.group !== undefined && groupName && normText(data.group).toLowerCase() !== groupName.toLowerCase()) {
    errors.push({ path: 'group', message: `Файл для группы «${normText(data.group)}», а вы староста группы «${groupName}»` });
  }

  let semesterStart = null;
  if (data.semesterStart !== undefined) {
    if (isValidISODate(data.semesterStart)) semesterStart = data.semesterStart;
    else errors.push({ path: 'semesterStart', message: 'Дата начала семестра в формате ГГГГ-ММ-ДД' });
  }

  if (!Array.isArray(data.lessons)) {
    errors.push({ path: 'lessons', message: 'Поле "lessons" должно быть массивом пар' });
    return { ok: false, errors };
  }
  if (data.lessons.length === 0) errors.push({ path: 'lessons', message: 'В файле нет ни одной пары' });
  if (data.lessons.length > MAX_IMPORT_LESSONS) {
    errors.push({ path: 'lessons', message: `Слишком много пар: ${data.lessons.length} (максимум ${MAX_IMPORT_LESSONS})` });
    return { ok: false, errors };
  }

  const lessons = [];
  data.lessons.forEach((raw, i) => {
    const path = `lessons[${i}]`;
    const res = normalizeLesson(raw, path);
    if (!res.lesson) return errors.push(...res.errors);
    const clashFile = lessons.findIndex((l) => lessonsOverlap(l, res.lesson));
    if (clashFile >= 0) {
      errors.push({ path, message: `Пересекается с lessons[${lessons[clashFile].index}] (${describeLesson(lessons[clashFile])})` });
    }
    const clashDb = existing.find((l) => lessonsOverlap(l, res.lesson));
    if (clashDb) errors.push({ path, message: `Пересекается с парой из текущего расписания (${describeLesson(clashDb)})` });
    lessons.push({ ...res.lesson, index: i });
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors, semesterStart, lessons: lessons.map(({ index, ...l }) => l) };
}

export function summarize(lessons) {
  const days = {};
  for (const l of lessons) days[DAY_SHORT[l.day]] = (days[DAY_SHORT[l.day]] || 0) + 1;
  return {
    total: lessons.length,
    everyWeek: lessons.filter((l) => l.week === 0).length,
    week1: lessons.filter((l) => l.week === 1).length,
    week2: lessons.filter((l) => l.week === 2).length,
    days,
  };
}
