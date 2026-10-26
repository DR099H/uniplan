// Общие помощники интерфейса: экранирование, форматирование дат, иконки, тосты.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const DAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const DAY_FULL = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const ROMAN = ['', 'I', 'II'];

export const TYPE_LABEL = { лекция: 'Лекция', практика: 'Практика', лабораторная: 'Лаб. работа', семинар: 'Семинар', другое: 'Занятие' };
export const TYPE_CLASS = {
  лекция: 't-lecture', практика: 't-practice', лабораторная: 't-lab', семинар: 't-seminar', другое: 't-other',
};

export const BELLS = [
  ['08:00', '09:30'], ['09:45', '11:15'], ['11:30', '13:00'],
  ['13:40', '15:10'], ['15:25', '16:55'], ['17:10', '18:40'],
];

const parts = (iso) => iso.split('-').map(Number);
export const dayNum = (iso) => parts(iso)[2];
export const monthGen = (iso) => MONTH_GEN[parts(iso)[1] - 1];
export const monthNom = (iso) => MONTH_NOM[parts(iso)[1] - 1];
export const fmtDate = (iso) => `${dayNum(iso)} ${monthGen(iso)}`;

export function plural(n, [one, few, many]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function duration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function isHalfPair(lesson) {
  const [sh, sm] = String(lesson?.start || '0:0').split(':').map(Number);
  const [eh, em] = String(lesson?.end || '0:0').split(':').map(Number);
  const dur = (eh * 60 + em) - (sh * 60 + sm);
  return dur > 0 && dur <= 60;
}

export function lessonPairWeight(lesson) {
  return isHalfPair(lesson) ? 0.5 : 1;
}

export function countPairs(lessons) {
  const total = (lessons || []).reduce((sum, l) => sum + lessonPairWeight(l), 0);
  return Math.round(total * 10) / 10;
}

export function formatPairs(n) {
  const num = Math.round(Number(n) * 10) / 10;
  if (!Number.isInteger(num)) return `${num} пары`;
  return `${num} ${plural(num, ['пара', 'пары', 'пар'])}`;
}

export function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// Иконки — контурные пути в стиле Lucide (ISC), рисуются через currentColor.
const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  todo: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  json: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  coffee: '<path d="M10 2v2M14 2v2M6 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
};

export function icon(name, size = 20, stroke = 2.4) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export const CHECK_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' is-error' : ''}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : 'check', 17, 2.4)}<span>${esc(message)}</span>`;
  box.append(el);
  setTimeout(() => {
    el.classList.add('is-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, kind === 'error' ? 4200 : 2600);
}

/** Блокирует кнопку и показывает спиннер на время запроса. */
export async function withBusy(button, fn) {
  if (!button) return fn();
  const html = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="sr-only">Загрузка</span>';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = html;
  }
}

/** Выводит ошибки сервера под полями формы (элементы [data-error="field"]). */
export function showFieldErrors(form, err) {
  form.querySelectorAll('[data-error]').forEach((el) => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  let shown = false;
  for (const d of err?.details || []) {
    const slot = form.querySelector(`[data-error="${d.path}"]`);
    if (!slot) continue;
    slot.textContent = d.message;
    form.querySelector(`[name="${d.path}"]`)?.setAttribute('aria-invalid', 'true');
    shown = true;
  }
  return shown;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
