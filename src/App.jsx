import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LayoutCanvas from "./LayoutCanvas.jsx";
import { loadPage, loadPages } from "./api.js";

function stripFrontMatter(markdown) { return markdown.replace(/^---\s*[\s\S]*?\n---\s*/m, ""); }
function reviewKey(id) { return `markdown-review:${id}`; }

export default function App() {
  const [pages, setPages] = useState([]), [selected, setSelected] = useState(0), [page, setPage] = useState(null);
  const [mode, setMode] = useState("compare"), [showBoxes, setShowBoxes] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const current = pages[selected];
  useEffect(() => { loadPages().then(x => setPages(x.pages)).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!current) return; setLoading(true); setError(""); loadPage(current.markdownBlob).then(setPage).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [current?.markdownBlob]);
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
  function decide(value) { localStorage.setItem(reviewKey(current.id), JSON.stringify({ documentId: current.id, decision: value, reviewedAt: new Date().toISOString() })); setPage({ ...page }); }
  const decision = current ? JSON.parse(localStorage.getItem(reviewKey(current.id)) || "null") : null;
  if (error) return <main className="center"><div className="error"><h2>Unable to load documents</h2><p>{error}</p><p>Confirm Azure login/RBAC and the storage environment variables.</p></div></main>;
  if (!pages.length) return <main className="center">{loading ? "Loading Azure Storage…" : "No generated content.md files were found."}</main>;
  return <div className="app">
    <header><div><h1>Azure Markdown Page Review</h1><p>{current?.id}</p></div><div className={`badge ${decision?.decision?.toLowerCase()}`}>{decision?.decision || "NOT REVIEWED"}</div></header>
    <nav><select value={current.bookId} onChange={e => choose(e.target.value)}>{books.map(x => <option key={x}>{x}</option>)}</select><select value={current.chapterId} onChange={e => choose(current.bookId, e.target.value)}>{chapters.map(x => <option key={x}>{x}</option>)}</select><button disabled={selected === 0} onClick={() => setSelected(selected - 1)}>← Previous</button><span>{selected + 1} / {pages.length}</span><button disabled={selected === pages.length - 1} onClick={() => setSelected(selected + 1)}>Next →</button></nav>
    <div className="modes"><button className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")}>Original + Markdown</button><button className={mode === "markdown" ? "active" : ""} onClick={() => setMode("markdown")}>Markdown</button><button className={mode === "layout" ? "active" : ""} onClick={() => setMode("layout")}>Layout reconstruction</button><label><input type="checkbox" checked={showBoxes} onChange={e => setShowBoxes(e.target.checked)} /> Layout boxes</label></div>
    {loading || !page ? <main className="center">Loading page…</main> : <main className={`viewer mode-${mode}`}>
      {(mode === "compare") && <section className="pane"><h2>Original PNG</h2>{page.sourceUrl ? <img className="original" src={page.sourceUrl} alt="Original source page" /> : <div className="empty">No sourceBlob was found in Markdown front matter.</div>}</section>}
      {(mode === "compare" || mode === "markdown") && <section className="pane"><h2>Rendered Markdown</h2><article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ src, alt }) => <img src={page.figureUrls[src] || src} alt={alt || "Extracted figure"} /> }}>{stripFrontMatter(page.markdown)}</ReactMarkdown></article></section>}
      {mode === "layout" && <section className="pane layout-pane"><h2>layout.json + cropped figures</h2><LayoutCanvas data={page.layout} figureUrls={page.figureUrls} showBoxes={showBoxes} /></section>}
      <aside><h2>Automatic checks</h2>{checks && <><div className="metric"><span>Layout figures</span><b>{checks.layoutFigures}</b></div><div className="metric"><span>Linked images</span><b>{checks.linkedImages}</b></div><div className="metric"><span>Missing images</span><b className={checks.missingImages ? "bad" : "good"}>{checks.missingImages}</b></div><div className="metric"><span>Low-confidence words</span><b>{checks.lowConfidenceWords}</b></div></>}<p className="hint">Use the original image as ground truth. Approve only when text, math symbols, order and figures are complete.</p><div className="actions"><button className="approve" onClick={() => decide("APPROVED")}>Approve</button><button className="reject" onClick={() => decide("REJECTED")}>Reject</button></div></aside>
    </main>}
  </div>;
}
