/*
 * src/Team.jsx  (kse-sentinel-ops, Sep 30 2026; Oct 14 2026: step-up, password reset)
 *
 * TEAM: the Owner's page for the MZE Digital team. Invite people (one-time
 * link, valid 72 hours, passed on privately), change roles, deactivate or
 * reactivate, reset a lost authenticator, reset a password. Every action
 * needs a reason and is audited. Your own account cannot be changed here.
 *
 * Oct 14 2026: changing a role, resetting an authenticator and resetting a
 * password need a recent authenticator code (step-up). A password reset ends
 * the member's old password and sessions at once and gives a one-time link,
 * valid 30 minutes, shown here once: /reset-password#token=...
 * Backend: app/routers/ops_team.py
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { useAction } from "./StepUp.jsx";
import { ErrorLine, ShowOnce, when } from "./ui.jsx";

const ROLE = { owner: "Owner", reviewer: "Onboarding", walkthrough: "Walkthrough", support: "Support", finance: "Finance", frontend_engineer: "Frontend engineer" };
const ROLES = ["reviewer", "walkthrough", "support", "finance", "frontend_engineer"];
const ROLE_NOTE = {
  reviewer: "Onboarding: reviews signups, approves, rejects, runs trials; sees walkthroughs, the Data API and the secrets inventory.",
  walkthrough: "Walkthroughs only: follows up, extends or stops walkthrough accounts.",
  support: "Operations: the Engine section, the Data API (read, resume webhooks), and tickets once they exist.",
  finance: "Billing: invoices, bank statements, payment confirmation; Data API reads and licence approvals.",
  frontend_engineer: "Engineering page only: development repositories, test account. No business data.",
};
const STATE = { pending: "Waiting to be accepted", accepted: "Accepted", revoked: "Withdrawn", expired: "Expired" };

export default function Team({ onEnded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null);   // the one-time invitation link just created
  const [reset, setReset] = useState(null);   // the one-time password reset link just created
  const load = useCallback(() => {
    api("/api/v1/ops-console/team").then(setData).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);
  useEffect(load, [load]);

  return (
    <section className="team">
      <h1>Team</h1>
      <p className="quiet">People join by invitation only. They choose their own password and set up an authenticator at their first sign-in.</p>
      {error && <p className="msg bad">{error}</p>}
      <Invite onEnded={onEnded} onCreated={(link) => { setFresh(link); load(); }} />
      {fresh && <LinkBox link={fresh} onClose={() => setFresh(null)} />}
      {reset && (
        <ShowOnce title={`Password reset link for ${reset.who}`} value={reset.url} copyLabel="Copy link" onClose={() => setReset(null)}
                  notice={`Valid for 30 minutes${reset.expires ? `, until ${when(reset.expires)}` : ""}. Their old password and sessions have already stopped. Send it to them privately; they choose a new password, then sign in with their authenticator as usual.`} />
      )}
      {data && (
        <>
          <h2>Members</h2>
          <div className="scroll">
            <table className="plain">
              <thead><tr><th>Person</th><th>Role</th><th>Authenticator</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
              <tbody>
                {data.members.map((m) => (
                  <MemberRow key={m.user_id} m={m} onEnded={onEnded} onChanged={load}
                             onReset={(r) => { setReset({ ...r, who: m.name || m.email }); load(); }} />
                ))}
              </tbody>
            </table>
          </div>
          <h2>Invitations</h2>
          {data.invitations.length === 0 ? <p className="quiet">No invitations yet.</p> : (
            <div className="scroll">
              <table className="plain">
                <thead><tr><th>Invited</th><th>Role</th><th>State</th><th>Sent</th><th>Valid until</th><th></th></tr></thead>
                <tbody>
                  {data.invitations.map((i) => <InviteRow key={i.invite_id} i={i} onEnded={onEnded} onChanged={load} />)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Invite({ onEnded, onCreated }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("finance");
  const [reason, setReason] = useState("");
  const [state, setState] = useState(null);
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && reason.trim().length >= 5;
  async function send(e) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api("/api/v1/ops-console/team/invitations", { method: "POST", body: { email: email.trim(), full_name: name.trim() || null, team_role: role, reason } });
      onCreated({ url: `${window.location.origin}/join?token=${r.token}`, email: r.email, role: r.team_role, expires: r.expires_at });
      setEmail(""); setName(""); setReason(""); setState(null);
    } catch (err) {
      if (!onEnded(err)) setState({ bad: err.message });
    }
  }
  return (
    <form className="block invite" onSubmit={send}>
      <h2>Invite someone</h2>
      <div className="form-grid">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
        <label>Name (optional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
          </select>
          <span className="hint">{ROLE_NOTE[role]}</span>
        </label>
      </div>
      <div className="reasoned">
        <label>Reason, recorded in the audit trail
          <textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: joins to handle incoming payments" />
        </label>
        <div className="row"><button className="primary" disabled={!ok || state?.busy}>{state?.busy ? "Creating" : "Create invitation link"}</button></div>
        {state?.bad && <p className="msg bad">{state.bad}</p>}
      </div>
    </form>
  );
}

function LinkBox({ link, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="linkbox" role="status">
      <p><b>Invitation for {link.email}</b> ({ROLE[link.role]}). This link is shown <b>only once</b> and is valid until {when(link.expires)}.
        Send it to them privately, for example by WhatsApp or email.</p>
      <div className="row">
        <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
        <button type="button" className="primary" onClick={async () => { await navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
        <button type="button" className="link" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function MemberRow({ m, onEnded, onChanged, onReset }) {
  const [mode, setMode] = useState(null);
  const status = !m.is_active ? "Deactivated" : m.locked ? "Locked (failed attempts)" : "Active";
  return (
    <>
      <tr>
        <td>{m.name ? <>{m.name}<span className="sub">{m.email}</span></> : m.email}{m.is_you && <span className="sub">you</span>}</td>
        <td>{ROLE[m.team_role] || m.team_role}</td>
        <td>{m.mfa_enabled ? "Set up" : <span className="quiet">Not yet (at first sign-in)</span>}</td>
        <td className={!m.is_active ? "down" : ""}>{status}</td>
        <td className="fig">{m.last_login_at ? when(m.last_login_at) : <span className="quiet">Never</span>}</td>
        <td className="acts">
          {!m.is_you && !mode && (
            <>
              <button className="link" onClick={() => setMode("role")}>Change role</button>
              {m.is_active
                ? <button className="link" onClick={() => setMode("deactivate")}>Deactivate</button>
                : <button className="link" onClick={() => setMode("reactivate")}>Reactivate</button>}
              {m.mfa_enabled && <button className="link" onClick={() => setMode("mfa")}>Reset authenticator</button>}
              {m.is_active && <button className="link" onClick={() => setMode("password")}>Reset password</button>}
            </>
          )}
        </td>
      </tr>
      {mode && (
        <tr className="action-row">
          <td colSpan="6">
            <MemberAction m={m} mode={mode} onEnded={onEnded} onCancel={() => setMode(null)}
                          onDone={(r) => { setMode(null); if (mode === "password" && r?.token) onReset(r); else onChanged(); }} />
          </td>
        </tr>
      )}
    </>
  );
}

const ACTIONS = {
  role: { label: "Change role", path: "role", method: "PUT", danger: false, stepUp: true, hint: "Takes effect on their next request." },
  deactivate: { label: "Deactivate", path: "deactivate", method: "POST", danger: true, stepUp: false, hint: "Sign-in is refused at once and their sessions end. Their history stays." },
  reactivate: { label: "Reactivate", path: "reactivate", method: "POST", danger: false, stepUp: false, hint: "They can sign in again with their password and authenticator." },
  mfa: { label: "Reset authenticator", path: "reset-mfa", method: "POST", danger: true, stepUp: true, hint: "Their sessions end; at next sign-in they scan a new QR code." },
  password: { label: "Reset password", path: "password-reset", method: "POST", danger: true, stepUp: true,
    hint: "Their current password and sessions stop at once. You get a one-time link, valid 30 minutes, to send them; they choose a new password with it." },
};

function MemberAction({ m, mode, onEnded, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [role, setRole] = useState(m.team_role === "owner" ? "reviewer" : m.team_role);
  const [confirm, setConfirm] = useState(false);
  const [state, go] = useAction(onEnded);
  const cfg = ACTIONS[mode];
  const ok = reason.trim().length >= 5 && (mode !== "role" || role !== m.team_role);
  async function run() {
    if (cfg.danger && !confirm) { setConfirm(true); return; }
    const r = await go(() => api(`/api/v1/ops-console/team/members/${m.user_id}/${cfg.path}`, {
      method: cfg.method, body: mode === "role" ? { reason, team_role: role } : { reason },
    }), { sensitive: cfg.stepUp });
    if (r === undefined) return;
    if (mode === "password") {
      onDone({
        token: r.token,
        url: `${window.location.origin}/reset-password#token=${encodeURIComponent(r.token || "")}`,
        expires: r.expires_at,
      });
    } else onDone(r);
  }
  return (
    <div className={`reasoned ${cfg.danger ? "danger" : ""}`}>
      <b>{cfg.label}: {m.name || m.email}</b>
      <span className="hint">{cfg.hint}</span>
      {mode === "role" && (
        <label className="inline">New role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
          </select>
        </label>
      )}
      <label>Reason, recorded in the audit trail
        <textarea rows="2" value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(false); }} />
      </label>
      {cfg.stepUp && <span className="hint">Needs a recent authenticator code; you will be asked for one if it has expired.</span>}
      {confirm && <p className="confirm">Are you sure? {cfg.hint}</p>}
      <div className="row">
        <button className={cfg.danger ? "danger" : "primary"} disabled={!ok || state?.busy} onClick={run}>
          {state?.busy ? "Saving" : confirm ? `Yes, ${cfg.label.toLowerCase()}` : cfg.label}
        </button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
      <ErrorLine error={state?.error} />
    </div>
  );
}

function InviteRow({ i, onEnded, onChanged }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState(null);
  async function revoke() {
    setState({ busy: true });
    try {
      await api(`/api/v1/ops-console/team/invitations/${i.invite_id}/revoke`, { method: "POST", body: { reason } });
      onChanged();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <>
      <tr>
        <td>{i.name ? <>{i.name}<span className="sub">{i.email}</span></> : i.email}</td>
        <td>{ROLE[i.team_role] || i.team_role}</td>
        <td className={i.state === "pending" ? "" : "quiet"}>{STATE[i.state] || i.state}</td>
        <td className="fig">{when(i.created_at)}</td>
        <td className="fig">{i.state === "pending" ? when(i.expires_at) : ""}</td>
        <td className="acts">{i.state === "pending" && !open && <button className="link" onClick={() => setOpen(true)}>Withdraw</button>}</td>
      </tr>
      {open && (
        <tr className="action-row">
          <td colSpan="6">
            <div className="reasoned danger">
              <label>Reason, recorded in the audit trail
                <textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="row">
                <button className="danger" disabled={reason.trim().length < 5 || state?.busy} onClick={revoke}>Withdraw invitation</button>
                <button className="link" onClick={() => setOpen(false)}>Cancel</button>
              </div>
              {state?.bad && <p className="msg bad">{state.bad}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
