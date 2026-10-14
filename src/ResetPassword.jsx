/*
 * src/ResetPassword.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * The page a team password reset link opens: /reset-password#token=...
 * The token sits in the address fragment (never sent to any server by the
 * browser), is removed from the address bar at once, and travels only in the
 * request body. A token can also be pasted. The member is signed out.
 * Backend: POST /api/v1/auth/team-password-reset/check and /accept.
 * Password standard: 12 to 128 characters, not containing the email name.
 */
import { useEffect, useState } from "react";
import { teamResetAccept, teamResetCheck } from "./api.js";
import { ErrorLine } from "./ui.jsx";

function tokenFrom(text) {
  const s = String(text || "").trim();
  const m = /[#?&]token=([^&\s#]+)/.exec(s);
  try { return decodeURIComponent(m ? m[1] : s); } catch { return m ? m[1] : s; }
}

// Read once, when the page loads (not during render, which may run twice).
const INITIAL = window.location.pathname === "/reset-password" && /token=/.test(window.location.hash)
  ? tokenFrom(window.location.hash) : "";

export default function ResetPassword({ onDone }) {
  const [token, setToken] = useState(INITIAL);
  // The token leaves the address bar and the browser history at once.
  useEffect(() => { window.history.replaceState(null, "", "/reset-password"); }, []);
  const [pasted, setPasted] = useState("");
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    setError(null);
    setInfo(null);
    teamResetCheck(token).then((r) => setInfo(r || {})).catch((e) => { setError(e); setToken(""); });
  }, [token]);

  const email = info?.email || "";
  const local = email.split("@")[0].toLowerCase();
  const problems = [
    pw.length > 0 && pw.length < 12 && "At least 12 characters.",
    pw.length > 128 && "At most 128 characters.",
    local.length >= 3 && pw.toLowerCase().includes(local) && "Must not contain your email name.",
    pw2.length > 0 && pw !== pw2 && "The two passwords differ.",
  ].filter(Boolean);
  const ok = pw.length >= 12 && pw.length <= 128 && pw === pw2 && problems.length === 0;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await teamResetAccept(token, pw);
      setPw(""); setPw2(""); setToken("");
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const leave = () => { window.history.replaceState(null, "", "/"); onDone(); };
  const brand = (
    <div className="brand dark">
      <span className="brand-mark">KSE Sentinel</span>
      <span className="brand-name">Operations</span>
    </div>
  );

  return (
    <div className="signin">
      <form onSubmit={submit} onReset={(e) => e.preventDefault()}>
        {brand}
        {done ? (
          <>
            <p className="lede">Your new password is set.</p>
            <p>Sign in{email ? <> with <b>{email}</b></> : ""} and your new password, then enter the code from your authenticator app as usual.</p>
            <button type="button" className="primary" onClick={leave}>Go to sign-in</button>
          </>
        ) : !token ? (
          <>
            <p className="lede">Choose a new password</p>
            <ErrorLine error={error} />
            <p className="hint">Open the reset link you were sent, or paste it (or the code in it) here. Links are valid for 30 minutes and work once.</p>
            <label>Reset link or code
              <input value={pasted} onChange={(e) => setPasted(e.target.value)} autoComplete="off" spellCheck="false" />
            </label>
            <button type="button" className="primary" disabled={!tokenFrom(pasted)} onClick={() => { setToken(tokenFrom(pasted)); setPasted(""); }}>Continue</button>
            <button type="button" className="link" onClick={leave}>Back to sign-in</button>
          </>
        ) : !info ? (
          <p className="quiet">Checking your link</p>
        ) : (
          <>
            <p className="lede">Choose a new password{email ? <> for <b>{email}</b></> : ""}.</p>
            {email && <input type="email" value={email} autoComplete="username" readOnly hidden />}
            <label>New password
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
            </label>
            <label>Repeat it
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </label>
            <span className="hint">12 to 128 characters, not containing your email name. A password manager makes this easy.</span>
            {problems.map((p) => <span key={p} className="hint bad-text">{p}</span>)}
            <ErrorLine error={error} />
            <button className="primary" disabled={!ok || busy}>{busy ? "Saving" : "Set my new password"}</button>
          </>
        )}
      </form>
    </div>
  );
}
