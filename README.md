# KidTodo 🎒

给小学生的 Todo 提醒工具：https://todo.pinsonbot.com

## 功能

- **用户账号**：注册/登录，数据按用户隔离
- **Todo + 时间计划**：任务可设置提醒时间（HH:MM）与重复规则（只一次 / 每天 / 上学日 / 周末）
- **及时提醒**：页面打开时每 30 秒轮询提醒接口，到点弹窗 + 提示音，完成打卡后自动消失
- **打卡与激励**：一键打卡（再点可取消），自动统计连续打卡天数（🔥 streak）
- **时间管理方法模板**：内置番茄钟 🍅、三只青蛙 🐸、四象限 📊、打卡连续挑战 🔥 四种适合小学生的方法，一键套用即可生成一组建议的每日任务，之后可自由修改
- **成就面板**：累计打卡、近 30 天热力图

## 技术栈

- Node.js（Express，零构建步骤）
- JSON 文件存储（`data/kidtodo.db.json`，原子写入）
- JWT Cookie 会话
- PM2 守护 + Nginx 反代 + Let's Encrypt HTTPS

## 部署

服务器：`42.121.218.132`（pinsonbot.com），应用目录 `/opt/kidtodo`，端口 `3100`（仅监听 127.0.0.1）。

推送到 `main` 分支后 GitHub Actions 自动 SSH 部署（拉代码 → 安装依赖 → 重启 PM2）。

所需 GitHub Secrets：`SERVER_HOST`、`SERVER_USER`、`SERVER_PASSWORD`。

### 手动部署

```bash
ssh root@42.121.218.132
cd /opt/kidtodo && git pull && npm install --omit=dev && pm2 restart kidtodo
```

## 本地开发

```bash
npm install
npm start   # http://127.0.0.1:3100
```
