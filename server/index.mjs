import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { assertAllowedBlob, configuredPrefix, downloadBlob, downloadText, listPages } from "./storage.mjs";

const app = express();
const port = Number(process.env.PORT || 8080);
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
// Local reviewer tokens map to the JWT issued by security-api.  The browser
// never needs to handle the security-api JWT directly.
const sessions = new Map();
const securityAuthUrl = (process.env.SECURITY_AUTH_URL || "").replace(/\/$/, "");
app.post("/api/auth/login", async (req, res, next) => {
  const { username, password } = req.body || {};
  if (!securityAuthUrl) return res.status(500).json({ error: "SECURITY_AUTH_URL is not configured" });
  try {
    const upstream = await fetch(`${securityAuthUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email: username, password }) });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !body.accessToken) return res.status(upstream.status === 401 ? 401 : 502).json({ error: body.message || body.error || "Security login failed" });
    const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, body.accessToken);
    res.json({ accessToken: token, username, user: body.user });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", (req, res) => { sessions.delete(String(req.headers.authorization || "").replace(/^Bearer\s+/i, "")); res.status(204).end(); });
app.use((req, res, next) => {
  if (
    req.path === "/api/health" ||
    req.path === "/api/auth/login" ||
    req.path === "/api/blob" ||
    req.path === "/api/source-blob" ||
    !req.path.startsWith("/api/")
  ) {
    return next();
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return sessions.has(token) ? next() : res.status(401).json({ error: "Authentication required" });
});

function reviewerToken(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

async function securityJson(req, path) {
  const securityToken = sessions.get(reviewerToken(req));
  if (!securityToken) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  const response = await fetch(`${securityAuthUrl}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${securityToken}` }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || "Security API request failed"), { statusCode: response.status });
  return body;
}

app.get("/api/health", (_req, res) => res.json({ status: "UP" }));
app.get("/api/pages", async (_req, res, next) => {
  try { res.json({ outputPrefix: configuredPrefix(), pages: await listPages() }); }
  catch (error) { next(error); }
});

// Read-only proxy endpoints for the first step of upload review.  Keeping
// these behind the reviewer session avoids exposing the security-api JWT or
// requiring browser CORS configuration.
app.get("/api/review/users", async (req, res, next) => {
  try { res.json(await securityJson(req, "/api/users")); } catch (error) { next(error); }
});
app.get("/api/review/users/:userId/upload-sessions", async (req, res, next) => {
  try { res.json(await securityJson(req, `/api/users/${encodeURIComponent(req.params.userId)}/upload-sessions`)); } catch (error) { next(error); }
});
app.get("/api/review/users/:userId/upload-sessions/:sessionId/folders", async (req, res, next) => {
  try {
    const body = await securityJson(req, `/api/users/${encodeURIComponent(req.params.userId)}/upload-sessions/${encodeURIComponent(req.params.sessionId)}/folders`);
    const images = Array.isArray(body.images) ? body.images : [];
    const folders = [...new Set(images.map(image => {
      const path = String(image.relativePath || image.name || "");
      const slash = path.lastIndexOf("/");
      return slash > 0 ? path.slice(0, slash) : "";
    }).filter(Boolean))].sort();
    res.json({ ...body, folders });
  } catch (error) { next(error); }
});
app.get("/api/review/users/:userId/upload-sessions/:sessionId/folder-content", async (req, res, next) => {
  try {
    const folder = String(req.query.folder || "").replace(/^\/+|\/+$/g, "");
    if (!folder) throw Object.assign(new Error("Folder is required"), { statusCode: 400 });
    const body = await securityJson(req, `/api/users/${encodeURIComponent(req.params.userId)}/upload-sessions/${encodeURIComponent(req.params.sessionId)}/folders`);
    const normalize = value => String(value || "").replace(/^\/+/, "").replace(/^generated\//, "").replace(/^source\//, "");
    const folderKey = normalize(folder);
    const pages = [];
    for (const candidate of await listPages()) {
      const markdown = await downloadText(candidate.markdownBlob);
      const sourceBlob = markdown.match(/^---[\s\S]*?^sourceBlob:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1] || "";
      const pageKey = normalize(candidate.id);
      const sourceKey = normalize(sourceBlob);
      if (pageKey === folderKey || pageKey.startsWith(`${folderKey}/`) || sourceKey === folderKey || sourceKey.startsWith(`${folderKey}/`)) pages.push(candidate);
    }
    res.json({ ...body, folder, pages });
  } catch (error) { next(error); }
});

app.get("/api/page", async (req, res, next) => {
  try {
    const markdownBlob = assertAllowedBlob(String(req.query.markdownBlob || ""));
    if (!markdownBlob.endsWith("/content.md")) throw new Error("Expected a content.md blob.");
    const base = markdownBlob.slice(0, -"content.md".length);
    const [markdown, layoutText] = await Promise.all([
      downloadText(markdownBlob),
      downloadText(`${base}layout.json`, true)
    ]);
    const layout = layoutText ? JSON.parse(layoutText) : null;
    const sourceBlob = markdown.match(/^---[\s\S]*?^sourceBlob:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1] || null;
    const imageLinks = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);
    const figureUrls = Object.fromEntries(imageLinks.map(link => [link, `/api/blob?name=${encodeURIComponent(new URL(link, `https://local/${base}`).pathname.slice(1))}`]));
    res.json({ markdownBlob, markdown, layout, sourceBlob, sourceUrl: sourceBlob ? `/api/source-blob?name=${encodeURIComponent(sourceBlob)}` : null, figureUrls });
  } catch (error) { next(error); }
});

app.get(["/api/blob", "/api/source-blob"], async (req, res, next) => {
  try {
    const requested = String(req.query.name || "");
    const name = req.path === "/api/source-blob" ? requested : assertAllowedBlob(requested);
    if (name.includes("..") || name.startsWith("/")) throw new Error("Invalid blob path.");
    const response = await downloadBlob(name, req.path === "/api/source-blob");
    res.set("Content-Type", response.contentType || "application/octet-stream");
    res.set("Cache-Control", "private, max-age=300");
    response.readableStreamBody.pipe(res);
  } catch (error) { next(error); }
});

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(dirname, "../dist");
app.use(express.static(dist));
app.get("/{*path}", (req, res, next) => req.path.startsWith("/api/") ? next() : res.sendFile(path.join(dist, "index.html")));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.statusCode === 404 ? 404 : error.message?.startsWith("Set ") ? 503 : 400;
  res.status(status).json({ error: error.message || "Request failed" });
});

app.listen(port, "0.0.0.0", () => console.log(`Azure Markdown Reviewer listening on ${port}`));
