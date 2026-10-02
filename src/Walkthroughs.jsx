/*
 * src/Walkthroughs.jsx  (kse-sentinel-ops, Oct 1 2026)
 *
 * WALKTHROUGHS (Owner and Reviewer): everyone who started a 14-day, read-only
 * walkthrough. Who they are and how to reach them, days left, last sign-in,
 * and the full requirements still owed before any upgrade. Extend or stop,
 * each with a reason, audited. Stopping signs the person out at once.
 * Backend: app/routers/walkthrough.py
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const PKT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });
const day = (iso) => (iso ? PKT.format(new Date(iso)) : "");
const STATUS = { ACTIVE: "Active", EXPIRED: "Ended (expired)", STOPPED: "Stopped", UPGRADED: "Upgraded" };

export default function Walkthroughs({ onEnded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("ACTIVE");
  const load = useCallback(() => {
    api("/api/v1/ops-console/walkthroughs").then((d) => { setData(d); setError(null); }).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);
  useEffect(load, [load]);
  const rows = (data?.walkthroughs || []).filter((w) => filter === "ALL" || w.status === filter);
  return (
    <section>
      <h1>Walkthroughs</h1>
      <p className="quiet">Instant, read-only, 14-day access to the showcase (PPL, OGDC, HBL, LUCK, JLICL). Upgrading to full access requires the full requirements, so these stay listed until then.</p>
      {error && <p className="msg bad">{error}</p>}
      {data && (
        <>
          <div className="figures">
            <div className="figure"><span className="n">{data.active}</span><span className="l">active walkthroughs</span></div>
            <div className="figure"><span className="n">{data.count}</span><span className="l">started in total</span></div>
            <div className="figure"><span className="n">{(data.walkthroughs || []).filter((w) => w.status === "ACTIVE" && w.days_left <= 3).length}</span><span className="l">ending within 3 days</span></div>
            <div className="figure"><span className="n">{(data.walkthroughs || []).filter((w) => w.status === "ACTIVE" && !w.last_login_at).length}</span><span className="l">never signed in</span></div>
          </div>
          <div className="tabs" style={{ marginTop: 18 }}>
            {[["ACTIVE", "Active"], ["EXPIRED", "Ended"], ["STOPPED", "Stopped"], ["ALL", "All"]].map(([v, l]) => (
              <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          {rows.length === 0 ? <p className="quiet">None.</p> : (
            <div className="scroll">
              <table className="plain">
                <thead><tr><th>Company and person</th><th>Contact</th><th>Started</th><th>Ends</th><th>Last sign-in</th><th>Status</th><th>Still owed</th><th></th></tr></thead>
                <tbody>{rows.map((w) => <Row key={w.signup_id} w={w} onEnded={onEnded} onChanged={load} />)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Row({ w, onEnded, onChanged }) {
  const [mode, setMode] = useState(null);
  const live = w.status === "ACTIVE";
  return (
    <>
      <tr>
        <td>{w.company_name}<span className="sub">{w.full_name}</span></td>
        <td><a href={`mailto:${w.email}`}>{w.email}</a><span className="sub"><a href={`tel:${w.mobile}`}>{w.mobile}</a></span></td>
        <td className="fig">{day(w.created_at)}</td>
        <td className="fig">{day(w.expires_at)}{live ? <span className="sub">{w.days_left} day{w.days_left === 1 ? "" : "s"} left</span> : null}</td>
        <td className="fig">{w.last_login_at ? day(w.last_login_at) : <span className="quiet">Never</span>}</td>
        <td className={live ? "" : "quiet"}>{STATUS[w.status] || w.status}{w.status_reason && !live ? <span className="sub">{w.status_reason}</span> : null}</td>
        <td><span title={(w.requirements_outstanding || []).join("\n")}>{(w.requirements_outstanding || []).length} item(s)</span></td>
        <td className="acts">
          {!mode && w.status !== "STOPPED" && w.status !== "UPGRADED" && <button className="link" onClick={() => setMode("extend")}>Extend</button>}
          {!mode && w.status !== "STOPPED" && w.status !== "UPGRADED" && <button className="link" onClick={() => setMode("stop")}>Stop</button>}
        </td>
      </tr>
      {mode && (
        <tr className="action-row"><td colSpan="8">
          <Action w={w} mode={mode} onEnded={onEnded} onDone={() => { setMode(null); onChanged(); }} onCancel={() => setMode(null)} />
        </td></tr>
      )}
    </>
  );
}

function Action({ w, mode, onEnded, onDone, onCancel }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState(null);
  const stop = mode === "stop";
  async function go() {
    if (stop && !confirm) { setConfirm(true); return; }
    setState({ busy: true });
    try {
      await api(`/api/v1/ops-console/walkthroughs/${w.signup_id}/${mode}`, { method: "POST", body: stop ? { reason } : { reason, days } });
      onDone();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <div className={`reasoned ${stop ? "danger" : ""}`}>
      <b>{stop ? "Stop" : "Extend"} the walkthrough for {w.company_name} ({w.full_name})</b>
      {!stop && (
        <label className="inline">Extend by
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      )}
      <label>Reason, recorded in the audit trail
        <textarea rows="2" value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(false); }}
                  placeholder={stop ? "For example: not a genuine prospect" : "For example: asked for more time to evaluate"} />
      </label>
      {confirm && <p className="confirm">Stop it now? {w.full_name} is signed out at once and cannot sign in again.</p>}
      <div className="row">
        <button className={stop ? "danger" : "primary"} disabled={reason.trim().length < 5 || state?.busy} onClick={go}>
          {state?.busy ? "Saving" : confirm ? "Yes, stop it" : stop ? "Stop walkthrough" : `Extend by ${days} days`}
        </button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </div>
  );
}
