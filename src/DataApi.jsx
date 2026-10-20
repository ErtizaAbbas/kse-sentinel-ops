/*
 * src/DataApi.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * DATA API: Sentinel Operations' view of the client Data API, through the
 * backend proxy /api/v1/ops/dapi/* (spec Section 18). The console never holds
 * a Data API credential and never calls the Data API directly.
 *
 *   Overview   processes, queues, deliveries, analytics, approvals, audit rows
 *   Clients    plan, status, overrides; give access to a client (DataApiClients.jsx, DataApiGrant.jsx)
 *   API keys   list, create (shown once), rotate, revoke   (DataApiClients.jsx)
 *   Usage      per client and day, up to 92 days
 *   Webhooks   endpoints needing attention, resume a paused one
 *   Jobs       failed and queued jobs, error message only
 *   Licences   data set licences, requests and the approvals queue (DataApiLicences.jsx)
 *   Audit log  the Data API's hash-chained log, Verify chain (DataApiAudit.jsx)
 *
 * focus (Oct 20 2026): { tenantId, justGranted, n } from an Onboarding record
 * opens Clients on that client; after a grant, "Create a key" is the next step.
 *
 * Never shown (Section 17.7): client holdings, transactions, files or results.
 * The Data API does not return them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { can } from "./roles.js";
import { useAction } from "./StepUp.jsx";
import { ago, Badge, day, ErrorLine, num, ReasonBox, utcDay, when } from "./ui.jsx";
import { Clients, Keys } from "./DataApiClients.jsx";
import Licences from "./DataApiLicences.jsx";
import AuditLog from "./DataApiAudit.jsx";

const D = "/api/v1/ops/dapi";

export default function DataApi({ me, onEnded, focus: initialFocus }) {
  const role = me.team_role;
  const tabs = [
    ["overview", "Overview"], ["clients", "Clients"], ["keys", "API keys"], ["usage", "Usage"],
    ["webhooks", "Webhooks"], ["jobs", "Jobs"], ["licences", "Data sets and licences"],
    ...(can(role, "dapiAudit") ? [["audit", "Audit log"]] : []),
  ];
  const [tab, setTab] = useState(initialFocus ? "clients" : "overview");
  const [focus, setFocus] = useState(initialFocus || null);
  const [health, setHealth] = useState(null);
  const [down, setDown] = useState(null);           // the Data API cannot be used at all
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [keysFor, setKeysFor] = useState(null);       // { tenantId, create }

  const loadHealth = useCallback(() => {
    setDown(null);
    return api(`${D}/health`).then((h) => { setHealth(h); return true; })
      .catch((e) => { if (!onEnded(e)) setDown(e); return false; });
  }, [onEnded]);
  const loadRefs = useCallback(() => {
    api(`${D}/tenants`).then((t) => setTenants(t.items || [])).catch((e) => { onEnded(e); });
    api(`${D}/plans`).then((p) => setPlans(p.items || [])).catch((e) => { onEnded(e); });
  }, [onEnded]);
  useEffect(() => { loadHealth().then((ok) => { if (ok) loadRefs(); }); }, [loadHealth, loadRefs]);

  if (down) {
    const notConfigured = down.code === "dapi-not-configured";
    return (
      <section className="dapi">
        <h1>Data API</h1>
        <div className={`banner ${notConfigured ? "" : "bad"}`}>
          {notConfigured ? (
            <>
              <b>Data API admin is not connected.</b>
              <p>The backend has no Data API signing key yet. This is expected on the live server until the deployment step; nothing in this section is available until it is set.</p>
            </>
          ) : (
            <>
              <b>The Data API is not answering.</b>
              <ErrorLine error={down} />
            </>
          )}
          <button className="outline" onClick={() => loadHealth().then((ok) => { if (ok) loadRefs(); })}>Try again</button>
        </div>
      </section>
    );
  }

  const nameOf = (id) => tenants.find((t) => t.tenant_id === id)?.name || (id == null ? "" : `Client ${id}`);
  const current = tabs.some(([id]) => id === tab) ? tab : "overview";
  return (
    <section className="dapi">
      <h1>Data API</h1>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={current === id} className={current === id ? "on" : ""}
                  onClick={() => { if (id === "keys") setKeysFor((k) => (k ? { ...k, create: false } : k)); setTab(id); }}>
            {label}
            {id === "licences" && health?.approvals_pending > 0 && <span className="count">{health.approvals_pending}</span>}
          </button>
        ))}
      </div>
      {current === "overview" && <Overview health={health} onRefresh={loadHealth} />}
      {current === "clients" && (
        <Clients me={me} tenants={tenants} plans={plans} onEnded={onEnded} focus={focus}
                 onChanged={loadRefs}
                 onGranted={(id) => { loadRefs(); loadHealth(); setFocus({ tenantId: id, justGranted: true, n: Date.now() }); }}
                 onOpenKeys={(id, opts) => { setKeysFor({ tenantId: id, create: !!opts?.create }); setFocus(null); setTab("keys"); }} />
      )}
      {current === "keys" && (
        <Keys key={keysFor ? `${keysFor.tenantId}-${keysFor.create}` : "keys"} me={me} tenants={tenants} plans={plans} onEnded={onEnded}
              initialTenant={keysFor?.tenantId} initialCreate={keysFor?.create} onChanged={loadRefs} />
      )}
      {current === "usage" && <Usage tenants={tenants} nameOf={nameOf} onEnded={onEnded} />}
      {current === "webhooks" && <Webhooks me={me} nameOf={nameOf} onEnded={onEnded} />}
      {current === "jobs" && <Jobs nameOf={nameOf} onEnded={onEnded} />}
      {current === "licences" && <Licences me={me} onEnded={onEnded} onChanged={loadHealth} />}
      {current === "audit" && <AuditLog tenants={tenants} nameOf={nameOf} onEnded={onEnded} />}
    </section>
  );
}

/* ------------------------------------------------------------ overview */

function Overview({ health, onRefresh }) {
  const [busy, setBusy] = useState(false);
  if (!health) return <p className="quiet">Loading</p>;
  const h = health;
  const stale = (h.processes || []).filter((p) => p.stale);
  return (
    <>
      <div className="row-between">
        <p className="quiet small">Checked {when(h.checked_at)}</p>
        <button className="outline inline-btn" disabled={busy} onClick={async () => { setBusy(true); await onRefresh(); setBusy(false); }}>
          {busy ? "Checking" : "Check again"}
        </button>
      </div>
      {stale.length > 0 && (
        <p className="msg bad">{stale.length === 1 ? "One process has" : `${stale.length} processes have`} stopped reporting: {stale.map((p) => p.role).join(", ")}.</p>
      )}
      <div className="figures six">
        <Figure n={h.jobs?.queued} l="jobs queued" sub={h.jobs?.oldest_queued_seconds != null ? `oldest ${ago(h.jobs.oldest_queued_seconds)}` : null} />
        <Figure n={h.jobs?.failed_24h} l="jobs failed, last 24 h" bad={h.jobs?.failed_24h > 0} />
        <Figure n={h.webhooks?.pending_deliveries} l="webhook deliveries pending"
                sub={h.webhooks?.oldest_due_seconds != null ? `oldest ${ago(h.webhooks.oldest_due_seconds)}` : null} />
        <Figure n={h.webhooks?.endpoints_needing_attention} l="webhooks needing attention" bad={h.webhooks?.endpoints_needing_attention > 0} />
        <Figure n={h.approvals_pending} l="licence approvals pending" bad={h.approvals_pending > 0} />
        <Figure n={h.audit_rows} l="audit log rows" />
      </div>

      <h2>Analytics</h2>
      <dl className="facts">
        <div className="fact"><dt>Latest data as of</dt><dd className="fig">{day(h.analytics?.latest_as_of) || <span className="quiet">None</span>}</dd></div>
        <div className="fact"><dt>Published</dt><dd className="fig">{when(h.analytics?.published_at) || <span className="quiet">Never</span>}</dd></div>
        <div className="fact"><dt>Events, last hour</dt><dd className="fig">{num(h.events_last_hour)}</dd></div>
      </dl>

      <h2>Processes</h2>
      {(h.processes || []).length === 0 ? <p className="quiet">No process has reported.</p> : (
        <div className="scroll">
          <table className="plain">
            <thead><tr><th>Role</th><th>Instance</th><th>Environment</th><th>Version</th><th>Started</th><th>Last seen</th><th>State</th></tr></thead>
            <tbody>
              {h.processes.map((p) => (
                <tr key={p.instance_id}>
                  <td>{p.role}</td>
                  <td className="fig">{p.instance_id}</td>
                  <td>{p.environment}</td>
                  <td className="fig">{p.version}</td>
                  <td className="fig">{when(p.started_at)}</td>
                  <td className="fig">{when(p.last_seen_at)}</td>
                  <td>{p.stale ? <Badge tone="bad">Stopped reporting</Badge> : <Badge tone="good">Running</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const Figure = ({ n, l, sub, bad }) => (
  <div className="figure">
    <span className={`n ${bad ? "down" : ""}`}>{n == null ? "" : num(n)}</span>
    <span className="l">{l}</span>
    {sub && <span className="l small-l">{sub}</span>}
  </div>
);

/* ------------------------------------------------------------ usage */

function Usage({ tenants, nameOf, onEnded }) {
  const [tenant, setTenant] = useState("");
  const [from, setFrom] = useState(() => utcDay(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => utcDay());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({});
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const valid = !!from && !!to && span >= 1 && span <= 92;

  useEffect(() => {
    if (!valid) return;
    setError(null);
    setData(null);
    const q = new URLSearchParams();
    if (tenant !== "") q.set("tenant_id", tenant);
    q.set("from", from);
    q.set("to", to);
    api(`${D}/usage?${q}`).then(setData).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [tenant, from, to, valid, onEnded]);

  const days = useMemo(() => {
    const m = new Map();
    for (const r of data?.items || []) {
      const d = m.get(r.day) || { day: r.day, requests: 0, units: 0, errors: 0, rows: [] };
      d.requests += r.requests || 0;
      d.units += r.units || 0;
      if (r.status_class === "4xx" || r.status_class === "5xx") d.errors += r.requests || 0;
      d.rows.push(r);
      m.set(r.day, d);
    }
    return [...m.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [data]);

  return (
    <>
      <div className="toolbar">
        <label>Client
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            <option value="">All clients</option>
            {tenants.map((t) => <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>)}
          </select>
        </label>
        <label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {!valid && <p className="msg bad">Choose a range of 1 to 92 days.</p>}
      <p className="hint">Days are calendar days in UTC, as the Data API records them. Units are what the plan limits count.</p>
      <ErrorLine error={error} />
      {valid && !data && !error && <p className="quiet">Loading</p>}
      {data && (
        <>
          <div className="figures three">
            <Figure n={data.total_requests} l="requests" />
            <Figure n={data.total_units} l="units" />
            <Figure n={days.reduce((a, d) => a + d.errors, 0)} l="refused or failed requests" />
          </div>
          {days.length === 0 ? <p className="quiet">No use in this range.</p> : (
            <div className="scroll">
              <table className="plain">
                <thead><tr><th>Day</th><th className="r">Requests</th><th className="r">Units</th><th className="r">Refused or failed</th><th></th></tr></thead>
                <tbody>
                  {days.map((d) => (
                    <UsageDay key={d.day} d={d} open={!!open[d.day]} showClient={tenant === ""} nameOf={nameOf}
                              onToggle={() => setOpen({ ...open, [d.day]: !open[d.day] })} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function UsageDay({ d, open, onToggle, showClient, nameOf }) {
  return (
    <>
      <tr>
        <td className="fig">{d.day}</td>
        <td className="fig r">{num(d.requests)}</td>
        <td className="fig r">{num(d.units)}</td>
        <td className={`fig r ${d.errors ? "down" : ""}`}>{num(d.errors)}</td>
        <td className="acts"><button className="link" onClick={onToggle} aria-expanded={open}>{open ? "Hide" : "By endpoint"}</button></td>
      </tr>
      {open && (
        <tr className="action-row">
          <td colSpan="5">
            <table className="plain nums inner">
              <thead><tr>{showClient && <th>Client</th>}<th>Endpoint</th><th>Result</th><th className="r">Requests</th><th className="r">Units</th></tr></thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={i}>
                    {showClient && <td>{nameOf(r.tenant_id)}</td>}
                    <td className="fig">{r.endpoint}</td>
                    <td>{r.status_class === "2xx" ? "Answered" : r.status_class === "4xx" ? <span className="down">Refused (4xx)</span> : <span className="down">Failed (5xx)</span>}</td>
                    <td className="fig r">{num(r.requests)}</td>
                    <td className="fig r">{num(r.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------ webhooks */

const WEBHOOK_FILTERS = [["attention", "Needing attention"], ["paused", "Paused"], ["disabled", "Disabled"], ["active", "Active"], ["", "All"]];

function Webhooks({ me, nameOf, onEnded }) {
  const [status, setStatus] = useState("attention");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setError(null);
    api(`${D}/webhooks${status ? `?status=${status}` : ""}`).then(setData).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [status, onEnded]);
  useEffect(() => { setData(null); load(); }, [load]);

  const items = data?.items || [];
  // Columns come from the response itself: every plain field except the ones shown first.
  const skip = new Set(["id", "webhook_id", "tenant_id", "status"]);
  const cols = [...new Set(items.flatMap((w) => Object.keys(w).filter((k) => !skip.has(k) && (w[k] == null || typeof w[k] !== "object"))))];
  return (
    <>
      <div className="tabs sub-tabs">
        {WEBHOOK_FILTERS.map(([v, l]) => (
          <button key={v || "all"} className={status === v ? "on" : ""} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      <p className="hint">Addresses are shown as host and path only. Signing secrets are never shown.</p>
      <ErrorLine error={error} />
      {!data && !error && <p className="quiet">Loading</p>}
      {data && (items.length === 0 ? <p className="quiet">No webhook endpoints here.</p> : (
        <div className="scroll">
          <table className="plain">
            <thead><tr><th>Client</th><th>Endpoint</th><th>Status</th>{cols.map((c) => <th key={c}>{label(c)}</th>)}<th></th></tr></thead>
            <tbody>
              {items.map((w) => <WebhookRow key={w.id ?? w.webhook_id} w={w} cols={cols} me={me} nameOf={nameOf} onEnded={onEnded} onChanged={load} />)}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

const label = (k) => k.replace(/_at$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const cell = (k, v) => (v == null || v === "" ? "" : /_at$/.test(k) ? when(v) : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

function WebhookRow({ w, cols, me, nameOf, onEnded, onChanged }) {
  const id = w.id ?? w.webhook_id;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  const canResume = can(me.team_role, "webhookResume") && w.status === "paused";
  return (
    <>
      <tr>
        <td>{nameOf(w.tenant_id)}</td>
        <td className="fig">{id}</td>
        <td><Badge tone={w.status === "active" ? "good" : w.status === "paused" ? "warn" : "bad"}>{w.status}</Badge></td>
        {cols.map((c) => <td key={c} className={/_at$|count|fail/.test(c) ? "fig" : ""}>{cell(c, w[c])}</td>)}
        <td className="acts">{canResume && !open && <button className="link" onClick={() => setOpen(true)}>Resume</button>}</td>
      </tr>
      {open && (
        <tr className="action-row">
          <td colSpan={cols.length + 4}>
            <ReasonBox reason={reason} setReason={setReason} label="Resume deliveries" busy={state?.busy}
                       title={`Resume webhook ${id}`} hint="Deliveries start again on the next cycle."
                       placeholder="Why is it safe to resume? For example: client confirmed their endpoint is fixed."
                       onCancel={() => setOpen(false)}
                       onSubmit={async () => {
                         const r = await go(() => api(`${D}/webhooks/${encodeURIComponent(id)}/resume`, { method: "POST", body: { reason } }), { sensitive: false });
                         if (r !== undefined) { setOpen(false); setReason(""); onChanged(); }
                       }} />
            <ErrorLine error={state?.error} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------ jobs */

const JOB_FILTERS = [["failed", "Failed"], ["queued", "Queued"], ["running", "Running"], ["succeeded", "Succeeded"], ["", "All"]];

function Jobs({ nameOf, onEnded }) {
  const [status, setStatus] = useState("failed");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    setData(null);
    setError(null);
    api(`${D}/jobs?limit=100${status ? `&status=${status}` : ""}`).then(setData).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [status, onEnded]);
  const items = data?.items || [];
  return (
    <>
      <div className="tabs sub-tabs">
        {JOB_FILTERS.map(([v, l]) => (
          <button key={v || "all"} className={status === v ? "on" : ""} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      <p className="hint">The newest 100. Only the error message is shown, never the job's data.</p>
      <ErrorLine error={error} />
      {!data && !error && <p className="quiet">Loading</p>}
      {data && (items.length === 0 ? <p className="quiet">No jobs here.</p> : (
        <div className="scroll">
          <table className="plain">
            <thead><tr><th>Created</th><th>Client</th><th>Type</th><th>Status</th><th className="r">Attempts</th><th>Age</th><th>Run by</th><th>Error</th></tr></thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id}>
                  <td className="fig">{when(j.created_at)}<span className="sub">{j.id}</span></td>
                  <td>{nameOf(j.tenant_id)}</td>
                  <td className="fig">{j.type}</td>
                  <td><Badge tone={j.status === "failed" ? "bad" : j.status === "succeeded" ? "good" : "warn"}>{j.status}</Badge></td>
                  <td className="fig r">{j.attempts}</td>
                  <td className="fig">{ago(j.age_seconds)}</td>
                  <td className="fig">{j.claimed_by || <span className="quiet">Not claimed</span>}</td>
                  <td className="why">{j.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
