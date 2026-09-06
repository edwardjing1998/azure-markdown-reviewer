export async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

export const loadPages = () => getJson("/api/pages");
export const loadPage = markdownBlob => getJson(`/api/page?markdownBlob=${encodeURIComponent(markdownBlob)}`);
