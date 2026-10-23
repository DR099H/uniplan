// Проверка JSON-файла расписания (US-05) и одиночной пары (US-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLesson, validateSchedule } from '../server/validate.js';

const ok = { day: 'Пн', week: 'обе', start: '8:00', end: '09:30', subject: '  Базы   данных ', type: 'лаба', room: '7-305' };

test('пара нормализуется: день, неделя, время, тип, пробелы', () => {
  const { lesson, errors } = normalizeLesson(ok);
  assert.deepEqual(errors, []);
  assert.deepEqual(lesson, { day: 1, week: 0, start: '08:00', end: '09:30', subject: 'Базы данных', type: 'лабораторная', room: '7-305', teacher: '' });
});

test('ошибки пары указывают на конкретное поле', () => {
  const { lesson, errors } = normalizeLesson({ day: 'Ху', week: 3, start: '25:00', end: '9:30', subject: '', type: 'кино', room: '' });
  assert.equal(lesson, null);
  const paths = errors.map((e) => e.path).sort();
  assert.deepEqual(paths, ['day', 'room', 'start', 'subject', 'type', 'week']);
});

test('конец пары раньше начала — ошибка', () => {
  const { errors } = normalizeLesson({ ...ok, start: '10:00', end: '09:30' });
  assert.equal(errors[0].path, 'end');
});

test('корректный файл проходит проверку', () => {
  const res = validateSchedule({ group: '25ИП3б', semesterStart: '2026-09-01', lessons: [ok, { ...ok, day: 2 }] }, { groupName: '25ИП3б' });
  assert.equal(res.ok, true);
  assert.equal(res.lessons.length, 2);
  assert.equal(res.semesterStart, '2026-09-01');
});

test('файл чужой группы отклоняется', () => {
  const res = validateSchedule({ group: '25ИП1б', lessons: [ok] }, { groupName: '25ИП3б' });
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].path, 'group');
});

test('нет массива lessons — понятная ошибка', () => {
  const res = validateSchedule({ group: '25ИП3б' }, { groupName: '25ИП3б' });
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].path, 'lessons');
});

test('пересечение пар внутри файла находится с указанием индекса', () => {
  const res = validateSchedule({ lessons: [ok, { ...ok, start: '09:00', end: '10:30', week: 1 }] });
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].path, 'lessons[1]');
  assert.match(res.errors[0].message, /lessons\[0\]/);
});

test('пары разных недель в одно время не пересекаются', () => {
  const res = validateSchedule({ lessons: [{ ...ok, week: 1 }, { ...ok, week: 2 }] });
  assert.equal(res.ok, true);
});
