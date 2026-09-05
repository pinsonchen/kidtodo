const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const Store = require('./db');

// 加载同目录 .env（KEY=VALUE，生产密钥不入库）
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const app = express();
const PORT = process.env.PORT || 3100;
const JWT_SECRET = process.env.JWT_SECRET || 'kidtodo-dev-secret-change-me';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 数据库 ----------
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'kidtodo.db.json');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const store = new Store(DB_FILE);

// ---------- 时间方法模板 ----------
// 每个模板定义一组每日时段建议，用户可一键套用后个性化调整
const METHOD_TEMPLATES = {
  pomodoro: {
    id: 'pomodoro',
    name: '番茄钟学习法',
    emoji: '🍅',
    description: '专注 25 分钟 + 休息 5 分钟为一组，每 4 组休息 15-30 分钟。适合写作业、背课文等需要专注的任务。低年级可以先试「专注 15 分钟 + 休息 5 分钟」。',
    tips: [
      '番茄钟期间把玩具和手机放到看不见的地方',
      '一个番茄钟只做一件事，做完再打勾',
      '休息时站起来活动一下，不要继续看屏幕'
    ]
  },
  three_frogs: {
    id: 'three_frogs',
    name: '三只青蛙法',
    emoji: '🐸',
    description: '每天先挑出 3 件最重要的事（三只"青蛙"），先吃掉最难的那只。其余的事都安排在青蛙做完之后。',
    tips: [
      '前一天晚上想好明天的三只青蛙',
      '青蛙 = 最重要但可能有点难的事',
      '先吃掉最难的那只，一天都会变轻松'
    ]
  },
  four_quadrant: {
    id: 'four_quadrant',
    name: '四象限法',
    emoji: '📊',
    description: '把事情按「重要」和「紧急」分成四类：重要且紧急的马上做，重要不紧急的计划做，紧急不重要的快速做，不重要不紧急的少做或不做。',
    tips: [
      '写作业前先给任务分分类',
      '多花时间在「重要不紧急」的事上，比如每天阅读',
      '少安排「不重要不紧急」的事，比如长时间玩游戏'
    ]
  },
  checkin_streak: {
    id: 'checkin_streak',
    name: '打卡连续挑战',
    emoji: '🔥',
    description: '每天固定时间做同一件事并打卡，连续打卡会点亮火焰。中断了也没关系，重新开始挑战就好，目标是比上一次坚持得更久。',
    tips: [
      '把打卡任务安排在固定时间，比如每晚 8 点',
      '连续天数会记录火焰，断了重新挑战',
      '可以请爸爸妈妈一起监督或互相打卡'
    ]
  }
};

// 各模板一键生成的建议任务（每日）
const TEMPLATE_TASKS = {
  pomodoro: [
    { title: '番茄钟 1：完成一项作业', emoji: '🍅', time: '19:00', tip: '25 分钟专注，中途不离开座位' },
    { title: '休息 5 分钟：喝水、远眺', emoji: '💧', time: '19:25', tip: '看看窗外远处，保护眼睛' },
    { title: '番茄钟 2：继续作业或背书', emoji: '🍅', time: '19:30', tip: '开始前把桌面收拾干净' },
    { title: '打卡：今天完成了几组番茄钟？', emoji: '🔥', time: '20:30', tip: '记录下来，明天争取多一组' }
  ],
  three_frogs: [
    { title: '写下今天的 3 只青蛙（3 件最重要的事）', emoji: '🐸', time: '07:30', tip: '早上或前一天晚上写好' },
    { title: '先吃掉最大最难的青蛙', emoji: '💪', time: '19:00', tip: '最难的事最先做' },
    { title: '检查青蛙是否都吃掉了', emoji: '✅', time: '21:00', tip: '没吃完的青蛙会跳到明天哦' }
  ],
  four_quadrant: [
    { title: '给今天的任务分分类：重要/紧急', emoji: '📊', time: '07:30', tip: '重要且紧急的马上做' },
    { title: '做一件「重要不紧急」的事', emoji: '🌱', time: '20:00', tip: '比如阅读、锻炼，这些事最值得坚持' }
  ],
  checkin_streak: [
    { title: '每日阅读 20 分钟并打卡', emoji: '📖', time: '20:00', tip: '连续打卡点亮火焰' },
    { title: '今日打卡总结', emoji: '🔥', time: '21:00', tip: '看看自己坚持到第几天了' }
  ]
};

// ---------- 鉴权 ----------
function auth(req, res, next) {
  const token = req.cookies.kidtodo_token;
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('kidtodo_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
}

// ---------- 用户接口 ----------
app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 3-20 位字母、数字或下划线' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  const name = (displayName || username).trim().slice(0, 20);
  if (store.findUserByUsername(username)) {
    return res.status(400).json({ error: '这个用户名已经被使用啦，换一个试试' });
  }
  const user = store.createUser({
    username,
    password_hash: bcrypt.hashSync(String(password), 10),
    display_name: name
  });
  setAuthCookie(res, user);
  res.json({ ok: true, user: { username: user.username, displayName: user.display_name } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = store.findUserByUsername(username || '');
  if (!row || !bcrypt.compareSync(String(password || ''), row.password_hash)) {
    return res.status(401).json({ error: '用户名或密码不对哦' });
  }
  setAuthCookie(res, row);
  res.json({ ok: true, user: { username: row.username, displayName: row.display_name } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('kidtodo_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  const row = store.findUserById(req.user.id);
  if (!row) return res.status(401).json({ error: '用户不存在' });
  res.json({ user: { username: row.username, displayName: row.display_name, activeMethod: row.active_method } });
});

// ---------- 方法模板 ----------
app.get('/api/methods', auth, (req, res) => {
  res.json({ methods: Object.values(METHOD_TEMPLATES) });
});

app.post('/api/methods/apply', auth, (req, res) => {
  const { methodId } = req.body || {};
  const tpl = METHOD_TEMPLATES[methodId];
  if (!tpl) return res.status(400).json({ error: '没有这个方法模板' });
  store.setUserMethod(req.user.id, methodId);
  // 套用模板 = 按模板建议创建一组每日任务（同一模板不重复创建）
  if (store.tasksByMethodTag(req.user.id, methodId).length === 0) {
    for (const t of TEMPLATE_TASKS[methodId] || []) {
      store.createTask({
        user_id: req.user.id, title: t.title, emoji: t.emoji,
        schedule_time: t.time, repeat_type: 'daily', method_tag: methodId, tip: t.tip
      });
    }
  }
  res.json({ ok: true, method: tpl });
});

// ---------- 任务接口 ----------
app.get('/api/tasks', auth, (req, res) => {
  const targetDate = req.query.date || todayStr();
  const tasks = store.tasksOfUser(req.user.id).map(t => ({
    ...t,
    doneToday: store.isCheckedin(t.id, targetDate),
    streak: store.streakOf(t.id, targetDate)
  }));
  res.json({ tasks, date: targetDate });
});

app.post('/api/tasks', auth, (req, res) => {
  const { title, emoji, time, repeatType, tip } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '任务名称不能为空' });
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (time && !timeRe.test(time)) return res.status(400).json({ error: '时间格式应为 HH:MM' });
  const repeat = ['once', 'daily', 'weekdays', 'weekends'].includes(repeatType) ? repeatType : 'once';
  const task = store.createTask({
    user_id: req.user.id,
    title: String(title).trim().slice(0, 100),
    emoji: (emoji || '').slice(0, 8) || null,
    schedule_time: time && timeRe.test(time) ? time : null,
    repeat_type: repeat,
    tip: (tip || '').slice(0, 200) || null
  });
  res.json({ ok: true, id: task.id });
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const task = store.findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  const { title, emoji, time, repeatType, tip } = req.body || {};
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  store.updateTask(task, {
    title: title !== undefined ? String(title).trim().slice(0, 100) : undefined,
    emoji: emoji !== undefined ? ((emoji || '').slice(0, 8) || null) : undefined,
    schedule_time: time !== undefined ? (time && timeRe.test(time) ? time : null) : undefined,
    repeat_type: repeatType !== undefined ? repeatType : undefined,
    tip: tip !== undefined ? ((tip || '').slice(0, 200) || null) : undefined
  });
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  if (!store.findTask(req.params.id, req.user.id)) return res.status(404).json({ error: '任务不存在' });
  store.deleteTask(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- 打卡（再点一次可取消） ----------
app.post('/api/tasks/:id/checkin', auth, (req, res) => {
  const task = store.findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  const date = (req.body && req.body.date) || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式错误' });
  if (store.isCheckedin(task.id, date)) {
    store.removeCheckin(task.id, date);
    return res.json({ ok: true, done: false });
  }
  store.addCheckin(task.id, req.user.id, date);
  res.json({ ok: true, done: true, streak: store.streakOf(task.id, date) });
});

// ---------- 统计 ----------
app.get('/api/stats', auth, (req, res) => {
  res.json(store.checkinStats(req.user.id));
});

// ---------- 提醒轮询 ----------
// 前端每 30 秒调用一次，返回当前应提醒、且尚未完成/关闭的任务
app.get('/api/reminders', auth, (req, res) => {
  const now = new Date(Date.now() + 8 * 3600 * 1000); // 北京时间
  const hhmm = now.toISOString().slice(11, 16);
  const date = now.toISOString().slice(0, 10);
  const weekday = now.getUTCDay(); // 0=周日
  const due = store.tasksOfUser(req.user.id).filter(t => {
    if (!t.schedule_time || t.schedule_time > hhmm) return false;
    if (t.repeat_type === 'weekdays' && (weekday === 0 || weekday === 6)) return false;
    if (t.repeat_type === 'weekends' && weekday !== 0 && weekday !== 6) return false;
    if (store.isCheckedin(t.id, date)) return false;
    return !store.isReminded(t.id, date, hhmm);
  });
  for (const t of due) store.markReminded(t.id, date, hhmm);
  res.json({ due });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- SPA ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 北京时间
  return d.toISOString().slice(0, 10);
}

// 退出前确保持久化
process.on('SIGTERM', () => { store.flushSync(); process.exit(0); });
process.on('SIGINT', () => { store.flushSync(); process.exit(0); });

app.listen(PORT, '127.0.0.1', () => {
  console.log(`KidTodo listening on http://127.0.0.1:${PORT}`);
});
