// Определение типа недели по дате (US-02, риск «Ошибки определения типа недели»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayOfWeek, isValidISODate, mondayOf, weekType } from '../shared/week.js';

const START = '2026-09-01'; // вторник

test('неделя, в которую попадает начало семестра, — первая', () => {
  assert.equal(weekType('2026-09-01', START), 1);
  assert.equal(weekType('2026-08-31', START), 1); // понедельник той же недели
  assert.equal(weekType('2026-09-06', START), 1); // воскресенье той же недели
});

test('граница недель: воскресенье → понедельник меняет тип', () => {
  assert.equal(weekType('2026-09-06', START), 1);
  assert.equal(weekType('2026-09-07', START), 2);
  assert.equal(weekType('2026-09-13', START), 2);
  assert.equal(weekType('2026-09-14', START), 1);
});

test('недели чередуются на протяжении семестра', () => {
  assert.equal(weekType('2026-10-07', START), 2);
  assert.equal(weekType('2026-10-12', START), 1);
  assert.equal(weekType('2026-12-28', START), 2); // 17 недель от 31.08
});

test('переход через Новый год не ломает чередование', () => {
  // 28.12.2026 — II, значит 04.01.2027 — I
  assert.equal(weekType('2027-01-04', START), 1);
  assert.equal(weekType('2027-01-11', START), 2);
});

test('даты до начала семестра продолжают чередование назад', () => {
  assert.equal(weekType('2026-08-24', START), 2);
});

test('вспомогательные функции дат', () => {
  assert.equal(dayOfWeek('2026-10-07'), 3);
  assert.equal(dayOfWeek('2026-10-11'), 7);
  assert.equal(mondayOf('2026-10-11'), '2026-10-05');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.ok(isValidISODate('2028-02-29'));
  assert.ok(!isValidISODate('2026-02-30'));
  assert.ok(!isValidISODate('07.10.2026'));
});
