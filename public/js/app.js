/* Shared helpers for every page: API calls, navigation, flash messages. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n || 0).toFixed(2);
const n2 = (n) => Number(n || 0).toFixed(2);
const n1 = (n) => Number(n || 0).toFixed(1);
const $ = (s) => document.querySelector(s);

async function api(path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, opt);
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && !/index\.html$|\/$/.test(location.pathname)) { location.href = '/index.html'; throw new Error('login'); }
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function flash(msg, type = 'success') {
  const box = $('#flash'); if (!box) return;
  box.insertAdjacentHTML('afterbegin', `<div class="alert alert-${type} alert-dismissible fade show">${esc(msg)}
    <button class="btn-close" data-bs-dismiss="alert"></button></div>`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const act = (fn) => async (e) => {
  try { await fn(e); } catch (err) { if (err.message !== 'login') flash(err.message, 'danger'); }
};
const formData = (form) => Object.fromEntries(new FormData(form));

const STAFF = ['admin', 'collector', 'accountant'];

const PAGES = [
  { href: 'dashboard.html', label: 'Dashboard', icon: '📊', roles: STAFF },
  { href: 'farmers.html', label: 'Farmers', icon: '👨‍🌾', roles: ['admin', 'collector'] },
  { href: 'collect.html', label: 'Milk Collection', icon: '🥛', roles: STAFF },
  { href: 'rates.html', label: 'Rate Chart', icon: '📋', roles: ['admin', 'accountant'] },
  { href: 'payments.html', label: 'Payments', icon: '💰', roles: ['admin', 'accountant'] },
  { href: 'transactions.html', label: 'Transactions', icon: '🧾', roles: ['admin', 'accountant'] },
  { href: 'sales.html', label: 'Sales', icon: '🛒', roles: ['admin', 'accountant'] },
  { href: 'reports.html', label: 'Reports', icon: '📈', roles: STAFF },
  { href: 'messages.html', label: 'Messages', icon: '💬', roles: STAFF },
  { href: 'alerts.html', label: 'Alerts', icon: '🔔', roles: STAFF },
  { href: 'my.html', label: 'My Portal', icon: '🏠', roles: ['farmer'] },
  { href: 'password.html', label: 'Change Password', icon: '🔑', roles: [...STAFF, 'farmer'] },
];

const PAGE_TITLES = {
  'dashboard.html': 'Dashboard',
  'farmers.html': 'Farmer Management',
  'collect.html': 'Milk Collection',
  'rates.html': 'Rate Chart',
  'payments.html': 'Payment Management',
  'transactions.html': 'Transactions',
  'sales.html': 'Sales',
  'reports.html': 'Reports & Analytics',
  'messages.html': 'Messages',
  'alerts.html': 'Smart Alerts',
  'my.html': 'My Portal',
  'password.html': 'Change Password',
};

function getToday() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
}

async function boot(page) {
  // Normalize page name so both 'dashboard' and 'dashboard.html' work
  const pageKey = page.endsWith('.html') ? page : page + '.html';
  const me = await api('/me');
  const here = PAGES.find((p) => p.href === pageKey);
  if (here && !here.roles.includes(me.role)) {
    location.href = me.role === 'farmer' ? 'my.html' : 'dashboard.html';
    throw new Error('login');
  }

  const links = PAGES.filter((p) => p.roles.includes(me.role))
    .map((p) => `<a class="nav-link ${p.href === pageKey ? 'active' : ''}" href="${p.href}">
      <span class="icon">${p.icon}</span> ${p.label}
    </a>`).join('');

  const home = me.role === 'farmer' ? 'my.html' : 'dashboard.html';
  const title = PAGE_TITLES[pageKey] || 'Smart Milk Dairy';
  const roleIcon = me.role === 'farmer' ? '👨‍🌾' : me.role === 'admin' ? '👔' : '👤';

  document.body.innerHTML = `
  <div class="app-layout">
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <div class="logo">🐄</div>
        <div class="brand-text">
          Smart Milk Dairy
          <small>SMART DAIRY MANAGEMENT</small>
        </div>
      </div>
      <nav class="sidebar-nav">${links}</nav>
      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar">${roleIcon}</div>
          <div class="user-meta">
            <div class="name">${esc(me.username)}</div>
            <div class="role">${esc(me.role)}</div>
          </div>
        </div>
        <button class="btn-logout" id="logout">Logout</button>
      </div>
    </aside>
    <div class="main-content">
      <header class="topbar">
        <div class="d-flex align-items-center gap-3">
          <button class="menu-toggle" id="menuToggle">☰</button>
          <div class="topbar-title">${title}</div>
        </div>
        <div class="topbar-date">${getToday()}</div>
      </header>
      <div class="content-area">
        <div id="flash"></div>
        <div id="app"></div>
      </div>
    </div>
  </div>`;

  $('#logout').onclick = async () => { await api('/logout', 'POST'); location.href = 'index.html'; };

  const sidebar = $('#sidebar');
  const overlay = $('#sidebarOverlay');
  const toggle = $('#menuToggle');
  if (toggle) {
    toggle.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
    overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };
  }

  return me;
}
