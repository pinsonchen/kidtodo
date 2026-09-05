module.exports = {
  apps: [{
    name: 'kidtodo',
    script: 'server.js',
    cwd: '/opt/kidtodo',
    env: {
      NODE_ENV: 'production',
      PORT: 3100,
      // 生产密钥，服务器首配时已通过 .env 覆盖，此处为兜底
      JWT_SECRET: 'change-me-see-server-env'
    },
    max_memory_restart: '300M'
  }]
};
