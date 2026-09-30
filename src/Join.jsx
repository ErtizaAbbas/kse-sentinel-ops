/*
 * src/Join.jsx  (kse-sentinel-ops, Sep 30 2026)
 *
 * The page an invitation link opens: /join?token=...
 * Shows who the invitation is for, lets the person choose their own password,
 * then sends them to sign in, where they set up their authenticator.
 */
import { useEffect, useState } from "react";
import { acceptInvite, inviteInfo } from "./api.js";

const ROLE = { reviewer: "Reviewer", support: "Support", finance: "Finance" };

export default function Join({ onDone }) {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError("This link is incomplete. Ask for a new invitation."); return; }
    inviteInfo(token).then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  const local = (info?.email || "").split("@")[0].toLowerCase();
  const problems = [
    pw.length > 0 && pw.length < 12 && "At least 12 characters.",
    local.length >= 4 && pw.toLowerCase().includes(local) && "Must not contain your email name.",
    pw2.length > 0 && pw !== pw2 && "The two passwords differ.",
  ].filter(Boolean);
  const ok = pw.length >= 12 && pw === pw2 && problems.length === 0;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(token, pw);
      setDone(true);
      window.history.replaceState(null, "", "/");   // the one-time link leaves the address bar
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const brand = (
    <div className="brand dark">
      <span className="brand-mark">KSE Sentinel</span>
      <span className="brand-name">Operations</span>
    </div>
  );
  return (
    <div className="signin">
      <form onSubmit={submit}>
        {brand}
        {done ? (
          <>
            <p className="lede">Your account is ready.</p>
            <p>Sign in with <b>{info.email}</b> and your new password. You will then set up your authenticator app
              (Google or Microsoft Authenticator), so have your phone ready.</p>
            <button type="button" className="primary" onClick={onDone}>Go to sign-in</button>
          </>
        ) : !info ? (
          error ? <p className="msg bad" role="alert">{error}</p> : <p className="quiet">Checking your invitation</p>
        ) : (
          <>
            <p className="lede">You have been invited to join the MZE Digital team.</p>
            <dl className="facts compact">
              <div className="fact"><dt>Email</dt><dd>{info.email}</dd></div>
              <div className="fact"><dt>Role</dt><dd>{ROLE[info.team_role] || info.team_role}</dd></div>
            </dl>
            <label>Choose a password
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            </label>
            <label>Repeat it
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </label>
            <span className="hint">At least 12 characters. A password manager makes this easy.</span>
            {problems.map((p) => <span key={p} className="hint bad-text">{p}</span>)}
            {error && <p className="msg bad" role="alert">{error}</p>}
            <button className="primary" disabled={!ok || busy}>{busy ? "Creating your account" : "Create my account"}</button>
          </>
        )}
      </form>
    </div>
  );
}
