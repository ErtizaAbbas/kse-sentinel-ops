/*
 * src/api.js  (kse-sentinel-ops, Sep 29 2026; Oct 14 2026: problem details, step-up, team password reset)
 *
 * The console's only link to the backend. Every call carries the platform
 * API key and the team member's sign-in token. The token lives in
 * sessionStorage: it is forgotten when the tab closes, and never shared with
 * the client Terminal. An expired token is renewed once through the secure
 * refresh cookie; if that fails the session ends and the sign-in screen shows.
 *
 * Errors (Oct 14 2026): newer routes answer RFC 9457 problem details
 * {type, title, status, code, detail, instance}; older routes answer {detail};
 * FastAPI body validation answers {detail: [...]}. All three become an ApiError
 * carrying status, message, code (when there is one), the request id and the body.
 */
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";
const API_KEY = import.meta.env.VITE_API_KEY || "";
const TOKEN_KEY = "kse_ops_token";

export class ApiError extends Error {
  constructor(status, message, { code = null, requestId = null, body = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.body = body;
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

// One reader for every error shape the backend can send.
function failure(res, data) {
  const inner = data && data.detail && typeof data.detail === "object" && !Array.isArray(data.detail) ? data.detail : null;
  let code = data?.code || data?.slug || inner?.code || inner?.slug || null;
  let message;
  if (typeof data?.detail === "string" && data.detail) message = data.detail;
  else if (Array.isArray(data?.detail)) message = describe(data.detail, res.status);
  else if (inner && (inner.detail || inner.message)) message = inner.detail || inner.message;
  else if (data?.title) message = data.title;
  else message = `The request failed (${res.status}).`;
  // Older routes that gained step-up may say so in words only.
  if (!code && res.status === 403 && /step-up|recent authenticator code/i.test(message)) code = "step-up-required";
  const requestId = res.headers.get("X-Request-Id") || data?.request_id || inner?.request_id || null;
  return new ApiError(res.status, message, { code, requestId, body: data });
}

const unreachable = (method) =>
  new ApiError(0, method && method !== "GET"
    ? "The server could not be reached. If this was a change, check the audit log before repeating it."
    : "The server could not be reached. Check that the backend is running.", { code: "network" });

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
      cache: "no-store",
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
    throw unreachable(method);
  }
  if (res.status === 401 && token) {
    let ok = false;
    try { ok = await refreshOnce(); } catch { ok = false; }
    if (ok) {
      try { res = await send(); } catch { throw unreachable(method); }
    } else {
      setToken(null);
      throw new SessionEnded("Your session has ended. Sign in again.");
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res, data);
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
    throw unreachable("GET");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res, data);
  // Team MFA (Sep 30 2026): team accounts get a short-lived challenge, not a session.
  if (data.status === "mfa_required") return { mfa: { token: data.mfa_token, setup: !!data.mfa_setup_required } };
  // A client account (no challenge) is not a team account: never keep its session here.
  setToken(data.access_token);
  await signOut();
  throw new ApiError(403, "This is not a team account. The console is for the MZE Digital team only.");
}

async function authPost(path, body) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "The server could not be reached. Try again shortly.", { code: "network" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res, data);
  return data;
}

// First sign-in: create the authenticator secret (returned once, for the QR code).
export const setupMfa = (mfaToken) => authPost("/api/v1/auth/mfa/setup", { mfa_token: mfaToken });

// Second step of every sign-in: the 6-digit code. Opens the session, then confirms the team role.
export async function verifyMfa(mfaToken, code) {
  const data = await authPost("/api/v1/auth/mfa/verify", { mfa_token: mfaToken, code });
  setToken(data.access_token);
  try {
    return await api("/api/v1/ops-console/me");
  } catch (e) {
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

// Team signup by invitation (Sep 30 2026): the invitee is not signed in.
export async function inviteInfo(token) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/v1/auth/team-invite/${encodeURIComponent(token)}`, { headers: { "X-API-Key": API_KEY } });
  } catch {
    throw new ApiError(0, "The server could not be reached. Try again shortly.", { code: "network" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res, data);
  return data;
}
export const acceptInvite = (token, password) => authPost("/api/v1/auth/team-invite/accept", { token, password });

// Step-up (Oct 14 2026): a fresh authenticator code before sensitive actions.
// The server keeps the time; the console only asks and displays.
export const stepUpStatus = () => api("/api/v1/ops/step-up");
export const stepUpVerify = (code) => api("/api/v1/ops/step-up", { method: "POST", body: { code } });

// Team password reset by one-time link (Oct 14 2026): the member is signed out.
// The token always travels in the request body, never in a URL path.
export const teamResetCheck = (token) => authPost("/api/v1/auth/team-password-reset/check", { token });
export const teamResetAccept = (token, password) => authPost("/api/v1/auth/team-password-reset/accept", { token, password });
