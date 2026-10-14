/*
 * src/Secrets.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * SECRETS: the inventory of every key and password across the platform,
 * secrets and credentials Phase A. Names, locations, owners and dates only:
 * no value is ever shown, sent to or stored by the console, and the backend
 * refuses any text that looks like a secret value (422 value-like-content).
 *
 * Owner and Onboarding see it. The Owner adds, edits, records a rotation and
 * retires entries, each with a reason and a recent authenticator code.
 * Entries are never deleted. Backend: /api/v1/ops/secrets.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { can, ROLE_LABEL } from "./roles.js";
import { useAction } from "./StepUp.jsx";
import { Badge, day, ErrorLine, ReasonBox, startOfDayPkt, todayPkt, when } from "./ui.jsx";

const S = "/api/v1/ops/secrets";

export const SYSTEMS = {
  azure_sql: "Azure SQL", backend: "Backend", data_api: "Data API", terminal: "Terminal", ops_console: "Ops console",
  redis: "Redis", document_intelligence: "Document Intelligence", blob_storage: "Blob storage", anthropic: "Anthropic",
  render: "Render", azure: "Azure", github: "GitHub", domain: "Domain", other: "Other",
};
const STATE = {
  overdue: ["Overdue", "bad"],
  due_soon: ["Due soon", "warn"],
  never_recorded: ["Never recorded", "warn"],
  no_schedule: ["No schedule", "quiet"],
  ok: ["Up to date", "good"],
  retired: ["Retired", "quiet"],
};
const STATE_ORDER = ["overdue", "due_soon", "never_recorded", "no_schedule", "ok", "retired"];

export default function Secrets({ me, onEnded }) {
  const owner = can(me.team_role, "secretsWrite");
  const [retired, setRetired] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [only, setOnly] = useState("");
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api(`${S}${retired ? "?include_retired=true" : ""}`).then(setData).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [retired, onEnded]);
  useEffect(load, [load]);

  const items = (data?.items || [])
    .filter((s) => !only || s.state === only)
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  const counts = data?.counts || {};

  return (
    <section className="secrets">
      <div className="row-between">
        <h1>Secrets</h1>
        {owner && !adding && <button className="primary" onClick={() => { setAdding(true); setOpen(null); }}>Add an entry</button>}
      </div>
      <p className="quiet">{data?.note || "Names, locations and dates only. Values are never stored or shown here."}</p>

      {adding && <SecretForm onEnded={onEnded} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}

      <ErrorLine error={error} />
      {data && (
        <div className="tabs sub-tabs">
          <button className={only === "" ? "on" : ""} onClick={() => setOnly("")}>All ({data.total ?? data.items?.length ?? 0})</button>
          {STATE_ORDER.filter((s) => counts[s]).map((s) => (
            <button key={s} className={only === s ? "on" : ""} onClick={() => setOnly(s)}>{STATE[s][0]} ({counts[s]})</button>
          ))}
          <label className="check push-right"><input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} /> Include retired</label>
        </div>
      )}
      {!data && !error && <p className="quiet">Loading</p>}
      {data && (items.length === 0 ? <p className="quiet">Nothing here.</p> : (
        <div className="scroll">
          <table className="plain">
            <thead><tr><th>Name</th><th>System</th><th>Stored in</th><th>Used by</th><th>Every</th><th>Last rotated</th><th>Due</th><th>State</th><th></th></tr></thead>
            <tbody>
              {items.map((s) => (
                <SecretRow key={s.secret_id} s={s} owner={owner} open={open === s.secret_id}
                           onToggle={() => setOpen(open === s.secret_id ? null : s.secret_id)}
                           onEnded={onEnded} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function SecretRow({ s, owner, open, onToggle, onEnded, onChanged }) {
  const [lbl, tone] = STATE[s.state] || [s.state, ""];
  return (
    <>
      <tr className={s.status === "retired" ? "dim" : ""}>
        <td><b>{s.name}</b>{s.notes && <span className="sub">{s.notes}</span>}</td>
        <td>{SYSTEMS[s.system] || s.system}</td>
        <td className="why">{s.stored_in}</td>
        <td className="why">{s.used_by}</td>
        <td className="fig">{s.rotation_days ? `${s.rotation_days} days` : <span className="quiet">No schedule</span>}</td>
        <td className="fig">{s.last_rotated_at ? <>{day(s.last_rotated_at)}<span className="sub">{s.last_rotated_by}</span></> : <span className="quiet">Never recorded</span>}</td>
        <td className="fig">{day(s.due_at)}</td>
        <td><Badge tone={tone}>{lbl}</Badge><span className="sub">Owner: {ROLE_LABEL[s.owner_role] || s.owner_role}</span></td>
        <td className="acts"><button className="link" onClick={onToggle} aria-expanded={open}>{open ? "Close" : owner ? "History and actions" : "History"}</button></td>
      </tr>
      {open && (
        <tr className="action-row">
          <td colSpan="9"><SecretPanel s={s} owner={owner} onEnded={onEnded} onChanged={onChanged} /></td>
        </tr>
      )}
    </>
  );
}

function SecretPanel({ s, owner, onEnded, onChanged }) {
  const [hist, setHist] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null);           // "rotated" | "edit" | "retire"
  const loadHist = useCallback(() => {
    api(`${S}/${encodeURIComponent(s.secret_id)}/history`).then((d) => setHist(d.items || [])).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [s.secret_id, onEnded]);
  useEffect(loadHist, [loadHist]);
  const done = () => { setMode(null); loadHist(); onChanged(); };
  const active = s.status !== "retired";
  return (
    <div className="panel">
      <dl className="facts compact-3">
        <div className="fact"><dt>Entry</dt><dd className="fig">{s.secret_id}</dd></div>
        <div className="fact"><dt>Added</dt><dd className="fig">{when(s.created_at)}</dd></div>
        <div className="fact"><dt>Last changed</dt><dd className="fig">{when(s.updated_at)}</dd></div>
      </dl>
      {owner && active && !mode && (
        <div className="choices top-gap">
          <button className="outline" onClick={() => setMode("rotated")}>Record a rotation</button>
          <button className="outline" onClick={() => setMode("edit")}>Edit</button>
          <button className="danger-outline" onClick={() => setMode("retire")}>Retire</button>
        </div>
      )}
      {mode === "rotated" && <RecordRotation s={s} onEnded={onEnded} onDone={done} onCancel={() => setMode(null)} />}
      {mode === "edit" && <SecretForm s={s} onEnded={onEnded} onSaved={done} onCancel={() => setMode(null)} />}
      {mode === "retire" && <Retire s={s} onEnded={onEnded} onDone={done} onCancel={() => setMode(null)} />}

      <h3>History</h3>
      <ErrorLine error={error} />
      {!hist && !error && <p className="quiet">Loading</p>}
      {hist && (hist.length === 0 ? <p className="quiet">No changes recorded yet.</p> : (
        <ol className="timeline">
          {hist.map((h, i) => (
            <li key={h.id ?? i}>
              <span className="t fig">{when(h.at || h.time || h.created_at)}</span>
              <span className="what"><b>{h.label || h.action || h.event}</b></span>
              <span className="why">{h.reason}</span>
              <span className="by-line">{h.by || h.actor}{h.role ? `, ${ROLE_LABEL[h.role] || h.role}` : ""}</span>
            </li>
          ))}
        </ol>
      ))}
    </div>
  );
}

function RecordRotation({ s, onEnded, onDone, onCancel }) {
  const today = todayPkt();
  const [on, setOn] = useState(today);
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  const valid = !!on && on <= today;
  return (
    <div className="top-gap">
      <ReasonBox reason={reason} setReason={setReason} label="Record rotation" busy={state?.busy} sensitive disabled={!valid}
                 title={`Record that ${s.name} was rotated`}
                 hint="Records the date only. Change the value itself where it is stored, and in every place listed under Stored in."
                 placeholder="For example: new key made at the provider, Render and .env updated, old key deleted"
                 onCancel={onCancel}
                 onSubmit={async () => {
                   const body = { reason };
                   if (on !== today) body.rotated_at = startOfDayPkt(on);
                   const r = await go(() => api(`${S}/${encodeURIComponent(s.secret_id)}/rotated`, { method: "POST", body }));
                   if (r !== undefined) onDone();
                 }}>
        <label className="inline">Rotated on
          <input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} className="date-in" />
          <span className="hint">{on === today ? "Today (the server records the exact time)." : "An earlier date, PKT."}</span>
        </label>
      </ReasonBox>
      <ErrorLine error={state?.error} />
    </div>
  );
}

function Retire({ s, onEnded, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  return (
    <div className="top-gap">
      <ReasonBox reason={reason} setReason={setReason} label="Retire entry" busy={state?.busy} sensitive danger
                 title={`Retire ${s.name}`} hint="The entry stays in the inventory, marked retired, with its history. It no longer counts as due."
                 confirmText="Retire this entry? Do this only once the secret no longer exists anywhere."
                 placeholder="For example: key revoked at the provider; nothing uses it" onCancel={onCancel}
                 onSubmit={async () => {
                   const r = await go(() => api(`${S}/${encodeURIComponent(s.secret_id)}/retire`, { method: "POST", body: { reason } }));
                   if (r !== undefined) onDone();
                 }} />
      <ErrorLine error={state?.error} />
    </div>
  );
}

const FIELDS = ["name", "system", "stored_in", "used_by", "rotation_days", "owner_role", "notes"];

/* Add (no `s`) or edit (with `s`): only changed fields are sent on an edit. */
function SecretForm({ s, onEnded, onSaved, onCancel }) {
  const initial = {
    name: s?.name || "", system: s?.system || "backend", stored_in: s?.stored_in || "", used_by: s?.used_by || "",
    rotation_days: s?.rotation_days != null ? String(s.rotation_days) : "", owner_role: s?.owner_role || "owner", notes: s?.notes || "",
  };
  const [f, setF] = useState(initial);
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const days = f.rotation_days.trim() === "" ? null : Number(f.rotation_days);
  const daysOk = days === null || (Number.isInteger(days) && days >= 1 && days <= 3650);
  const changed = FIELDS.filter((k) => f[k] !== initial[k]);
  const valid = f.name.trim() && f.stored_in.trim() && f.used_by.trim() && daysOk && (!s || changed.length > 0);

  async function save() {
    let body;
    if (!s) {
      body = { name: f.name.trim(), system: f.system, stored_in: f.stored_in.trim(), used_by: f.used_by.trim(),
        rotation_days: days, owner_role: f.owner_role, notes: f.notes.trim() || null, reason };
    } else {
      body = { reason };
      for (const k of changed) {
        if (k === "rotation_days") {
          if (days === null) body.clear_rotation_days = true;
          else body.rotation_days = days;
        } else if (k === "notes") body.notes = f.notes.trim() || null;
        else body[k] = typeof f[k] === "string" ? f[k].trim() : f[k];
      }
    }
    const r = await go(() => api(s ? `${S}/${encodeURIComponent(s.secret_id)}` : S, { method: s ? "PATCH" : "POST", body }));
    if (r !== undefined) onSaved();
  }

  return (
    <div className="top-gap">
      <ReasonBox reason={reason} setReason={setReason} label={s ? "Save changes" : "Add entry"} busy={state?.busy} sensitive disabled={!valid}
                 title={s ? `Edit ${s.name}` : "Add an entry"}
                 hint="Describe where the secret lives and who uses it. Never type the secret itself: text that looks like one is refused."
                 placeholder={s ? "What changed, and why?" : "Why is this entry added?"} onCancel={onCancel} onSubmit={save}>
        <div className="form-grid">
          <label>Name<input value={f.name} maxLength={128} onChange={set("name")} placeholder="For example: Redis access key" /></label>
          <label>System
            <select value={f.system} onChange={set("system")}>
              {Object.entries(SYSTEMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>Rotate every (days, optional)
            <input type="number" min="1" max="3650" value={f.rotation_days} onChange={set("rotation_days")} placeholder="No schedule" />
            {!daysOk && <span className="hint bad-text">A whole number from 1 to 3650, or empty.</span>}
          </label>
          <label>Owner role
            <select value={f.owner_role} onChange={set("owner_role")}>
              {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <label>Stored in<input value={f.stored_in} onChange={set("stored_in")} placeholder="For example: Render backend env REDIS_URL; KSE_Sentinel .env" /></label>
        <label>Used by<input value={f.used_by} onChange={set("used_by")} placeholder="For example: Rate limits" /></label>
        <label>Notes (optional)<textarea rows="2" value={f.notes} onChange={set("notes")} placeholder="Rotation steps or cautions, never the value" /></label>
      </ReasonBox>
      <ErrorLine error={state?.error} />
    </div>
  );
}
