import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LayoutCanvas from "./LayoutCanvas.jsx";
import { loadPage, loadPages, loadReviewFolderContent, loadReviewFolders, loadReviewSessions, loadReviewUsers, login, logout } from "./api.js";

function stripFrontMatter(markdown) { return markdown.replace(/^---\s*[\s\S]*?\n---\s*/m, ""); }
function reviewKey(id) { return `markdown-review:${id}`; }

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(sessionStorage.getItem("reviewer_access_token")));
  const [username, setUsername] = useState("admin"), [password, setPassword] = useState("ChangeMe123!"), [loginError, setLoginError] = useState("");
  const [pages, setPages] = useState([]), [selected, setSelected] = useState(0), [page, setPage] = useState(null);
  const [mode, setMode] = useState("compare"), [showBoxes, setShowBoxes] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [tab, setTab] = useState("documents");
  const [reviewUsers, setReviewUsers] = useState([]), [reviewUserId, setReviewUserId] = useState("");
  const [reviewSessions, setReviewSessions] = useState([]), [reviewSessionId, setReviewSessionId] = useState("");
  const [reviewFolders, setReviewFolders] = useState([]), [reviewFolder, setReviewFolder] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false), [reviewError, setReviewError] = useState("");
  const [reviewSelected, setReviewSelected] = useState(0);
  const [reviewContentPages, setReviewContentPages] = useState([]);
  const [reviewDiagnostics, setReviewDiagnostics] = useState(null);
  const [reviewImages, setReviewImages] = useState([]);
  const folderRequest = useRef(0);
  const current = pages[selected];
  const reviewPages = reviewContentPages;
  const activePages = tab === "uploads" ? reviewPages : pages;
  const activeSelected = tab === "uploads" ? reviewSelected : selected;
  const activeCurrent = activePages[activeSelected];
  useEffect(() => { if (!authenticated) return; loadPages().then(x => setPages(x.pages)).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [authenticated]);
  useEffect(() => { if (authenticated) loadReviewUsers().then(setReviewUsers).catch(e => setReviewError(e.message)); }, [authenticated]);
  useEffect(() => { if (!reviewUserId) { setReviewSessions([]); setReviewSessionId(""); return; } setReviewLoading(true); loadReviewSessions(reviewUserId).then(items => { setReviewSessions(items); setReviewSessionId(items[0]?.id || ""); }).catch(e => setReviewError(e.message)).finally(() => setReviewLoading(false)); }, [reviewUserId]);
  useEffect(() => {
    const requestId = ++folderRequest.current;
    setReviewFolders([]);
    setReviewFolder("");
    setReviewContentPages([]);
    setReviewDiagnostics(null);
    if (!reviewUserId || !reviewSessionId) { setReviewLoading(false); return; }
    setReviewLoading(true); setReviewError("");
    loadReviewFolders(reviewUserId, reviewSessionId).then(result => {
      if (requestId !== folderRequest.current) return;
      setReviewFolders(result.folders || []);
      // Do not reuse the previous session's folder. The user must choose
      // explicitly, which also makes the session/folder relationship clear.
    }).catch(e => { if (requestId === folderRequest.current) setReviewError(e.message); }).finally(() => { if (requestId === folderRequest.current) setReviewLoading(false); });
  }, [reviewUserId, reviewSessionId]);
  useEffect(() => {
    if (!reviewUserId || !reviewSessionId || !reviewFolder) { setReviewContentPages([]); setReviewImages([]); setReviewDiagnostics(null); setReviewSelected(0); return; }
    setReviewLoading(true); setReviewError("");
    loadReviewFolderContent(reviewUserId, reviewSessionId, reviewFolder)
      .then(result => { setReviewContentPages(result.pages || []); setReviewImages(result.images || []); setReviewDiagnostics(result); setReviewSelected(0); })
      .catch(e => { setReviewContentPages([]); setReviewImages([]); setReviewDiagnostics(null); setReviewError(e.message); })
      .finally(() => setReviewLoading(false));
  }, [reviewUserId, reviewSessionId, reviewFolder]);
  useEffect(() => { if (!activeCurrent) { setPage(null); return; } setLoading(true); setError(""); loadPage(activeCurrent.markdownBlob).then(setPage).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [activeCurrent?.markdownBlob]);
  const books = useMemo(() => [...new Set(pages.map(x => x.bookId))], [pages]);
  const chapters = useMemo(() => [...new Set(pages.filter(x => !current || x.bookId === current.bookId).map(x => x.chapterId))], [pages, current]);
  const checks = useMemo(() => {
    if (!page) return null;
    const layoutFigures = page.layout?.analyzeResult?.figures?.length || 0;
    const linkedImages = Object.keys(page.figureUrls || {}).length;
    const words = page.layout?.analyzeResult?.pages?.[0]?.words || [];
    return { layoutFigures, linkedImages, missingImages: Math.max(0, layoutFigures - linkedImages), lowConfidenceWords: words.filter(x => x.confidence < .95).length };
  }, [page]);
  function choose(book, chapter) { const index = pages.findIndex(x => x.bookId === book && (!chapter || x.chapterId === chapter)); if (index >= 0) setSelected(index); }
  function decide(value) { if (!activeCurrent) return; localStorage.setItem(reviewKey(activeCurrent.id), JSON.stringify({ documentId: activeCurrent.id, decision: value, reviewedAt: new Date().toISOString() })); setPage({ ...page }); }
  const decision = activeCurrent ? JSON.parse(localStorage.getItem(reviewKey(activeCurrent.id)) || "null") : null;
  if (!authenticated) return <main className="center"><form className="error" onSubmit={async e => { e.preventDefault(); try { await login(username, password); setAuthenticated(true); } catch (x) { setLoginError(x.message); } }}><h2>Sign in</h2><input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" /><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" /><button type="submit">Login</button>{loginError && <p>{loginError}</p>}</form></main>;
  if (error) return <main className="center"><div className="error"><h2>Unable to load documents</h2><p>{error}</p><p>Confirm Azure login/RBAC and the storage environment variables.</p></div></main>;
  return <div className="app">
    <header><div><h1>Azure Markdown Page Review</h1><p>{activeCurrent?.id || "Select uploaded content"}</p></div><button onClick={() => { logout(); setAuthenticated(false); }}>Logout</button><div className={`badge ${decision?.decision?.toLowerCase()}`}>{decision?.decision || "NOT REVIEWED"}</div></header>
    <div className="tabs"><button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>Document review</button><button className={tab === "uploads" ? "active" : ""} onClick={() => setTab("uploads")}>Uploaded content</button></div>
    {tab === "uploads" && <main className="upload-browser"><h2>Uploaded Content</h2><p className="hint">Select a user, upload session, and folder to review its generated pages.</p>{reviewError && <p className="error-text">{reviewError}</p>}<div className="selectors"><label>User<select value={reviewUserId} onChange={e => { setReviewUserId(e.target.value); setReviewSessionId(""); setReviewFolder(""); }}><option value="">Select a user…</option>{reviewUsers.map(user => <option key={user.id} value={user.id}>{user.name} — {user.email} ({user.role})</option>)}</select></label><label>Upload session<select value={reviewSessionId} disabled={!reviewUserId || reviewLoading} onChange={e => { setReviewSessionId(e.target.value); setReviewFolder(""); setReviewFolders([]); setReviewContentPages([]); setReviewImages([]); setReviewDiagnostics(null); }}><option value="">Select a session…</option>{reviewSessions.map(session => <option key={session.id} value={session.id}>{session.folderName} — {session.id}</option>)}</select></label><label>Folder<select value={reviewFolder} disabled={!reviewSessionId || reviewLoading || !reviewFolders.length} onChange={e => setReviewFolder(e.target.value)}><option value="">{reviewLoading ? "Loading folders…" : "Select a folder…"}</option>{reviewFolders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select></label></div>{reviewFolder && <div className="selection-summary"><b>Selected folder</b><span>{reviewFolder}</span><small>{reviewPages.length ? `${reviewPages.length} generated page(s) found.` : "No generated pages match this folder yet."}</small></div>}{reviewImages.length > 0 && <section className="uploaded-images"><h3>Original uploaded images ({reviewImages.length})</h3><div className="uploaded-image-grid">{reviewImages.map(image => <figure key={image.id || image.fileId || image.relativePath}><img src={image.blobUrl || image.url || ""} alt={image.name || image.originalFileName || image.relativePath || "Uploaded file"} /><figcaption>{image.relativePath || image.name || image.originalFileName}</figcaption></figure>)}</div></section>}{reviewDiagnostics && <details className="path-debug"><summary>Show path diagnostics</summary><p><b>Selected folder:</b> {reviewDiagnostics.folder}</p><p><b>Normalized folder:</b> {reviewDiagnostics.normalizedFolder}</p><p><b>Uploaded relative paths:</b></p><pre>{(reviewDiagnostics.uploadedRelativePaths || []).join("\n") || "(none)"}</pre><p><b>Matched generated pages:</b></p><pre>{(reviewDiagnostics.pages || []).map(item => item.markdownBlob).join("\n") || "(none)"}</pre><p><b>Generated candidates searched:</b></p><pre>{(reviewDiagnostics.candidates || []).map(item => `${item.id} | sourceBlob=${item.sourceBlob || "(none)"}`).join("\n") || "(none)"}</pre></details>}</main>}
    {activeCurrent && <nav><select value={activeCurrent.bookId} onChange={e => choose(e.target.value)}>{books.map(x => <option key={x}>{x}</option>)}</select><select value={activeCurrent.chapterId} onChange={e => choose(activeCurrent.bookId, e.target.value)}>{chapters.map(x => <option key={x}>{x}</option>)}</select><button disabled={activeSelected === 0} onClick={() => tab === "uploads" ? setReviewSelected(activeSelected - 1) : setSelected(activeSelected - 1)}>← Previous</button><span>{activeSelected + 1} / {activePages.length}</span><button disabled={activeSelected === activePages.length - 1} onClick={() => tab === "uploads" ? setReviewSelected(activeSelected + 1) : setSelected(activeSelected + 1)}>Next →</button></nav>}
    <div className="modes"><button className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")}>Original + Markdown</button><button className={mode === "markdown" ? "active" : ""} onClick={() => setMode("markdown")}>Markdown</button><button className={mode === "layout" ? "active" : ""} onClick={() => setMode("layout")}>Layout reconstruction</button><label><input type="checkbox" checked={showBoxes} onChange={e => setShowBoxes(e.target.checked)} /> Layout boxes</label></div>
    {loading || !page ? <main className="center">{activeCurrent ? "Loading page…" : "Select a user, session, and folder to begin."}</main> : <main className={`viewer mode-${mode}`}>
      {(mode === "compare") && <section className="pane"><h2>Original PNG</h2>{page.sourceUrl ? <img className="original" src={page.sourceUrl} alt="Original source page" /> : <div className="empty">No sourceBlob was found in Markdown front matter.</div>}</section>}
      {(mode === "compare" || mode === "markdown") && <section className="pane"><h2>Rendered Markdown</h2><article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ src, alt }) => <img src={page.figureUrls[src] || src} alt={alt || "Extracted figure"} /> }}>{stripFrontMatter(page.markdown)}</ReactMarkdown></article></section>}
      {mode === "layout" && <section className="pane layout-pane"><h2>layout.json + cropped figures</h2><LayoutCanvas data={page.layout} figureUrls={page.figureUrls} showBoxes={showBoxes} /></section>}
      <aside><h2>Automatic checks</h2>{checks && <><div className="metric"><span>Layout figures</span><b>{checks.layoutFigures}</b></div><div className="metric"><span>Linked images</span><b>{checks.linkedImages}</b></div><div className="metric"><span>Missing images</span><b className={checks.missingImages ? "bad" : "good"}>{checks.missingImages}</b></div><div className="metric"><span>Low-confidence words</span><b>{checks.lowConfidenceWords}</b></div></>}<p className="hint">Use the original image as ground truth. Approve only when text, math symbols, order and figures are complete.</p><div className="actions"><button className="approve" onClick={() => decide("APPROVED")}>Approve</button><button className="reject" onClick={() => decide("REJECTED")}>Reject</button></div></aside>
    </main>}
  </div>;
}
