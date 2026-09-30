/*
 * src/api.js  (kse-sentinel-ops, Sep 29 2026)
 *
 * The console's only link to the backend. Every call carries the platform
 * API key and the team member's sign-in token. The token lives in
 * sessionStorage: it is forgotten when the tab closes, and never shared with
 * the client Terminal. An expired token is renewed once through the secure
 * refresh cookie; if that fails the session ends and the sign-in screen shows.
 */
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";
const API_KEY = import.meta.env.VITE_API_KEY || "";
const TOKEN_KEY = "kse_ops_token";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export class SessionEnded extends Error {}

let token = sessionStorage.getItem(TOKEN_KEY);
function setToken(t) {
  token = t;
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export const hasSession = () => !!token;

// FastAPI returns either a sentence or a list of field errors.
function describe(detail, status) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => `${(d.loc || []).slice(-1)[0] || "field"}: ${d.msg}`).join("; ");
  }
  return `The request failed (${status}).`;
}

let refreshing = null;
function refreshOnce() {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "X-API-Key": API_KEY },
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const body = await r.json().catch(() => ({}));
        if (!body.access_token) return false;
        setToken(body.access_token);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api(path, { method = "GET", body } = {}) {
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "X-API-Key": API_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let res;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, "The server could not be reached. Check that the backend is running.");
  }
  if (res.status === 401 && token) {
    if (await refreshOnce()) res = await send();
    else {
      setToken(null);
      throw new SessionEnded("Your session has ended. Sign in again.");
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, describe(data.detail, res.status));
  return data;
}

export async function signIn(email, password) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError(0, "The server could not be reached. Check that the backend is running.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, describe(data.detail, res.status));
  setToken(data.access_token);
  try {
    return await api("/api/v1/ops-console/me");
  } catch (e) {
    // A valid client login that is not a team account must not stay signed in here.
    await signOut();
    throw e;
  }
}

export async function signOut() {
  try {
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "X-API-Key": API_KEY },
    });
  } catch { /* the local session ends either way */ }
  setToken(null);
}
