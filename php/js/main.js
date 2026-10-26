// Точка входа клиента: загрузка сессии, hash-роутер и оболочка с навигацией.

import { todayISO, weekType } from '/shared/week.js?v=20261019_1';
import { api, setUnauthorizedHandler } from './api.js?v=20261019_1';
import { clearSession, setSession, store } from './store.js?v=20261019_1';
import { esc, icon, initials, toast } from './ui.js?v=20261019_1';
import * as authView from './views/auth.js?v=20261019_1';
import * as scheduleView from './views/schedule.js?v=20261020_1';
import * as tasksView from './views/tasks.js?v=20261019_1';
import * as adminView from './views/admin.js?v=20261019_1';
import * as profileView from './views/profile.js?v=20261019_1';

const app = document.getElementById('app');
const VIEWS = { schedule: scheduleView, tasks: tasksView, admin: adminView, profile: profileView };
let cleanup = null;
let shellFor = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  return { path: path || 'schedule', params: Object.fromEntries(new URLSearchParams(qs)) };
}

export function go(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', hash);
    route();
  } else if (location.hash === hash) {
    route();
  } else {
    location.hash = hash;
  }
}

function navItems() {
  const items = [
    { path: 'schedule', label: 'Расписание', icon: 'calendar' },
    { path: 'tasks', label: 'Дела', icon: 'todo' },
  ];
  if (store.user.role === 'starosta') items.push({ path: 'admin', label: 'Управление', icon: 'pencil' });
  items.push({ path: 'profile', label: 'Профиль', icon: 'user' });
  return items;
}

const LOGO = '<span class="logo-mark" aria-hidden="true">U</span><span>Uni<b>Plan</b></span>';

function renderShell() {
  const u = store.user;
  const items = navItems();
  app.innerHTML = `
    <div class="shell">
      <aside class="sidenav" aria-label="Навигация">
        <a class="logo" href="#/schedule" aria-label="UniPlan — на главную">${LOGO}</a>
        <nav>
          ${items.map((i) => `<a class="side-link" href="#/${i.path}" data-nav="${i.path}">${icon(i.icon, 20, 2)}<span>${i.label}</span></a>`).join('')}
        </nav>
        <div class="side-user">
          <a class="side-user-card" href="#/profile">
            <span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span>
            <span><b>${esc(u.name)}</b><span>${esc(store.group?.name || '')}${u.role === 'starosta' ? ' · староста' : ''}</span></span>
          </a>
        </div>
      </aside>
      <header class="topbar">
        <a class="logo" href="#/schedule" aria-label="UniPlan — на главную">${LOGO}</a>
        <div class="topbar-right">
          <a class="group-pill" href="#/profile" aria-label="Группа ${esc(store.group?.name || '')}"><b aria-hidden="true"></b>${esc(store.group?.name || '')}</a>
          <a class="avatar" href="#/profile" aria-label="Профиль">${esc(initials(u.name))}</a>
        </div>
      </header>
      <main class="main" id="view" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Разделы">
        ${items.map((i) => `<a class="tab" href="#/${i.path}" data-nav="${i.path}">${icon(i.icon, 22, 2)}<span>${i.label}</span></a>`).join('')}
      </nav>
    </div>`;
  shellFor = `${u.id}:${u.role}:${u.name}:${store.group?.id}`;
}

async function route() {
  const { path, params } = parseHash();
  cleanup?.();
  cleanup = null;

  if (!store.user) {
    shellFor = null;
    if (path !== 'login') return go('#/login', { replace: true });
    cleanup = await authView.render(app, { onLogin });
    return;
  }
  if (!VIEWS[path] || (path === 'admin' && store.user.role !== 'starosta')) return go('#/schedule', { replace: true });

  const key = `${store.user.id}:${store.user.role}:${store.user.name}:${store.group?.id}`;
  if (shellFor !== key) renderShell();
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (path !== 'schedule') {
    const activeWeek = store.weekOverride ?? weekType(store.selectedDate || todayISO(), store.group.semesterStart);
    document.documentElement.dataset.week = String(activeWeek);
  }
  const view = document.getElementById('view');
  try {
    cleanup = await VIEWS[path].render(view, params, { go, refreshShell, logout });
  } catch (err) {
    view.innerHTML = `<div class="banner banner-error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
  }
}

/** Перерисовать оболочку (после смены имени/группы в профиле). */
function refreshShell() {
  shellFor = null;
}

function onLogin(session) {
  setSession(session);
  store.selectedDate = undefined;
  go('#/schedule');
}

setUnauthorizedHandler(() => {
  if (!store.user) return;
  clearSession();
  toast('Сессия истекла — войдите снова', 'error');
  go('#/login', { replace: true });
});

async function logout() {
  try {
    await api.post('/api/auth/logout');
  } finally {
    clearSession();
    go('#/login');
  }
}

async function boot() {
  try {
    store.meta = await api.get('/api/meta');
  } catch {
    /* сервер недоступен — покажем ошибку на экране входа */
  }
  try {
    setSession(await api.get('/api/me'));
  } catch {
    /* не авторизован */
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
