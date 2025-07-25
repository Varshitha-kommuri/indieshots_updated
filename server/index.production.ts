import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import path from "path";

// Production logging function
function log(message: string, source = "express") {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${timestamp} [${source}] ${message}`);
}

// Production static file serving
function serveStatic(app: express.Express) {
  const publicPath = path.resolve(process.cwd(), "dist/public");
  app.use(express.static(publicPath));
  
  // Fallback for SPA routing
  app.get("*", (req: Request, res: Response, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }
    res.sendFile(path.join(publicPath, "index.html"));
  });
}

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Add health check endpoint FIRST - before any other routes
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  });
  
  // Add API health check
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  const server = await registerRoutes(app);
  
  // Start background cleanup job for scheduled account deletions
  const { startCleanupJob } = await import('./jobs/cleanup-scheduled-deletions');
  startCleanupJob();
  
  // Setup static file serving for production (AFTER health checks)
  serveStatic(app);
  
  const port = parseInt(process.env.PORT || "8080", 10);
  
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`External access: ${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'N/A'}`);
    log(`Local access: http://localhost:${port}`);
    log("Server bound to all interfaces (0.0.0.0:" + port + ")");
  });

  // Error handling
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    
    log(`Error ${status}: ${message}`);
    res.status(status).json({ message });
  });
})();
