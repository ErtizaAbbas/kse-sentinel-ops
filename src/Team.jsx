/*
 * src/Team.jsx  (kse-sentinel-ops, Sep 30 2026)
 *
 * TEAM: the Owner's page for the MZE Digital team. Invite people (one-time
 * link, valid 72 hours, passed on privately), change roles, deactivate or
 * reactivate, reset a lost authenticator. Every action needs a reason and is
 * audited. Your own account cannot be changed here.
 * Backend: app/routers/ops_team.py
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const ROLE = { owner: "Owner", reviewer: "Reviewer", support: "Support", finance: "Finance" };
const ROLE_NOTE = {
  reviewer: "Onboarding: reviews signups, approves, rejects, runs trials.",
  support: "Operations: the Engine section, and tickets once they exist.",
  finance: "Payments, once the payments section exists.",
};
const STATE = { pending: "Waiting to be accepted", accepted: "Accepted", revoked: "Withdrawn", expired: "Expired" };
const PKT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const when = (iso) => (iso ? `${PKT.format(new Date(iso))} PKT` : "");

export default function Team({ onEnded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null);   // the one-time link just created
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
      {data && (
        <>
          <h2>Members</h2>
          <div className="scroll">
            <table className="plain">
              <thead><tr><th>Person</th><th>Role</th><th>Authenticator</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
              <tbody>
                {data.members.map((m) => (
                  <MemberRow key={m.user_id} m={m} onEnded={onEnded} onChanged={load} />
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
            {["reviewer", "support", "finance"].map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
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

function MemberRow({ m, onEnded, onChanged }) {
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
            </>
          )}
        </td>
      </tr>
      {mode && (
        <tr className="action-row">
          <td colSpan="6">
            <MemberAction m={m} mode={mode} onEnded={onEnded} onDone={() => { setMode(null); onChanged(); }} onCancel={() => setMode(null)} />
          </td>
        </tr>
      )}
    </>
  );
}

function MemberAction({ m, mode, onEnded, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [role, setRole] = useState(m.team_role === "owner" ? "reviewer" : m.team_role);
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState(null);
  const cfg = {
    role: { label: "Change role", path: "role", method: "PUT", danger: false, hint: "Takes effect on their next request." },
    deactivate: { label: "Deactivate", path: "deactivate", method: "POST", danger: true, hint: "Sign-in is refused at once and their sessions end. Their history stays." },
    reactivate: { label: "Reactivate", path: "reactivate", method: "POST", danger: false, hint: "They can sign in again with their password and authenticator." },
    mfa: { label: "Reset authenticator", path: "reset-mfa", method: "POST", danger: true, hint: "Their sessions end; at next sign-in they scan a new QR code." },
  }[mode];
  const ok = reason.trim().length >= 5 && (mode !== "role" || role !== m.team_role);
  async function go() {
    if (cfg.danger && !confirm) { setConfirm(true); return; }
    setState({ busy: true });
    try {
      await api(`/api/v1/ops-console/team/members/${m.user_id}/${cfg.path}`, { method: cfg.method, body: mode === "role" ? { reason, team_role: role } : { reason } });
      onDone();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <div className={`reasoned ${cfg.danger ? "danger" : ""}`}>
      <b>{cfg.label}: {m.name || m.email}</b>
      <span className="hint">{cfg.hint}</span>
      {mode === "role" && (
        <label className="inline">New role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {["reviewer", "support", "finance"].map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
          </select>
        </label>
      )}
      <label>Reason, recorded in the audit trail
        <textarea rows="2" value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(false); }} />
      </label>
      {confirm && <p className="confirm">Are you sure? {cfg.hint}</p>}
      <div className="row">
        <button className={cfg.danger ? "danger" : "primary"} disabled={!ok || state?.busy} onClick={go}>
          {state?.busy ? "Saving" : confirm ? `Yes, ${cfg.label.toLowerCase()}` : cfg.label}
        </button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
      {state?.bad && <p className="msg bad">{state.bad}</p>}
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
