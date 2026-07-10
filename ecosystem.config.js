module.exports = {
  apps: [
    {
      name: 'pitas-web',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      // Log config
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/web-error.log',
      out_file: 'logs/web-out.log',
      merge_logs: true,
      // Restart policy
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '5s',
    },
  ],
};
