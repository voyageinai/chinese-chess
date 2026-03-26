import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { wsHub } from "./src/server/ws";
import { resumeRunningTournaments } from "./src/server/tournament";
import { initLeaseManager } from "./src/server/distributed/lease-manager";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  wsHub.init(server);

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);

    // Initialize distributed worker support if configured
    if (process.env.WORKER_SECRET) {
      initLeaseManager();
      console.log("[distributed] Worker API enabled");
    }

    // Resume any tournaments that were interrupted by a restart
    resumeRunningTournaments(wsHub);
  });
});
