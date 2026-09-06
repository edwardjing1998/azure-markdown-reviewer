import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAllowedBlob, configuredPrefix, downloadBlob, downloadText, listPages } from "./storage.mjs";

const app = express();
const port = Number(process.env.PORT || 8080);
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => res.json({ status: "UP" }));
app.get("/api/pages", async (_req, res, next) => {
  try { res.json({ outputPrefix: configuredPrefix(), pages: await listPages() }); }
  catch (error) { next(error); }
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
