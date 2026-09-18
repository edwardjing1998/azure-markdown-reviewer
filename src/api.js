let accessToken = sessionStorage.getItem("reviewer_access_token");
export async function login(username, password) {
  const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Login failed");
  accessToken = body.accessToken; sessionStorage.setItem("reviewer_access_token", accessToken); return body;
}
export function logout() { accessToken = null; sessionStorage.removeItem("reviewer_access_token"); }
export async function getJson(url) {
  const response = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

export const loadPages = () => getJson("/api/pages");
export const loadPage = markdownBlob => getJson(`/api/page?markdownBlob=${encodeURIComponent(markdownBlob)}`);
export const loadReviewUsers = () => getJson("/api/review/users");
export const loadReviewSessions = userId => getJson(`/api/review/users/${encodeURIComponent(userId)}/upload-sessions`);
export const loadReviewFolders = (userId, sessionId) => getJson(`/api/review/users/${encodeURIComponent(userId)}/upload-sessions/${encodeURIComponent(sessionId)}/folders`);
