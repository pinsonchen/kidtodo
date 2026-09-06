// 轻量 JSON 文件数据层（单机小数据量，零原生依赖）
// 数据通过原子写入持久化，进程内持有全量数据
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { users: [], tasks: [], checkins: [], reminders: [], push_subscriptions: [] };
    if (fs.existsSync(file)) {
      try {
        this.data = Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (e) {
        fs.copyFileSync(file, file + '.corrupt.' + Date.now());
      }
    }
    this._saveTimer = null;
  }

  // 原子写入（合并 50ms 内的连续写，降低磁盘压力）
  _save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    }, 50);
  }

  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  nextId() {
    return crypto.randomInt(1, 2 ** 40);
  }

  // ---- 用户 ----
  createUser({ username, password_hash, display_name, pin_hash }) {
    const user = {
      id: this.nextId(), username, password_hash,
      display_name, pin_hash: pin_hash || null,
      active_method: null, created_at: new Date().toISOString()
    };
    this.data.users.push(user);
    this._save();
    return user;
  }

  findUserByUsername(username) {
    return this.data.users.find(u => u.username === username);
  }

  findUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  setUserMethod(id, method) {
    const u = this.findUserById(id);
    if (u) { u.active_method = method; this._save(); }
  }

  // ---- 推送订阅 ----
  savePushSubscription(user_id, subscription) {
    const key = subscription.endpoint;
    const exist = this.data.push_subscriptions.find(s => s.endpoint === key);
    if (exist) {
      exist.user_id = user_id;
      exist.keys = subscription.keys;
    } else {
      this.data.push_subscriptions.push({
        id: this.nextId(), user_id, endpoint: key,
        keys: subscription.keys, created_at: new Date().toISOString()
      });
    }
    this._save();
  }

  pushSubscriptionsOf(user_id) {
    return this.data.push_subscriptions.filter(s => s.user_id === user_id);
  }

  allPushSubscriptions() {
    return this.data.push_subscriptions;
  }

  removePushSubscription(endpoint) {
    this.data.push_subscriptions = this.data.push_subscriptions.filter(s => s.endpoint !== endpoint);
    this._save();
  }

  // ---- 任务 ----
  createTask({ user_id, title, emoji, schedule_time, repeat_type, method_tag, tip }) {
    const task = {
      id: this.nextId(), user_id, title,
      emoji: emoji || null, schedule_time: schedule_time || null,
      repeat_type: repeat_type || 'once', method_tag: method_tag || null,
      tip: tip || null, created_at: new Date().toISOString()
    };
    this.data.tasks.push(task);
    this._save();
    return task;
  }

  findTask(id, user_id) {
    return this.data.tasks.find(t => t.id === Number(id) && t.user_id === user_id);
  }

  tasksOfUser(user_id) {
    return this.data.tasks
      .filter(t => t.user_id === user_id)
      .sort((a, b) => {
        if (a.schedule_time && b.schedule_time) return a.schedule_time < b.schedule_time ? -1 : 1;
        if (a.schedule_time) return -1;
        if (b.schedule_time) return 1;
        return a.created_at < b.created_at ? -1 : 1;
      });
  }

  tasksByMethodTag(user_id, method_tag) {
    return this.data.tasks.filter(t => t.user_id === user_id && t.method_tag === method_tag);
  }

  updateTask(task, { title, emoji, schedule_time, repeat_type, tip }) {
    if (title !== undefined) task.title = title;
    if (emoji !== undefined) task.emoji = emoji;
    if (schedule_time !== undefined) task.schedule_time = schedule_time;
    if (repeat_type !== undefined) task.repeat_type = repeat_type;
    if (tip !== undefined) task.tip = tip;
    this._save();
  }

  deleteTask(id, user_id) {
    const idNum = Number(id);
    this.data.tasks = this.data.tasks.filter(t => !(t.id === idNum && t.user_id === user_id));
    this.data.checkins = this.data.checkins.filter(c => c.task_id !== idNum);
    this._save();
  }

  // ---- 打卡 ----
  isCheckedin(task_id, date) {
    return this.data.checkins.some(c => c.task_id === task_id && c.checkin_date === date);
  }

  addCheckin(task_id, user_id, date) {
    this.data.checkins.push({
      id: this.nextId(), task_id, user_id, checkin_date: date,
      created_at: new Date().toISOString()
    });
    this._save();
  }

  removeCheckin(task_id, date) {
    this.data.checkins = this.data.checkins.filter(c => !(c.task_id === task_id && c.checkin_date === date));
    this._save();
  }

  // 连续打卡天数（含 endDate 当天；若当天未打卡则从昨天往前数）
  streakOf(task_id, endDate) {
    let streak = 0;
    const d = new Date(endDate + 'T00:00:00Z');
    if (!this.isCheckedin(task_id, endDate)) d.setUTCDate(d.getUTCDate() - 1);
    while (this.isCheckedin(task_id, d.toISOString().slice(0, 10))) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return streak;
  }

  // ---- 统计 ----
  checkinStats(user_id, days = 30) {
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
    const byDate = {};
    for (const c of this.data.checkins) {
      if (c.user_id === user_id && c.checkin_date >= since) {
        byDate[c.checkin_date] = (byDate[c.checkin_date] || 0) + 1;
      }
    }
    const last30 = Object.entries(byDate)
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([date, n]) => ({ date, n }));
    const total = this.data.checkins.filter(c => c.user_id === user_id).length;
    return { last30, totalCheckins: total };
  }

  // ---- 提醒 ----
  isReminded(task_id, date, time) {
    return this.data.reminders.some(r => r.task_id === task_id && r.remind_date === date && r.remind_time === time);
  }

  markReminded(task_id, date, time) {
    this.data.reminders.push({ id: this.nextId(), task_id, remind_date: date, remind_time: time });
    // 提醒记录只需保留 7 天
    const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
    this.data.reminders = this.data.reminders.filter(r => r.remind_date >= cutoff);
    this._save();
  }
}

module.exports = Store;
