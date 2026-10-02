/*
 * src/Engineering.jsx  (kse-sentinel-ops, Oct 2 2026)
 *
 * ENGINEERING. Frontend engineers see their working setup: the development
 * repositories (which never deploy), the API documentation, the working rules,
 * and what they have been given. The Owner sees every engineer and records
 * their GitHub username and the access granted (granting itself happens on
 * GitHub). Every change is audited. Backend: app/routers/ops_engineering.py
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const PKT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });
const day = (iso) => (iso ? PKT.format(new Date(iso)) : "");

export default function Engineering({ onEnded, role }) {
  return role === "owner" ? <OwnerView onEnded={onEnded} /> : <EngineerView onEnded={onEnded} />;
}

function Resources({ res }) {
  return (
    <>
      <h2>Development repositories</h2>
      <p className="quiet">These never deploy anything. The Owner reviews your changes before they reach production.</p>
      <div className="scroll">
        <table className="plain">
          <thead><tr><th>Repository</th><th>What it holds</th></tr></thead>
          <tbody>{res.repositories.map((r) => (
            <tr key={r.key}><td><a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a></td><td>{r.what}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <h2>API documentation</h2>
      <p><a href={res.api_docs} target="_blank" rel="noopener noreferrer">{res.api_docs}</a></p>
      <h2>Working rules</h2>
      <ol className="rules">{res.rules.map((r) => <li key={r}>{r}</li>)}</ol>
    </>
  );
}

function EngineerView({ onEnded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api("/api/v1/ops-console/engineering/me").then(setData).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);
  if (error) return <section><h1>Engineering</h1><p className="msg bad">{error}</p></section>;
  if (!data) return <section><h1>Engineering</h1><p className="quiet">Loading</p></section>;
  const a = data.access;
  const item = (label, v, extra) => (
    <div className="figure"><span className={`n small-n ${v ? "up" : ""}`}>{v ? "Given" : "Not yet"}</span><span className="l">{label}{extra}</span></div>
  );
  return (
    <section>
      <h1>Engineering</h1>
      <p className="quiet">Your working setup as a frontend engineer. Ask the Owner if anything below is missing.</p>
      <div className="figures">
        {item("access to kse-sentinel-terminal-dev", a.terminal_dev, a.terminal_dev ? `, since ${day(a.terminal_dev.granted_at)}` : "")}
        {item("access to kse-sentinel-ops-dev", a.ops_dev, a.ops_dev ? `, since ${day(a.ops_dev.granted_at)}` : "")}
        {item("walkthrough test account", a.test_account_email, a.test_account_email ? `: ${a.test_account_email}` : "")}
        <div className="figure"><span className="n small-n">{a.github_username || "Not recorded"}</span><span className="l">your GitHub username on record</span></div>
      </div>
      <Resources res={data.resources} />
    </section>
  );
}

function OwnerView({ onEnded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api("/api/v1/ops-console/engineering/access").then(setData).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);
  useEffect(load, [load]);
  return (
    <section>
      <h1>Engineering</h1>
      <p className="quiet">
        Frontend engineers work in the private development repositories and never touch production. Grant access on GitHub
        (the development repository, then Settings, Collaborators), then record it here. Invite engineers from Team, with the role Frontend engineer.
      </p>
      {error && <p className="msg bad">{error}</p>}
      {data && (
        <>
          <h2>Engineers</h2>
          {data.engineers.length === 0 ? <p className="quiet">No frontend engineers yet.</p> : (
            <div className="scroll">
              <table className="plain">
                <thead><tr><th>Engineer</th><th>GitHub</th><th>terminal-dev</th><th>ops-dev</th><th>Test account</th><th>Last sign-in</th><th></th></tr></thead>
                <tbody>{data.engineers.map((e) => <EngineerRow key={e.user_id} e={e} onEnded={onEnded} onChanged={load} />)}</tbody>
              </table>
            </div>
          )}
          <Resources res={data.resources} />
        </>
      )}
    </section>
  );
}

function EngineerRow({ e, onEnded, onChanged }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ github_username: e.github_username || "", terminal_dev: !!e.terminal_dev, ops_dev: !!e.ops_dev, test_account_email: e.test_account_email || "", reason: "" });
  const [state, setState] = useState(null);
  const tick = (v) => (v ? <span className="up">Given {day(v.granted_at)}</span> : <span className="quiet">No</span>);
  async function save() {
    setState({ busy: true });
    try {
      await api(`/api/v1/ops-console/engineering/access/${e.user_id}`, { method: "PUT", body: f });
      setOpen(false); setState(null); onChanged();
    } catch (err) {
      if (!onEnded(err)) setState({ bad: err.message });
    }
  }
  return (
    <>
      <tr>
        <td>{e.email}{!e.is_active ? <span className="sub down">deactivated</span> : null}{!e.mfa_enabled ? <span className="sub">authenticator not set up yet</span> : null}</td>
        <td>{e.github_username ? <a href={`https://github.com/${e.github_username}`} target="_blank" rel="noopener noreferrer">{e.github_username}</a> : <span className="quiet">Not recorded</span>}</td>
        <td>{tick(e.terminal_dev)}</td>
        <td>{tick(e.ops_dev)}</td>
        <td>{e.test_account_email || <span className="quiet">None</span>}</td>
        <td className="fig">{e.last_login_at ? day(e.last_login_at) : <span className="quiet">Never</span>}</td>
        <td className="acts">{!open && <button className="link" onClick={() => setOpen(true)}>Record access</button>}</td>
      </tr>
      {open && (
        <tr className="action-row"><td colSpan="7">
          <div className="reasoned">
            <div className="form-grid">
              <label>GitHub username<input value={f.github_username} onChange={(ev) => setF({ ...f, github_username: ev.target.value })} placeholder="their-github-name" /></label>
              <label>Walkthrough test account (email)<input value={f.test_account_email} onChange={(ev) => setF({ ...f, test_account_email: ev.target.value })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={f.terminal_dev} onChange={(ev) => setF({ ...f, terminal_dev: ev.target.checked })} /> Added to kse-sentinel-terminal-dev on GitHub</label>
            <label className="check"><input type="checkbox" checked={f.ops_dev} onChange={(ev) => setF({ ...f, ops_dev: ev.target.checked })} /> Added to kse-sentinel-ops-dev on GitHub</label>
            <label>Reason, recorded in the audit trail
              <textarea rows="2" value={f.reason} onChange={(ev) => setF({ ...f, reason: ev.target.value })} placeholder="For example: joined to work on the Terminal's bank layouts" />
            </label>
            <div className="row">
              <button className="primary" disabled={f.reason.trim().length < 5 || state?.busy} onClick={save}>Save</button>
              <button className="link" onClick={() => setOpen(false)}>Cancel</button>
            </div>
            {state?.bad && <p className="msg bad">{state.bad}</p>}
          </div>
        </td></tr>
      )}
    </>
  );
}
