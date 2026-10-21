// Управление расписанием (только староста): US-04 ручной ввод пар, US-05 импорт JSON, дата начала семестра.

import { addDays, computeCourseAndSemester, mondayOf, todayISO, weekType } from '/shared/week.js?v=20261019_1';
import { api } from '../api.js?v=20261019_1';
import { ensureLessons, store } from '../store.js?v=20261019_1';
import {
  BELLS, DAY_FULL, DAY_SHORT, ROMAN, TYPE_CLASS, TYPE_LABEL,
  countPairs, dayNum, esc, fmtDate, formatPairs, icon, initials, isHalfPair, monthGen, plural, showFieldErrors, toast, withBusy,
} from '../ui.js?v=20261019_1';

const TYPES = ['лекция', 'практика', 'лабораторная', 'семинар', 'другое'];
const EMPTY = { day: 1, week: 0, start: BELLS[0][0], end: BELLS[0][1], subject: '', type: 'лекция', room: '', teacher: '' };
const pairWord = formatPairs;

let tab = 'lessons';
let listWeek = 'all';

export async function render(root, params) {
  if (['lessons', 'import', 'semester', 'members'].includes(params.tab)) tab = params.tab;
  root.innerHTML = '<div class="skeleton" style="height:320px"></div>';

  let membersList = null;
  async function loadMembers() {
    try {
      const res = await api.get('/api/group/members');
      membersList = res?.members || [];
    } catch {
      membersList = [];
    }
  }

  await Promise.all([ensureLessons(true), loadMembers()]);

  let form = { ...EMPTY };
  let editingId = null;
  let confirmId = null;
  let flashId = null;
  let importState = null; // { fileName, data, mode, result?, errors?, parseError?, done? }

  // ---------- вкладка «Пары» ----------

  const chip = (field, value, label, cls = '') =>
    `<button type="button" class="chip ${cls}" data-field="${field}" data-value="${esc(value)}" aria-pressed="${String(form[field]) === String(value)}">${label}</button>`;

  function lessonFormHTML() {
    const subjects = [...new Set(store.lessons.map((l) => l.subject))].sort();
    const teachers = [...new Set(store.lessons.map((l) => l.teacher).filter(Boolean))].sort();
    const bell = BELLS.findIndex(([s, e]) => s === form.start && e === form.end);
    return `
      <form class="card lesson-form" data-form="lesson" novalidate>
        <div class="card-head" style="margin:0">
          <h2 class="card-title">${editingId ? `${icon('pencil', 18, 2)} Изменение пары` : `${icon('plus', 18, 2.4)} Новая пара`}</h2>
          ${editingId ? '<button class="btn btn-sm btn-ghost" type="button" data-act="cancel-edit">Отмена</button>' : ''}
        </div>
        <div class="banner banner-error" data-form-error hidden></div>

        <fieldset class="field"><legend class="field-label">День</legend>
          <div class="chips-days">${[1, 2, 3, 4, 5, 6, 7].map((d) => chip('day', d, DAY_SHORT[d], 'chip-square')).join('')}</div>
        </fieldset>

        <fieldset class="field"><legend class="field-label">Неделя</legend>
          <div class="chips">${chip('week', 0, 'Каждую')}${chip('week', 1, 'Только I')}${chip('week', 2, 'Только II')}</div>
        </fieldset>

        <fieldset class="field"><legend class="field-label">Время</legend>
          <div class="chips">${BELLS.map(([s], i) => `<button type="button" class="chip" data-bell="${i}" aria-pressed="${bell === i}">${i + 1} <small>${s}</small></button>`).join('')}</div>
          <div class="time-row" style="margin-top:4px">
            <label class="field"><span class="hint">Начало</span><input class="input" type="time" name="start" value="${form.start}" required></label>
            <label class="field"><span class="hint">Конец</span><input class="input" type="time" name="end" value="${form.end}" required></label>
          </div>
          <small class="field-error" data-error="start"></small>
          <small class="field-error" data-error="end"></small>
        </fieldset>

        <label class="field"><span>Предмет</span>
          <input class="input" name="subject" list="dl-subjects" maxlength="120" value="${esc(form.subject)}" placeholder="Например: Базы данных" autocomplete="off" required>
          <datalist id="dl-subjects">${subjects.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
          <small class="field-error" data-error="subject"></small>
        </label>

        <fieldset class="field"><legend class="field-label">Тип занятия</legend>
          <div class="chips">${TYPES.map((t) => chip('type', t, TYPE_LABEL[t], `${TYPE_CLASS[t]}" data-tone="1`)).join('')}</div>
        </fieldset>

        <div class="two-col">
          <label class="field"><span>Аудитория</span>
            <input class="input mono" name="room" maxlength="40" value="${esc(form.room)}" placeholder="7-305" autocomplete="off" required>
            <small class="field-error" data-error="room"></small>
          </label>
          <label class="field"><span>Преподаватель <span class="hint">(необязательно)</span></span>
            <input class="input" name="teacher" list="dl-teachers" maxlength="80" value="${esc(form.teacher)}" placeholder="Фамилия И.О." autocomplete="off">
            <datalist id="dl-teachers">${teachers.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
            <small class="field-error" data-error="teacher"></small>
          </label>
        </div>

        <button class="btn btn-primary btn-block" type="submit">${editingId ? `${icon('check', 17, 2.6)} Сохранить изменения` : `${icon('plus', 17, 2.6)} Добавить пару`}</button>
      </form>`;
  }

  function lessonListHTML() {
    const filtered = store.lessons.filter((l) => listWeek === 'all' || l.week === 0 || l.week === Number(listWeek));
    const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => filtered.some((l) => l.day === d));
    const rows = (d) => filtered
      .filter((l) => l.day === d)
      .sort((a, b) => a.start.localeCompare(b.start) || a.week - b.week)
      .map((l) => `
        <div class="admin-row ${TYPE_CLASS[l.type]}${l.id === editingId ? ' is-editing' : ''}${l.id === flashId ? ' is-new' : ''}" data-lesson="${l.id}">
          <span class="t">${l.start}<br>${l.end}</span>
          <div>
            <div class="s">${esc(l.subject)}${isHalfPair(l) ? '<span class="week-badge" title="Полупара (0.5 пары)">½</span>' : ''}${l.week ? `<span class="week-badge" title="Только ${ROMAN[l.week]} неделя">${ROMAN[l.week]}</span>` : ''}</div>
            <div class="m">${TYPE_LABEL[l.type]} · ауд. <span class="mono">${esc(l.room)}</span>${l.teacher ? ` · ${esc(l.teacher)}` : ''}</div>
          </div>
          ${confirmId === l.id
            ? `<div class="confirm-row">Удалить?
                 <button class="btn btn-sm btn-danger" type="button" data-act="confirm-del">Да</button>
                 <button class="btn btn-sm" type="button" data-act="cancel-del">Нет</button></div>`
            : `<div class="acts">
                 <button class="icon-btn is-plain" type="button" data-act="edit" aria-label="Изменить: ${esc(l.subject)}, ${DAY_SHORT[l.day]} ${l.start}">${icon('pencil', 16, 2)}</button>
                 <button class="icon-btn is-plain is-danger" type="button" data-act="del" aria-label="Удалить: ${esc(l.subject)}, ${DAY_SHORT[l.day]} ${l.start}">${icon('trash', 16, 2)}</button>
               </div>`}
        </div>`).join('');

    return `
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">${icon('calendar', 18, 2)} Расписание группы</h2>
          <span class="eyebrow">${pairWord(countPairs(store.lessons))}</span>
        </div>
        <div class="seg" role="group" aria-label="Показать неделю" style="display:inline-grid;margin-bottom:16px">
          <button type="button" data-list-week="all" aria-pressed="${listWeek === 'all'}">Все</button>
          <button type="button" data-list-week="1" aria-pressed="${listWeek === '1'}">I неделя</button>
          <button type="button" data-list-week="2" aria-pressed="${listWeek === '2'}">II неделя</button>
        </div>
        <div class="admin-list">
          ${days.length ? days.map((d) => {
            const n = countPairs(filtered.filter((l) => l.day === d));
            return `<div class="admin-day"><h3>${DAY_FULL[d][0].toUpperCase()}${DAY_FULL[d].slice(1)} <small>${pairWord(n)}</small></h3><div class="admin-rows">${rows(d)}</div></div>`;
          }).join('') : '<p class="todo-empty">Расписание пустое. Добавьте пару в форме или загрузите JSON.</p>'}
        </div>
      </section>`;
  }

  // ---------- вкладка «Импорт JSON» ----------

  function modeHTML() {
    return `<fieldset class="radio-cards">
      <legend class="field-label">Что сделать с текущим расписанием (${pairWord(store.lessons.length)})</legend>
      <label class="radio-card"><input type="radio" name="import-mode" value="replace" ${importState.mode === 'replace' ? 'checked' : ''}>
        <span><b>Заменить</b><span>Старые пары удалятся, останутся только пары из файла</span></span></label>
      <label class="radio-card"><input type="radio" name="import-mode" value="append" ${importState.mode === 'append' ? 'checked' : ''}>
        <span><b>Добавить к текущему</b><span>Пересечения по времени с существующими парами покажем как ошибки</span></span></label>
    </fieldset>`;
  }

  function importResultHTML() {
    const st = importState;
    if (!st) return '';
    const file = `<p class="hint">${icon('json', 15, 2)} ${esc(st.fileName)}</p>`;
    if (st.parseError) {
      return `${file}<div class="banner banner-error">${icon('alert', 17, 2)}<span>Файл не читается как JSON: ${esc(st.parseError)}</span></div>`;
    }
    if (st.errors) {
      return `${file}
        <div class="banner banner-error">${icon('alert', 17, 2)}<span>Файл не прошёл проверку (ошибок: ${st.errors.length}). Расписание не изменено.</span></div>
        <ul class="error-list">${st.errors.map((er) => `<li><code>${esc(er.path || 'файл')}</code>${esc(er.message)}</li>`).join('')}</ul>
        ${modeHTML()}`;
    }
    if (st.done) {
      return `<div class="banner banner-ok">${icon('check', 17, 2.6)}<span>Готово: импортировано ${pairWord(st.done.imported)} (${st.done.mode === 'replace' ? 'расписание заменено' : 'добавлены к текущему'}). <a href="#/schedule">Открыть расписание</a></span></div>`;
    }
    if (st.result) {
      const sm = st.result.summary;
      return `${file}
        <div class="summary">
          <span class="pill neutral">${pairWord(sm.total)}</span>
          <span class="pill neutral">каждую неделю: ${sm.everyWeek}</span>
          <span class="pill" style="background:var(--w1-soft);color:var(--w1-text)">только I: ${sm.week1}</span>
          <span class="pill" style="background:var(--w2-soft);color:var(--w2-text)">только II: ${sm.week2}</span>
          ${st.result.semesterStart ? `<span class="pill neutral">семестр с ${fmtDate(st.result.semesterStart)}</span>` : ''}
        </div>
        <div class="preview-scroll">
          <table class="preview-table">
            <thead><tr><th>День</th><th>Время</th><th>Нед.</th><th>Предмет</th><th>Ауд.</th></tr></thead>
            <tbody>${st.result.lessons.map((l) => `<tr><td>${DAY_SHORT[l.day]}</td><td class="mono">${l.start}–${l.end}</td><td>${l.week ? ROMAN[l.week] : '—'}</td><td>${esc(l.subject)} <span class="muted">· ${TYPE_LABEL[l.type]}</span></td><td class="mono">${esc(l.room)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        ${modeHTML()}
        <div class="chips">
          <button class="btn btn-primary" type="button" data-act="do-import">${icon('upload', 17, 2.2)} Импортировать</button>
          <button class="btn" type="button" data-act="reset-import">Отмена</button>
        </div>`;
    }
    return `${file}<p class="hint"><span class="spinner" style="display:inline-block;vertical-align:-3px"></span> Проверяем файл…</p>`;
  }

  function importTabHTML() {
    return `
      <div class="admin-grid is-import">
        <section class="card" style="display:grid;gap:16px">
          <h2 class="card-title">${icon('json', 19, 2)} Импорт расписания из JSON</h2>
          <p class="muted">Сначала файл проверяется: вы увидите, какие пары будут загружены, или список ошибок с указанием места. В базу ничего не пишется, пока вы не нажмёте «Импортировать».</p>
          <label class="dropzone" data-slot="dropzone">
            <input type="file" accept=".json,application/json" data-input="file" aria-label="Выбрать JSON-файл расписания">
            <span class="dz-icon">${icon('upload', 24, 2)}</span>
            <b>Перетащите файл .json</b>
            <span>или нажмите, чтобы выбрать · до 900 КБ</span>
          </label>
          <div style="display:grid;gap:14px" data-slot="import-result" aria-live="polite">${importResultHTML()}</div>
        </section>
        <aside style="display:grid;gap:20px;align-content:start">
          <section class="card" style="display:grid;gap:12px">
            <h2 class="card-title">${icon('download', 18, 2)} Шаблон</h2>
            <p class="hint">Скачайте шаблон, заполните и загрузите. Текущее расписание можно выгрузить, поправить и загрузить обратно.</p>
            <div class="chips">
              <a class="btn btn-sm btn-week" href="/index.php?_route=/api/schedule/template" download="uniplan-template.json">${icon('download', 15, 2.2)} Шаблон</a>
              <a class="btn btn-sm" href="/index.php?_route=/api/schedule/export" download>${icon('download', 15, 2.2)} Текущее расписание</a>
            </div>
            <details class="help">
              <summary>Формат файла</summary>
              <div class="help-body">
                <pre class="code">{
  "group": "${esc(store.group.name)}",
  "semesterStart": "2026-09-01",
  "lessons": [
    { "day": "Пн", "week": "обе",
      "start": "08:00", "end": "09:30",
      "subject": "Базы данных",
      "type": "лекция", "room": "7-305",
      "teacher": "Зайцев К.В." }
  ]
}</pre>
                <p><code class="code">day</code> — 1–7 или Пн…Вс; <code class="code">week</code> — 1, 2 или «обе»;
                  <code class="code">type</code> — лекция, практика, лабораторная, семинар, другое;
                  <code class="code">group</code> и <code class="code">semesterStart</code> необязательны.</p>
              </div>
            </details>
          </section>
          <section class="soon">
            <h2 class="card-title">${icon('image', 18, 2)} Скриншот → расписание</h2>
            <p class="hint">Распознавание таблицы со скриншота запланировано на следующий релиз (US-06).</p>
          </section>
        </aside>
      </div>`;
  }

  // ---------- вкладка «Семестр» ----------

  function semesterPreviewHTML(start) {
    const mon = mondayOf(todayISO());
    return `<div class="chips">${[0, 1, 2, 3, 4, 5].map((i) => {
      const m = addDays(mon, i * 7);
      const sun = addDays(m, 6);
      const w = weekType(m, start);
      const label = monthGen(m) === monthGen(sun) ? `${dayNum(m)}–${dayNum(sun)} ${monthGen(m).slice(0, 3)}` : `${dayNum(m)} ${monthGen(m).slice(0, 3)} – ${dayNum(sun)} ${monthGen(sun).slice(0, 3)}`;
      return `<span class="pill" style="background:var(--w${w}-soft);color:var(--w${w}-text);padding:6px 11px${i === 0 ? ';box-shadow:0 0 0 1.5px var(--w' + w + ')' : ''}"><b>${ROMAN[w]}</b> ${i === 0 ? 'эта · ' : ''}${label}</span>`;
    }).join('')}</div>`;
  }

  function semesterTabHTML() {
    const autoCs = computeCourseAndSemester(store.group.name, todayISO());
    return `
      <section class="card" style="max-width:640px;display:grid;gap:16px">
        <h2 class="card-title">${icon('flag', 18, 2)} Настройки группы и семестра</h2>
        <p class="muted">Неделя, на которую приходится дата начала, считается <b>I</b>, дальше недели чередуются. Курс и семестр определяются по шифру группы (<b>${autoCs.course} курс · ${autoCs.semester} семестр</b>), либо могут быть заданы вручную.</p>
        <form class="form-grid" data-form="semester" novalidate>
          <label class="field"><span>Дата начала семестра</span>
            <input class="input" type="date" name="semesterStart" value="${store.group.semesterStart}" required style="max-width:230px">
            <small class="field-error" data-error="semesterStart"></small>
          </label>
          <div class="two-col">
            <label class="field"><span>Курс <span class="hint">(авто: ${autoCs.course})</span></span>
              <input class="input" type="number" min="1" max="6" name="course" value="${store.group.course || ''}" placeholder="${autoCs.course}">
              <small class="field-error" data-error="course"></small>
            </label>
            <label class="field"><span>Семестр <span class="hint">(авто: ${autoCs.semester})</span></span>
              <input class="input" type="number" min="1" max="12" name="semester" value="${store.group.semester || ''}" placeholder="${autoCs.semester}">
              <small class="field-error" data-error="semester"></small>
            </label>
          </div>
          <div class="field"><span class="field-label">Ближайшие недели</span><div data-slot="sem-preview">${semesterPreviewHTML(store.group.semesterStart)}</div></div>
          <button class="btn btn-primary" type="submit" style="justify-self:start">${icon('check', 17, 2.6)} Сохранить</button>
        </form>
      </section>`;
  }

  // ---------- вкладка «Студенты и заявки» ----------

  function membersTabHTML() {
    if (!membersList) return '<div class="skeleton" style="height:180px"></div>';
    const pending = membersList.filter((m) => !m.approved);
    const approved = membersList.filter((m) => m.approved);

    return `
      <div style="display:grid;gap:20px;max-width:720px">
        <section class="card" style="display:grid;gap:14px">
          <div class="card-head" style="margin:0">
            <h2 class="card-title">${icon('users', 18, 2)} Заявки на вступление <span class="pill" style="font-size:12px">${pending.length}</span></h2>
          </div>
          ${pending.length === 0 ? '<p class="muted" style="margin:4px 0 0">Новых заявок на вступление нет.</p>' : `
            <div class="members-list">
              ${pending.map((m) => `
                <div class="member-item is-pending" data-member="${m.id}">
                  <div class="member-info">
                    <div class="member-avatar">${esc(initials(m.name))}</div>
                    <div>
                      <div class="member-name">${esc(m.name)}</div>
                      <div class="member-sub mono">@${esc(m.login)} · <span class="tag tag-week">ждёт одобрения</span></div>
                    </div>
                  </div>
                  <div class="member-actions">
                    <button class="btn btn-sm btn-primary" type="button" data-act="approve-member" data-id="${m.id}">${icon('check', 14, 2.4)} Принять</button>
                    <button class="btn btn-sm btn-ghost is-danger" type="button" data-act="reject-member" data-id="${m.id}">${icon('x', 14, 2.4)} Отклонить</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </section>

        <section class="card" style="display:grid;gap:14px">
          <div class="card-head" style="margin:0">
            <h2 class="card-title">${icon('user', 18, 2)} Состав группы <span class="pill" style="font-size:12px">${approved.length}</span></h2>
          </div>
          <div class="members-list">
            ${approved.map((m) => {
              const isStarosta = m.role === 'starosta';
              const isMe = m.id === store.user?.id;
              const removeBtn = (!isStarosta && !isMe)
                ? `<button class="icon-btn is-plain is-danger" type="button" data-act="remove-member" data-id="${m.id}" title="Исключить из группы">${icon('trash', 16, 2)}</button>`
                : '';
              return `
                <div class="member-item" data-member="${m.id}">
                  <div class="member-info">
                    <div class="member-avatar">${esc(initials(m.name))}</div>
                    <div>
                      <div class="member-name">${esc(m.name)} ${isMe ? '<small class="muted">(вы)</small>' : ''}</div>
                      <div class="member-sub mono">@${esc(m.login)} ${isStarosta ? '<span class="role-badge">староста</span>' : ''}</div>
                    </div>
                  </div>
                  <div class="member-actions">
                    ${removeBtn}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </section>
      </div>`;
  }

  // ---------- общая отрисовка ----------

  function tabHTML() {
    if (tab === 'import') return importTabHTML();
    if (tab === 'semester') return semesterTabHTML();
    if (tab === 'members') return membersTabHTML();
    return `<div class="admin-grid anim-in">
      <div data-slot="lesson-form">${lessonFormHTML()}</div>
      <div data-slot="lesson-list" style="--i:1">${lessonListHTML()}</div>
    </div>`;
  }

  function pendingBadgeHTML() {
    const pendingCount = (membersList || []).filter((m) => !m.approved).length;
    return pendingCount > 0 ? `<span class="day-badge" style="position:static;display:inline-flex;margin-left:6px">${pendingCount}</span>` : '';
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Управление расписанием</h1>
        <p class="page-sub">Группа <b>${esc(store.group.name)}</b> · изменения сразу видят все студенты группы</p>
      </div>
    </div>
    <div class="seg seg-scroll" role="tablist" aria-label="Разделы" style="margin-bottom:22px;max-width:640px">
      <button type="button" role="tab" data-tab="lessons" aria-selected="${tab === 'lessons'}">Пары</button>
      <button type="button" role="tab" data-tab="import" aria-selected="${tab === 'import'}">Импорт<span class="hide-sm"> JSON</span></button>
      <button type="button" role="tab" data-tab="semester" aria-selected="${tab === 'semester'}">Семестр<span class="hide-sm"> и курс</span></button>
      <button type="button" role="tab" data-tab="members" aria-selected="${tab === 'members'}">Студенты ${pendingBadgeHTML()}</button>
    </div>
    <div data-slot="tab">${tabHTML()}</div>`;

  const slot = (n) => root.querySelector(`[data-slot="${n}"]`);
  const repaintForm = () => { slot('lesson-form').innerHTML = lessonFormHTML(); };
  const repaintList = () => { slot('lesson-list').innerHTML = lessonListHTML(); };
  const repaintImport = () => { const s = slot('import-result'); if (s) s.innerHTML = importResultHTML(); };

  function syncFormFromInputs() {
    const f = root.querySelector('[data-form="lesson"]');
    if (!f) return;
    for (const name of ['start', 'end', 'subject', 'room', 'teacher']) form[name] = f.elements[name].value;
  }

  // ---------- импорт ----------

  async function checkImport() {
    importState.result = null;
    importState.errors = null;
    repaintImport();
    try {
      importState.result = await api.post('/api/schedule/import', { data: importState.data, mode: importState.mode, dryRun: true });
    } catch (err) {
      importState.errors = err.status === 422 ? err.details : [{ path: '', message: err.message }];
    }
    repaintImport();
  }

  async function readFile(file) {
    if (!file) return;
    importState = { fileName: file.name, mode: importState?.mode || 'replace' };
    if (file.size > 900 * 1024) {
      importState.parseError = 'файл больше 900 КБ';
      return repaintImport();
    }
    try {
      importState.data = JSON.parse(await file.text());
    } catch (err) {
      importState.parseError = err.message;
      return repaintImport();
    }
    await checkImport();
  }

  // ---------- события ----------

  const onClick = async (e) => {
    const t = e.target;
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      history.replaceState(null, '', `#/admin?tab=${tab}`);
      root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
      slot('tab').innerHTML = tabHTML();
      return;
    }

    const fieldChip = t.closest('[data-field]');
    if (fieldChip) {
      syncFormFromInputs();
      const { field, value } = fieldChip.dataset;
      form[field] = field === 'type' ? value : Number(value);
      fieldChip.parentElement.querySelectorAll('[data-field]').forEach((c) => c.setAttribute('aria-pressed', String(c === fieldChip)));
      return;
    }
    const bellChip = t.closest('[data-bell]');
    if (bellChip) {
      const f = root.querySelector('[data-form="lesson"]');
      [f.elements.start.value, f.elements.end.value] = BELLS[Number(bellChip.dataset.bell)];
      syncFormFromInputs();
      bellChip.parentElement.querySelectorAll('[data-bell]').forEach((c) => c.setAttribute('aria-pressed', String(c === bellChip)));
      return;
    }
    const wk = t.closest('[data-list-week]');
    if (wk) {
      listWeek = wk.dataset.listWeek;
      return repaintList();
    }

    const act = t.closest('[data-act]')?.dataset.act;
    const row = t.closest('[data-lesson]');
    const id = row ? Number(row.dataset.lesson) : null;

    if (act === 'edit') {
      const l = store.lessons.find((x) => x.id === id);
      form = { day: l.day, week: l.week, start: l.start, end: l.end, subject: l.subject, type: l.type, room: l.room, teacher: l.teacher };
      editingId = id;
      confirmId = null;
      repaintForm();
      repaintList();
      slot('lesson-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (act === 'cancel-edit') {
      editingId = null;
      form = { ...EMPTY };
      repaintForm();
      repaintList();
    } else if (act === 'del') {
      confirmId = id;
      repaintList();
      root.querySelector(`[data-lesson="${id}"] [data-act="cancel-del"]`)?.focus();
    } else if (act === 'cancel-del') {
      confirmId = null;
      repaintList();
    } else if (act === 'confirm-del') {
      try {
        await api.del(`/api/lessons/${id}`);
        store.lessons = store.lessons.filter((l) => l.id !== id);
        if (editingId === id) {
          editingId = null;
          form = { ...EMPTY };
          repaintForm();
        }
        confirmId = null;
        repaintList();
        toast('Пара удалена');
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (act === 'do-import') {
      try {
        const res = await withBusy(t.closest('button'), () =>
          api.post('/api/schedule/import', { data: importState.data, mode: importState.mode }));
        importState.done = res;
        importState.result = null;
        store.group = { ...store.group, ...res.group };
        await ensureLessons(true);
        repaintImport();
        toast(`Импортировано: ${pairWord(res.imported)}`);
      } catch (err) {
        if (err.status === 422) importState.errors = err.details;
        else toast(err.message, 'error');
        repaintImport();
      }
    } else if (act === 'approve-member') {
      const btn = t.closest('[data-act="approve-member"]');
      const memberId = Number(btn.dataset.id);
      try {
        await withBusy(btn, () => api.post(`/api/group/members/${memberId}/approve`));
        const found = membersList?.find((m) => m.id === memberId);
        if (found) found.approved = true;
        slot('tab').innerHTML = tabHTML();
        const tabBtn = root.querySelector('[data-tab="members"]');
        if (tabBtn) tabBtn.innerHTML = `Студенты ${pendingBadgeHTML()}`;
        toast('Студент принят в группу');
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (act === 'reject-member' || act === 'remove-member') {
      const btn = t.closest('[data-act]');
      const memberId = Number(btn.dataset.id);
      const isReject = act === 'reject-member';
      if (!isReject && !confirm('Исключить студента из группы?')) return;
      try {
        await withBusy(btn, () => api.del(`/api/group/members/${memberId}`));
        membersList = (membersList || []).filter((m) => m.id !== memberId);
        slot('tab').innerHTML = tabHTML();
        const tabBtn = root.querySelector('[data-tab="members"]');
        if (tabBtn) tabBtn.innerHTML = `Студенты ${pendingBadgeHTML()}`;
        toast(isReject ? 'Заявка отклонена' : 'Студент исключён из группы');
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (act === 'reset-import') {
      importState = null;
      repaintImport();
    }
  };

  const onChange = (e) => {
    if (e.target.matches('[data-input="file"]')) readFile(e.target.files[0]);
    if (e.target.name === 'import-mode') {
      importState.mode = e.target.value;
      checkImport();
    }
  };

  const onInput = (e) => {
    if (e.target.name === 'semesterStart' && e.target.value) slot('sem-preview').innerHTML = semesterPreviewHTML(e.target.value);
    if (e.target.name === 'start' || e.target.name === 'end') {
      syncFormFromInputs();
      root.querySelectorAll('[data-bell]').forEach((c) => {
        const [s, en] = BELLS[Number(c.dataset.bell)];
        c.setAttribute('aria-pressed', String(s === form.start && en === form.end));
      });
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const banner = f.querySelector('[data-form-error]');
    if (banner) banner.hidden = true;

    if (f.dataset.form === 'semester') {
      try {
        const body = {
          semesterStart: f.elements.semesterStart.value,
          course: f.elements.course?.value ? Number(f.elements.course.value) : null,
          semester: f.elements.semester?.value ? Number(f.elements.semester.value) : null,
        };
        const res = await withBusy(f.querySelector('[type="submit"]'), () =>
          api.patch('/api/group', body));
        store.group = { ...store.group, ...res.group };
        store.weekOverride = null;
        const w = weekType(store.selectedDate || todayISO(), store.group.semesterStart);
        document.documentElement.dataset.week = String(w);
        showFieldErrors(f, null);
        toast(`Настройки сохранены. Сейчас ${ROMAN[w]} неделя`);
      } catch (err) {
        if (!showFieldErrors(f, err)) toast(err.message, 'error');
      }
      return;
    }

    if (f.dataset.form !== 'lesson') return;
    syncFormFromInputs();
    const local = [];
    if (!form.subject.trim()) local.push({ path: 'subject', message: 'Укажите название предмета' });
    if (!form.room.trim()) local.push({ path: 'room', message: 'Укажите аудиторию' });
    if (!form.start) local.push({ path: 'start', message: 'Укажите время начала' });
    if (!form.end) local.push({ path: 'end', message: 'Укажите время окончания' });
    else if (form.start && form.end <= form.start) local.push({ path: 'end', message: 'Пара должна заканчиваться позже, чем начинается' });
    showFieldErrors(f, local.length ? { details: local } : null);
    if (local.length) return f.querySelector('[aria-invalid="true"]')?.focus();

    try {
      const res = await withBusy(f.querySelector('[type="submit"]'), () => (editingId
        ? api.put(`/api/lessons/${editingId}`, form)
        : api.post('/api/lessons', form)));
      const saved = res.lesson;
      store.lessons = editingId
        ? store.lessons.map((l) => (l.id === saved.id ? saved : l))
        : [...store.lessons, saved];
      toast(editingId ? 'Изменения сохранены' : `Добавлено: ${DAY_SHORT[saved.day]} ${saved.start}, ${saved.subject}`);
      flashId = saved.id;
      if (editingId) {
        editingId = null;
        form = { ...EMPTY };
      } else {
        // для быстрого ввода: тот же день, неделя и тип, следующая пара по звонкам
        const next = BELLS.findIndex(([s]) => s === saved.start) + 1;
        form = { ...EMPTY, day: saved.day, week: saved.week, type: saved.type };
        if (next > 0 && next < BELLS.length) [form.start, form.end] = BELLS[next];
      }
      repaintForm();
      repaintList();
      flashId = null;
    } catch (err) {
      if (err.status === 409 && banner) {
        banner.hidden = false;
        banner.innerHTML = `${icon('alert', 17, 2)}<span>${esc(err.message)}</span>`;
      } else if (!showFieldErrors(f, err)) {
        toast(err.message, 'error');
      }
    }
  };

  const onDrag = (e) => {
    const dz = e.target.closest?.('[data-slot="dropzone"]');
    if (!dz) return;
    e.preventDefault();
    dz.classList.toggle('is-over', e.type === 'dragover' || e.type === 'dragenter');
    if (e.type === 'drop') readFile(e.dataTransfer.files[0]);
  };

  const dragEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);
  dragEvents.forEach((ev) => root.addEventListener(ev, onDrag));
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
    root.removeEventListener('submit', onSubmit);
    dragEvents.forEach((ev) => root.removeEventListener(ev, onDrag));
  };
}
