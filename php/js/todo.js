// Общие части списка дел: разметка задачи и обработка «выполнено / удалить».

import { store, tasks } from './store.js?v=20261019_1';
import { CHECK_SVG, TYPE_CLASS, esc, fmtDate, icon, toast } from './ui.js?v=20261019_1';

/** Сокращение длинного названия: «Объектно-ориентированное программирование» → «ООП». */
export function shortSubject(subject) {
  if (subject.length <= 22) return subject;
  const words = subject.split(/[\s-]+/).filter((w) => w.length > 1 && !/^(и|в|на|по|для)$/.test(w));
  return words.map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase())).join('');
}

/** Класс цвета предмета — по типу его первой пары в расписании. */
export function subjectClass(subject) {
  const lesson = (store.lessons || []).find((l) => l.subject === subject);
  return lesson ? TYPE_CLASS[lesson.type] : '';
}

export function taskHTML(task, { showDate = false, today = '' } = {}) {
  const meta = [];
  if (task.isGroup) {
    meta.push(`<span class="tag tag-group" title="Общее дело группы">${icon('users', 12, 2.2)}<span>группа</span></span>`);
  }
  if (showDate) {
    const overdue = !task.done && task.date < today;
    meta.push(`<span class="todo-date${overdue ? ' is-overdue' : ''}">${esc(fmtDate(task.date))}</span>`);
  }
  if (task.subject) {
    meta.push(`<span class="todo-sub ${subjectClass(task.subject)}" title="${esc(task.subject)}"><i aria-hidden="true"></i>${esc(shortSubject(task.subject))}</span>`);
  }
  const editBtn = task.canDelete === false
    ? ''
    : `<button class="icon-btn is-plain" type="button" data-act="edit" aria-label="Редактировать задачу: ${esc(task.text)}">${icon('pencil', 15, 2)}</button>`;

  const deleteBtn = task.canDelete === false
    ? ''
    : `<button class="icon-btn is-plain is-danger" type="button" data-act="delete" aria-label="Удалить задачу: ${esc(task.text)}">${icon('trash', 17, 2)}</button>`;

  return `
    <li class="todo-item${task.done ? ' is-done' : ''}${task.isGroup ? ' is-group-task' : ''}" data-task="${task.id}">
      <button class="check" type="button" role="checkbox" aria-checked="${task.done}" data-act="toggle"
        aria-label="Выполнено: ${esc(task.text)}">${CHECK_SVG}</button>
      <div class="todo-text">
        <div class="todo-main"><span class="todo-label">${esc(task.text)}</span></div>
        ${meta.length ? `<div class="todo-meta">${meta.join('')}</div>` : ''}
      </div>
      <div class="todo-actions">
        ${editBtn}
        ${deleteBtn}
      </div>
    </li>`;
}

/**
 * Обрабатывает клик по задаче. Возвращает true, если клик относился к задаче.
 * onChange вызывается после изменения данных (для пересчёта счётчиков).
 */
export function handleTaskClick(e, onChange) {
  const btn = e.target.closest('[data-act="toggle"], [data-act="delete"], [data-act="edit"]');
  const li = btn?.closest('[data-task]');
  if (!li) return false;
  const id = Number(li.dataset.task);

  if (btn.dataset.act === 'edit') {
    if (li.classList.contains('is-editing')) return true;
    const task = tasks.find(id);
    if (!task) return true;

    const todoText = li.querySelector('.todo-text');
    const origHTML = todoText.innerHTML;
    li.classList.add('is-editing');

    todoText.innerHTML = `
      <form class="todo-edit-form" data-act="save-edit">
        <input class="input todo-edit-input" type="text" value="${esc(task.text)}" maxlength="200" required>
        <button class="icon-btn is-plain is-ok" type="submit" title="Сохранить">${icon('check', 16, 2.4)}</button>
        <button class="icon-btn is-plain" type="button" data-act="cancel-edit" title="Отмена">${icon('x', 16, 2.4)}</button>
      </form>`;

    const input = todoText.querySelector('.todo-edit-input');
    input.focus();
    input.select();

    const exitEdit = () => {
      li.classList.remove('is-editing');
      todoText.innerHTML = origHTML;
      const label = todoText.querySelector('.todo-label');
      if (label) label.textContent = task.text;
    };

    const form = todoText.querySelector('.todo-edit-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const newText = input.value.trim();
      if (!newText || newText === task.text) {
        exitEdit();
        return;
      }
      try {
        await tasks.update(id, { text: newText });
        task.text = newText;
        exitEdit();
        toast('Задача обновлена');
        onChange?.('edit', task);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    form.querySelector('[data-act="cancel-edit"]').addEventListener('click', exitEdit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') exitEdit();
    });

    return true;
  }

  if (btn.dataset.act === 'toggle') {
    const pending = tasks.toggle(id); // статус меняется сразу, запрос уходит в фоне
    const task = tasks.find(id);
    const apply = () => {
      li.classList.toggle('is-done', task.done);
      btn.setAttribute('aria-checked', String(task.done));
      onChange?.('toggle', task);
    };
    apply();
    pending.catch((err) => {
      apply();
      toast(err.message, 'error');
    });
    return true;
  }

  li.classList.add('is-leaving');
  setTimeout(async () => {
    try {
      await tasks.remove(id);
      li.remove();
      onChange?.('delete');
    } catch (err) {
      li.classList.remove('is-leaving');
      toast(err.message, 'error');
    }
  }, 200);
  return true;
}
