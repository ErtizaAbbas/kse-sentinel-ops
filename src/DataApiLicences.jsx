/*
 * src/DataApiLicences.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * DATA API: data sets, their licence status, and the two-person switch.
 *
 * The Owner requests a licence change (step-up); it waits for a different
 * person in Onboarding or Finance (or another Owner) to approve (step-up) or
 * reject. A request expires if nobody decides. Nobody approves their own
 * request: the console hides the button and the Data API refuses it.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { can } from "./roles.js";
import { useAction } from "./StepUp.jsx";
import { Badge, ErrorLine, ReasonBox, when } from "./ui.jsx";

const D = "/api/v1/ops/dapi";

export const LICENCE = {
  owned: ["Owned", "good", "Our own work; may be sold."],
  licensed: ["Licensed", "good", "Licensed from its source for redistribution."],
  derived_pending_terms: ["Derived, terms pending", "warn", "Derived from PSX data; redistribution terms not yet confirmed."],
  blocked: ["Blocked", "bad", "Not served to any client."],
};
const licenceLabel = (s) => LICENCE[s]?.[0] || s;
const FILTERS = [["pending", "Waiting for a decision"], ["", "All"], ["approved", "Approved"], ["rejected", "Rejected"], ["expired", "Expired"]];
const emailOf = (who) => String(who || "").replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();

export default function Licences({ me, onEnded, onChanged }) {
  const [sets, setSets] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null);           // data set key being changed
  const [sent, setSent] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [reqs, setReqs] = useState(null);
  const [reqError, setReqError] = useState(null);

  const loadSets = useCallback(() => {
    api(`${D}/datasets`).then((d) => setSets(d.items || [])).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [onEnded]);
  const loadReqs = useCallback(() => {
    setReqError(null);
    api(`${D}/approvals${filter ? `?status=${filter}` : ""}`).then((d) => setReqs(d.items || [])).catch((e) => { if (!onEnded(e)) setReqError(e); });
  }, [filter, onEnded]);
  useEffect(loadSets, [loadSets]);
  useEffect(() => { setReqs(null); loadReqs(); }, [loadReqs]);
  const changed = () => { loadSets(); loadReqs(); onChanged(); };
  const pendingFor = (key) => (reqs || []).some((r) => r.status === "pending" && r.target === key);

  return (
    <>
      <h2 className="first">Data sets</h2>
      <p className="hint">A licence change takes effect only after a second person approves it.</p>
      <ErrorLine error={error} />
      {sent && <p className="msg good">{sent}</p>}
      {!sets && !error && <p className="quiet">Loading</p>}
      {sets && (
        <div className="scroll">
          <table className="plain">
            <thead><tr><th>Data set</th><th>Licence</th><th>Served</th><th className="r">Cost weight</th><th className="r">Version</th><th></th></tr></thead>
            <tbody>
              {sets.map((s) => (
                <DatasetRow key={s.key} s={s} me={me} open={mode === s.key} pending={filter === "pending" && pendingFor(s.key)}
                            onOpen={() => { setSent(null); setMode(s.key); }} onCancel={() => setMode(null)} onEnded={onEnded}
                            onDone={(msg) => { setMode(null); setSent(msg); changed(); }} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Licence requests</h2>
      <div className="tabs sub-tabs">
        {FILTERS.map(([v, l]) => <button key={v || "all"} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>)}
      </div>
      <ErrorLine error={reqError} />
      {!reqs && !reqError && <p className="quiet">Loading</p>}
      {reqs && (reqs.length === 0 ? <p className="quiet">{filter === "pending" ? "Nothing is waiting for a decision." : "No requests."}</p> : (
        <div className="scroll">
          <table className="plain">
            <thead><tr><th>Requested</th><th>Change</th><th>Asked by, and why</th><th>Status</th><th>Decision</th><th></th></tr></thead>
            <tbody>
              {reqs.map((r) => <RequestRow key={r.id} r={r} me={me} onEnded={onEnded} onDone={changed} />)}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function DatasetRow({ s, me, open, pending, onOpen, onCancel, onEnded, onDone }) {
  const options = Object.keys(LICENCE).filter((k) => k !== s.licence_status);
  const [to, setTo] = useState(options[0]);
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  const [lbl, tone, note] = LICENCE[s.licence_status] || [s.licence_status, "", ""];
  return (
    <>
      <tr>
        <td>{s.title}<span className="sub fig">{s.key}</span></td>
        <td><Badge tone={tone}>{lbl}</Badge>{note && <span className="sub">{note}</span>}</td>
        <td>{s.available ? "Yes" : <span className="down">No</span>}</td>
        <td className="fig r">{s.cost_weight}</td>
        <td className="fig r">{s.version}</td>
        <td className="acts">
          {pending ? <span className="quiet">Request waiting</span>
            : can(me.team_role, "licenceRequest") && !open && <button className="link" onClick={onOpen}>Request a change</button>}
        </td>
      </tr>
      {open && (
        <tr className="action-row">
          <td colSpan="6">
            <ReasonBox reason={reason} setReason={setReason} label="Send for approval" busy={state?.busy} sensitive
                       title={`Change the licence of ${s.title}`}
                       hint="A second person (Onboarding, Finance or another Owner) must approve before anything changes."
                       placeholder="For example: PSX redistribution terms signed on ..." onCancel={onCancel}
                       onSubmit={async () => {
                         const r = await go(() => api(`${D}/datasets/${encodeURIComponent(s.key)}/licence`, { method: "POST", body: { status: to, reason } }));
                         if (r !== undefined) onDone(`Request sent: ${s.title} to "${licenceLabel(to)}". It waits for a second person's approval.`);
                       }}>
              <label className="inline">New status
                <select value={to} onChange={(e) => setTo(e.target.value)}>
                  {options.map((k) => <option key={k} value={k}>{LICENCE[k][0]}</option>)}
                </select>
              </label>
              {LICENCE[to] && <span className="hint">{LICENCE[to][2]}</span>}
            </ReasonBox>
            <ErrorLine error={state?.error} />
          </td>
        </tr>
      )}
    </>
  );
}

function RequestRow({ r, me, onEnded, onDone }) {
  const [mode, setMode] = useState(null);            // "approve" | "reject"
  const [note, setNote] = useState("");
  const [state, go] = useAction(onEnded);
  const expired = r.status === "expired" || (r.status === "pending" && r.expires_at && Date.parse(r.expires_at) < Date.now());
  const own = emailOf(r.requested_by) === String(me.email || "").toLowerCase();
  const canDecide = can(me.team_role, "licenceDecide") && r.status === "pending" && !expired;
  const tone = r.status === "approved" ? "good" : r.status === "rejected" ? "bad" : expired ? "quiet" : "warn";
  return (
    <>
      <tr className={expired ? "dim" : ""}>
        <td className="fig">{when(r.created_at)}<span className="sub">Expires {when(r.expires_at)}</span></td>
        <td>{r.target}<span className="sub">{licenceLabel(r.change?.from)} to <b>{licenceLabel(r.change?.to)}</b></span></td>
        <td>{r.requested_by}<span className="sub why">{r.reason}</span></td>
        <td><Badge tone={tone}>{expired ? "Expired" : r.status === "pending" ? "Waiting" : r.status}</Badge></td>
        <td>{r.decided_by ? <>{r.decided_by}<span className="sub">{when(r.decided_at)}</span>{r.decision_note && <span className="sub why">{r.decision_note}</span>}</> : ""}</td>
        <td className="acts">
          {canDecide && !mode && (
            <>
              {own ? <span className="quiet">Your request</span> : <button className="link" onClick={() => setMode("approve")}>Approve</button>}
              <button className="link" onClick={() => setMode("reject")}>Reject</button>
            </>
          )}
        </td>
      </tr>
      {mode && (
        <tr className="action-row">
          <td colSpan="6">
            <ReasonBox reason={note} setReason={setNote} label={mode === "approve" ? "Approve" : "Reject"} busy={state?.busy}
                       sensitive={mode === "approve"} danger={mode === "reject"}
                       title={`${mode === "approve" ? "Approve" : "Reject"}: ${r.target} to ${licenceLabel(r.change?.to)}`}
                       hint={mode === "approve" ? "The licence changes as soon as you approve." : "Nothing changes; the request is closed."}
                       confirmText={mode === "approve" ? `Approve now? ${r.target} becomes "${licenceLabel(r.change?.to)}" for every client.` : undefined}
                       placeholder={mode === "approve" ? "What did you check before approving?" : "Why is this rejected?"}
                       onCancel={() => setMode(null)}
                       onSubmit={async () => {
                         const res = await go(() => api(`${D}/approvals/${encodeURIComponent(r.id)}/${mode}`, { method: "POST", body: { note } }),
                           { sensitive: mode === "approve" });
                         if (res !== undefined) { setMode(null); setNote(""); onDone(); }
                       }} />
            <ErrorLine error={state?.error} />
          </td>
        </tr>
      )}
    </>
  );
}
