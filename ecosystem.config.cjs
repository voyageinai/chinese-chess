// PM2 Ecosystem Configuration
// Master: pm2 start ecosystem.config.cjs --only cnchess
// Worker: pm2 start ecosystem.config.cjs --only cnchess-worker

module.exports = {
  apps: [
    // ── Master (Next.js + WebSocket + SQLite) ─────────────────────────
    {
      name: "cnchess",
      script: "npx",
      args: "tsx server.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      // PM2 config
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      watch: false,
      max_memory_restart: "1G",
    },

    // ── Worker (engine match executor) ────────────────────────────────
    {
      name: "cnchess-worker",
      script: "npx",
      args: "tsx worker/worker.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        // These MUST be set in .env or overridden:
        // MASTER_URL=http://<master-ip>:3002
        // WORKER_SECRET=<secret>
        // WORKER_ID=worker-1
        // MAX_CONCURRENT_MATCHES=2
      },
      // PM2 config
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: "512M",
    },
  ],
};
