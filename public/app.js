/* KidTodo 前端逻辑 */
const $ = id => document.getElementById(id);

let me = null;
let tasks = [];
let currentView = 'today';
let lastReminderKey = '';

const REPEAT_LABEL = { once: '只做一次', daily: '每天', weekdays: '上学日', weekends: '周末' };
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ---------- Web Push（有声系统通知，锁屏也能收到） ----------
let swReg = null;

async function initPush() {
  if (!('serviceWorker' in navigator)) { $('pushBtn').classList.add('hidden'); return; }
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    const st = await api('/api/push/status');
    if (!st.enabled) { $('pushBtn').classList.add('hidden'); return; }
    updatePushBtn(swReg, st.subscriptions);
  } catch (e) { /* 忽略 */ }
}

function updatePushBtn(reg, subCount) {
  const btn = $('pushBtn');
  Notification.requestPermission().then(p => {
    // 仅更新文案，不主动弹窗；真正订阅在用户点击时
    if (p === 'granted' && subCount > 0) {
      btn.textContent = '🔔 已开启';
      // 长按/点击弹出菜单不友好，改为双击触发测试：单击测试推送
      btn.ondblclick = testPush;
    }
  }).catch(() => {});
  btn.onclick = subscribePush;
}

async function subscribePush() {
  if (!swReg) return;
  const btn = $('pushBtn');
  try {
    let perm = Notification.permission;
    if (perm !== 'granted') perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('需要在系统设置里允许通知哦'); return; }
    const { publicKey } = await api('/api/push/vapid-key');
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(publicKey)
    });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    btn.textContent = '🔔 已开启';
    toast('推送提醒已开启 🔔 锁屏也能收到提醒啦');
    // 发一条测试推送，立刻验证
    api('/api/push/test', { method: 'POST' }).catch(() => {});
  } catch (e) {
    toast(e.message || '订阅失败，请重试');
  }
}

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function testPush() {
  try {
    await api('/api/push/test', { method: 'POST' });
    toast('测试推送已发送，看看有没有收到通知');
  } catch (e) {
    toast(e.message || '发送失败');
  }
}

// ---------- 鉴权视图 ----------
async function checkAuth() {
  try {
    me = (await api('/api/auth/me')).user;
    showApp();
  } catch (e) {
    showAuth();
  }
}

function showAuth() {
  $('topbar').classList.add('hidden');
  $('authView').classList.remove('hidden');
  ['todayView', 'methodsView', 'statsView'].forEach(v => $(v).classList.add('hidden'));
}

function showApp() {
  $('authView').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $('userBadge').textContent = '你好，' + me.displayName;
  switchView('today');
  initPush();
}

let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $('loginSegBtn').classList.toggle('active', mode === 'login');
  $('regSegBtn').classList.toggle('active', mode === 'register');
  $('displayName').classList.toggle('hidden', mode === 'login');
  $('authSubmit').textContent = mode === 'login' ? '登录' : '注册并开始使用';
  $('authMsg').textContent = '';
}

$('loginSegBtn').onclick = () => setAuthMode('login');
$('regSegBtn').onclick = () => setAuthMode('register');

$('authForm').onsubmit = async e => {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  try {
    if (authMode === 'login') {
      me = (await api('/api/auth/login', { method: 'POST', body: { username, password } })).user;
    } else {
      me = (await api('/api/auth/register', {
        method: 'POST',
        body: { username, password, displayName: $('displayName').value.trim() }
      })).user;
    }
    me.activeMethod = null;
    showApp();
  } catch (err) {
    $('authMsg').textContent = err.message;
  }
};

$('logoutBtn').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  me = null;
  showAuth();
};

// ---------- 视图切换 ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => switchView(tab.dataset.view);
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  ['todayView', 'methodsView', 'statsView'].forEach(v => $(v).classList.add('hidden'));
  $(view + 'View').classList.remove('hidden');
  if (view === 'today') loadTasks();
  if (view === 'methods') loadMethods();
  if (view === 'stats') loadStats();
}

// ---------- 今日任务 ----------
async function loadTasks() {
  const data = await api('/api/tasks');
  tasks = data.tasks;
  renderDate();
  renderTasks();
}

function renderDate() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  $('dateBanner').textContent = `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 · 星期${WEEK_CN[d.getUTCDay()]}`;
}

function renderTasks() {
  const list = $('taskList');
  list.innerHTML = '';
  $('emptyTip').classList.toggle('hidden', tasks.length > 0);
  let done = 0;
  tasks.forEach(t => {
    if (t.doneToday) done++;
    const li = document.createElement('li');
    li.className = 'task-item' + (t.doneToday ? ' done' : '');
    li.innerHTML = `
      <button class="check-btn" title="打卡">✔</button>
      <div class="task-body">
        <div class="task-title">${t.emoji ? t.emoji + ' ' : ''}${esc(t.title)}</div>
        <div class="task-meta">
          ${t.schedule_time ? `<span>⏰ ${t.schedule_time}</span>` : ''}
          <span>${REPEAT_LABEL[t.repeat_type] || ''}</span>
          ${t.streak > 1 ? `<span class="task-streak">🔥 连续 ${t.streak} 天</span>` : ''}
        </div>
        ${t.tip ? `<div class="task-tip">💡 ${esc(t.tip)}</div>` : ''}
      </div>
      <button class="del-btn" title="删除">✕</button>`;
    li.querySelector('.check-btn').onclick = async () => {
      const r = await api(`/api/tasks/${t.id}/checkin`, { method: 'POST' });
      await loadTasks();
      if (r.done) toast(`太棒了！${r.streak > 1 ? '已连续 ' + r.streak + ' 天 🔥' : '打卡成功 🎉'}`);
    };
    li.querySelector('.del-btn').onclick = async () => {
      if (!confirm('确定删除这个任务吗？')) return;
      await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
      loadTasks();
    };
    list.appendChild(li);
  });
  const total = tasks.length;
  $('progressLabel').textContent = total ? `今天完成了 ${done} / ${total} 项` : '还没有任务';
  $('progressEmoji').textContent = total && done === total ? '🎉' : '';
  $('progressFill').style.width = total ? (done / total * 100) + '%' : '0';
}

$('taskForm').onsubmit = async e => {
  e.preventDefault();
  await api('/api/tasks', {
    method: 'POST',
    body: {
      title: $('taskTitle').value,
      emoji: $('taskEmoji').value,
      time: $('taskTime').value || null,
      repeatType: $('taskRepeat').value,
      tip: $('taskTip').value
    }
  });
  $('taskTitle').value = ''; $('taskEmoji').value = ''; $('taskTip').value = '';
  loadTasks();
  toast('任务添加成功 ✨');
};

// ---------- 方法模板 ----------
async function loadMethods() {
  const { methods } = await api('/api/methods');
  const box = $('methodList');
  box.innerHTML = '';
  methods.forEach(m => {
    const active = me.activeMethod === m.id;
    const card = document.createElement('div');
    card.className = 'method-card';
    card.innerHTML = `
      <div class="method-head">
        <span class="method-emoji">${m.emoji}</span>
        <span class="method-name">${m.name}</span>
        ${active ? '<span class="method-badge">使用中</span>' : ''}
      </div>
      <div class="method-desc">${m.description}</div>
      <ul class="method-tips">${m.tips.map(t => `<li>${t}</li>`).join('')}</ul>
      <button class="btn btn-primary">${active ? '再次生成任务' : '我要试试这个'}</button>`;
    card.querySelector('button').onclick = async () => {
      const r = await api('/api/methods/apply', { method: 'POST', body: { methodId: m.id } });
      me.activeMethod = r.method.id;
      loadMethods();
      toast(`已按「${r.method.name}」生成每日任务 📅`);
    };
    box.appendChild(card);
  });
}

// ---------- 成就 ----------
async function loadStats() {
  const s = await api('/api/stats');
  $('statTotal').textContent = s.totalCheckins;
  $('statActiveDays').textContent = s.last30.length;
  const grid = $('heatGrid');
  grid.innerHTML = '';
  const map = Object.fromEntries(s.last30.map(d => [d.date, d.n]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() + 8 * 3600 * 1000 - i * 86400 * 1000);
    const key = d.toISOString().slice(0, 10);
    const cell = document.createElement('div');
    cell.className = 'heat-cell' + (map[key] ? ' on' : '') + (i === 0 ? ' today' : '');
    cell.title = `${key}：${map[key] || 0} 次打卡`;
    grid.appendChild(cell);
  }
}

// ---------- 提醒轮询 ----------
async function pollReminders() {
  if (!me || currentView !== 'today') return;
  try {
    const { due } = await api('/api/reminders');
    if (due.length === 0) return;
    const key = due.map(t => t.id).join(',');
    if (key === lastReminderKey) return;
    lastReminderKey = key;
    const box = $('reminderList');
    box.innerHTML = due.map(t => `
      <div class="reminder-item">
        <span class="r-time">${t.schedule_time}</span>${t.emoji || ''} ${esc(t.title)}
      </div>`).join('');
    $('reminderModal').classList.remove('hidden');
    beep();
  } catch (e) { /* 未登录时忽略 */ }
}

$('reminderOk').onclick = () => {
  $('reminderModal').classList.add('hidden');
  lastReminderKey = '';
  loadTasks();
};

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1100].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
  } catch (e) { /* 浏览器不支持 */ }
}

setInterval(pollReminders, 30000);
setInterval(() => { if (me && currentView === 'today') pollReminders(); }, 5000);

// ---------- 工具 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

checkAuth();
