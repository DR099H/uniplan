// «Дела»: все задачи по датам — просроченные, сегодня, ближайшие дни.

import { addDays, dayOfWeek, isValidISODate, todayISO } from '/shared/week.js?v=20261019_1';
import { ensureLessons, store, tasks } from '../store.js?v=20261019_1';
import { handleTaskClick, taskHTML } from '../todo.js?v=20261019_1';
import { DAY_SHORT, esc, fmtDate, icon, showFieldErrors, toast, withBusy } from '../ui.js?v=20261019_1';

let filter = 'open';
let scope = 'all';

function dateTitle(date, today) {
  if (date === today) return 'Сегодня';
  if (date === addDays(today, 1)) return 'Завтра';
  if (date === addDays(today, -1)) return 'Вчера';
  return `${DAY_SHORT[dayOfWeek(date)]}, ${fmtDate(date)}`;
}

function groupsHTML() {
  const today = todayISO();
  let all = tasks.all();
  if (scope === 'personal') all = all.filter((t) => !t.isGroup);
  else if (scope === 'group') all = all.filter((t) => t.isGroup);

  const overdue = all.filter((t) => !t.done && t.date < today).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const rest = filter === 'open'
    ? all.filter((t) => !t.done && t.date >= today)
    : all.filter((t) => !overdue.includes(t));

  const byDate = new Map();
  for (const t of rest) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }

  let html = '';
  let i = 0;
  if (overdue.length) {
    html += `<section class="task-group" style="--i:${i++}">
      <div class="task-group-head"><h2><span class="date-chip is-overdue">Просрочено</span> ${overdue.length}</h2></div>
      <ul class="todo-list">${overdue.map((t) => taskHTML(t, { showDate: true, today })).join('')}</ul>
    </section>`;
  }
  for (const d of [...byDate.keys()].sort()) {
    const list = byDate.get(d).sort((a, b) => Number(a.done) - Number(b.done) || a.id - b.id);
    html += `<section class="task-group" style="--i:${i++}">
      <div class="task-group-head">
        <h2><span class="date-chip${d === today ? ' is-today' : ''}">${esc(dateTitle(d, today))}</span></h2>
        <a href="#/schedule?date=${d}">к расписанию ${icon('arrow', 14, 2.4)}</a>
      </div>
      <ul class="todo-list">${list.map((t) => taskHTML(t, { today })).join('')}</ul>
    </section>`;
  }
  if (!html) {
    html = `<div class="empty-day"><span class="ic">${icon('check', 24, 2.4)}</span><span class="big">Всё чисто</span>
      <p class="muted">${filter === 'open' ? 'Открытых задач нет. Добавьте задачу выше или в расписании дня.' : 'Задач пока нет.'}</p></div>`;
  }
  return html;
}

function statsHTML() {
  const today = todayISO();
  let all = tasks.all();
  if (scope === 'personal') all = all.filter((t) => !t.isGroup);
  else if (scope === 'group') all = all.filter((t) => t.isGroup);

  const open = all.filter((t) => !t.done).length;
  const overdue = all.filter((t) => !t.done && t.date < today).length;
  const done = all.filter((t) => t.done).length;
  return `
    <div class="stat"><b>${open}</b><span>открыто</span></div>
    <div class="stat${overdue ? ' is-alert' : ''}"><b>${overdue}</b><span>просрочено</span></div>
    <div class="stat"><b>${done}</b><span>сделано</span></div>`;
}

export async function render(root) {
  const isUnapproved = store.user?.role === 'student' && store.user?.approved === false;
  if (isUnapproved) {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Дела</h1>
          <p class="page-sub">Список дел вашей группы</p>
        </div>
      </div>
      <div class="card locked-card" style="text-align:center;padding:48px 24px;display:grid;gap:14px;place-items:center;max-width:540px;margin:28px auto">
        <div style="width:54px;height:54px;border-radius:50%;background:var(--surface-2);display:grid;place-items:center;color:var(--ink-2)">
          ${icon('lock', 26, 2)}
        </div>
        <h2 style="font-size:20px;font-weight:700">Ожидание подтверждения старосты</h2>
        <p class="muted" style="max-width:420px;line-height:1.5;margin:0">
          Ваша заявка на вступление в группу <b>${esc(store.group.name)}</b> отправлена старосте.
          Расписание занятий уже доступно, а просмотр и создание дел откроются сразу после одобрения заявки.
        </p>
        <a class="btn btn-primary" href="#/schedule" style="margin-top:6px">Перейти к расписанию</a>
      </div>`;
    return () => {};
  }

  root.innerHTML = '<div class="skeleton" style="height:240px"></div>';
  await Promise.all([tasks.loadAll(), ensureLessons()]);
  const today = todayISO();
  const isStarosta = store.user?.role === 'starosta';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Дела</h1>
        <p class="page-sub">Все задачи из списков по дням</p>
      </div>
      <div class="stats" data-slot="stats">${statsHTML()}</div>
    </div>

    <form class="card quick-add" data-form="quick" novalidate>
      <div class="quick-add-head">
        <div class="card-title">${icon('plus', 18, 2.4)} Новая задача</div>
        ${isStarosta ? `
          <button type="button" class="chip-group-toggle" data-act="toggle-group-task" aria-pressed="false" title="Создать как общее дело для всей группы">
            ${icon('users', 14, 2.2)}<span>Для всей группы</span>
          </button>
        ` : ''}
      </div>
      <div class="quick-add-row">
        <label class="sr-only" for="qa-text">Что сделать</label>
        <input id="qa-text" class="input" name="text" maxlength="200" placeholder="Что нужно сделать?" autocomplete="off">
        <label class="sr-only" for="qa-date">Дата</label>
        <input id="qa-date" class="input" name="date" type="date" value="${today}" required>
        <button class="btn btn-primary" type="submit">Добавить</button>
      </div>
      <small class="field-error" data-error="text"></small>
      <small class="field-error" data-error="date"></small>
    </form>

    <div class="tasks-filters-bar">
      <div class="seg" role="group" aria-label="Статус">
        <button type="button" data-filter="open" aria-pressed="${filter === 'open'}">Открытые</button>
        <button type="button" data-filter="all" aria-pressed="${filter === 'all'}">Все</button>
      </div>
      <div class="seg" role="group" aria-label="Область задач">
        <button type="button" data-scope="all" aria-pressed="${scope === 'all'}">Все</button>
        <button type="button" data-scope="personal" aria-pressed="${scope === 'personal'}">Личные</button>
        <button type="button" data-scope="group" aria-pressed="${scope === 'group'}">${icon('users', 13, 2.2)} Группа</button>
      </div>
    </div>
    <div class="task-groups anim-in" data-slot="groups">${groupsHTML()}</div>`;

  const slot = (n) => root.querySelector(`[data-slot="${n}"]`);
  const repaint = () => {
    slot('stats').innerHTML = statsHTML();
    slot('groups').innerHTML = groupsHTML();
  };

  const onClick = (e) => {
    if (handleTaskClick(e, (kind) => {
      slot('stats').innerHTML = statsHTML();
      // в режиме «Открытые» выполненная задача уезжает не сразу — чтобы была видна отметка
      if (kind === 'toggle' && filter === 'open') setTimeout(repaint, 700);
      else if (kind === 'delete') repaint();
    })) return;

    const groupToggle = e.target.closest('[data-act="toggle-group-task"]');
    if (groupToggle) {
      const pressed = groupToggle.getAttribute('aria-pressed') === 'true';
      groupToggle.setAttribute('aria-pressed', String(!pressed));
      groupToggle.classList.toggle('is-active', !pressed);
      return;
    }

    const sc = e.target.closest('[data-scope]');
    if (sc) {
      scope = sc.dataset.scope;
      root.querySelectorAll('[data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
      repaint();
      return;
    }

    const f = e.target.closest('[data-filter]');
    if (f) {
      filter = f.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
      repaint();
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const text = form.elements.text.value.trim();
    const date = form.elements.date.value;
    const isGroup = form.querySelector('[data-act="toggle-group-task"]')?.getAttribute('aria-pressed') === 'true';
    const local = [];
    if (!text) local.push({ path: 'text', message: 'Напишите, что нужно сделать' });
    if (!isValidISODate(date)) local.push({ path: 'date', message: 'Выберите дату' });
    showFieldErrors(form, local.length ? { details: local } : null);
    if (local.length) return;
    try {
      await withBusy(form.querySelector('[type="submit"]'), () => tasks.add(date, text, undefined, isGroup));
      form.elements.text.value = '';
      const groupToggle = form.querySelector('[data-act="toggle-group-task"]');
      if (groupToggle) {
        groupToggle.setAttribute('aria-pressed', 'false');
        groupToggle.classList.remove('is-active');
      }
      repaint();
      toast(`Задача добавлена на ${fmtDate(date)}${isGroup ? ' для всей группы' : ''}`);
    } catch (err) {
      if (!showFieldErrors(form, err)) toast(err.message, 'error');
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
  };
}
