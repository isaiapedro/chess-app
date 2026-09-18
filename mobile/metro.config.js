const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");

const API_ORIGIN = process.env.API_PROXY_ORIGIN || "http://127.0.0.1:8000";

function proxyToApi(req, res) {
  const target = new URL(req.url, API_ORIGIN);
  const headers = { ...req.headers, host: target.host };
  const proxyReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    console.error("[api-proxy]", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ detail: `API proxy error: ${err.message}` }));
  });
  req.pipe(proxyReq);
}

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      const url = req.url || "";
      if (url.startsWith("/api/") || url.startsWith("/health")) {
        proxyToApi(req, res);
        return;
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
