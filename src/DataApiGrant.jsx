/*
 * src/DataApiGrant.jsx  (kse-sentinel-ops, Oct 20 2026)
 *
 * DATA API: giving a client access for the first time.
 * Handoff: claude/KSE_Sentinel_Handoff_Ops_Grant_Access.md.
 *
 * The backend route PUT /api/v1/ops/dapi/tenants/{id} {name, plan, reason}
 * creates the Data API client when it has no access yet (audit row
 * tenant.grant) and changes the plan when it has (tenant.plan_change). The
 * console only ever calls it from here for a client WITHOUT access; changing
 * an existing client's plan stays on "Change plan or name".
 *
 * The Data API client id is the backend's client id (the Onboarding record),
 * so a bank's Data API access, its Terminal users and its billing are one record.
 *
 *   GrantForm             name, plan (with its allowances), reason, then step-up
 *   GiveAccess            Data API > Clients: pick an Onboarding client, then GrantForm
 *   OnboardingAccessPanel the "Data API access" panel on an Onboarding record
 *
 * Owner and Onboarding only (roles.js tenantWrite); others do not see the
 * buttons and the backend refuses them anyway. Whether a client has access is
 * read from GET /tenants, just before the change as well, so a client that
 * already has access is never offered here. No holdings, transactions or
 * files are shown (Section 17.7).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api.js";
import { can } from "./roles.js";
import { useAction } from "./StepUp.jsx";
import { Badge, ErrorLine, num, ReasonBox } from "./ui.jsx";

const D = "/api/v1/ops/dapi";

const STATUS = {
  PENDING_REVIEW: "Pending review",
  MORE_INFO_REQUESTED: "Waiting for client information",
  TRIAL_ACTIVE: "On trial",
  TRIAL_EXPIRED: "Trial ended",
  PAID_ACTIVE: "Paid",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};
const APPROVED = ["TRIAL_ACTIVE", "PAID_ACTIVE"];
// Every Onboarding status a client can be offered from; rejected signups never get access.
const OFFERABLE = ["TRIAL_ACTIVE", "PAID_ACTIVE", "TRIAL_EXPIRED", "SUSPENDED", "PENDING_REVIEW", "MORE_INFO_REQUESTED"];

/* ------------------------------------------------------------ plan summary */

function planAllowances(p) {
  if (!p) return "";
  const parts = [];
  if (p.units_per_minute != null) parts.push(`${num(p.units_per_minute)} units a minute`);
  if (p.units_per_day != null) parts.push(`${num(p.units_per_day)} a day`);
  if (p.units_per_month != null) parts.push(`${num(p.units_per_month)} a month`);
  if (p.max_credentials != null) parts.push(`${p.max_credentials} active key${p.max_credentials === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function PlanSummary({ p }) {
  if (!p) return null;
  return (
    <div className="plan-summary">
      <span><b>{p.name}</b>{p.is_pilot ? " (pilot)" : ""}</span>
      {planAllowances(p) && <span className="hint">Allowances: {planAllowances(p)}.</span>}
      {(p.delivery || []).length > 0 && <span className="hint">Delivery: {p.delivery.join(", ")}.</span>}
      {(p.datasets || []).length > 0 && <span className="hint">Data sets: {p.datasets.join(", ")}.</span>}
    </div>
  );
}

/* ------------------------------------------------------------ the form */

/* client: { id, name, status }. Resolves onGranted(tenantId) after the grant. */
export function GrantForm({ client, plans, onEnded, onGranted, onCancel }) {
  const offered = plans.filter((p) => p.active !== false);
  const [name, setName] = useState(client.name || "");
  const [plan, setPlan] = useState(() => (offered.find((p) => p.is_pilot) || offered[0])?.key || "");
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  const chosen = offered.find((p) => p.key === plan);
  const valid = name.trim().length >= 1 && name.trim().length <= 128 && !!chosen;

  async function submit() {
    const r = await go(async () => {
      // Checked again just before the change: a client that has access meanwhile is a plan change, not a grant.
      const now = await api(`${D}/tenants`);
      if ((now.items || []).some((t) => t.tenant_id === client.id)) {
        throw new ApiError(409, `${client.name || `Client ${client.id}`} already has Data API access. Use "Change plan or name" on its record in Data API > Clients.`, { code: "already-granted" });
      }
      return api(`${D}/tenants/${client.id}`, { method: "PUT", body: { name: name.trim(), plan, reason } });
    });
    if (r !== undefined) onGranted(client.id, r);
  }

  if (offered.length === 0) {
    return <p className="msg bad">No Data API plan is available. Plans come from the Data API; none is active.</p>;
  }
  return (
    <div className="top-gap">
      <ReasonBox reason={reason} setReason={setReason} label="Give Data API access" busy={state?.busy} sensitive
                 disabled={!valid} title={`Give Data API access to ${client.name || `client ${client.id}`}`}
                 hint={`Client number ${client.id}. The Data API client is the same record as this client's Terminal users and billing. Keys are created in the next step.`}
                 placeholder="For example: pilot agreed for the reporting team"
                 onCancel={onCancel} onSubmit={submit}>
        <div className="form-grid">
          <label>Client name
            <input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
            <span className="hint">{name.trim().length} of 128 characters.</span>
          </label>
          <label>Plan
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {offered.map((p) => <option key={p.key} value={p.key}>{p.name}{p.is_pilot ? " (pilot)" : ""}</option>)}
            </select>
          </label>
        </div>
        <PlanSummary p={chosen} />
        {client.status && !APPROVED.includes(client.status) && (
          <span className="hint warn-line">This client's Onboarding status is "{STATUS[client.status] || client.status}", not on trial or paid. Check that access is intended.</span>
        )}
      </ReasonBox>
      <ErrorLine error={state?.error} />
    </div>
  );
}

/* ------------------------------------------------------------ Data API > Clients */

export function GiveAccess({ tenants, plans, onEnded, onGranted, onCancel }) {
  const [client, setClient] = useState(null);
  const granted = useMemo(() => new Set(tenants.map((t) => t.tenant_id)), [tenants]);
  return (
    <article>
      <header className="rec-head"><h2>Give a client Data API access</h2></header>
      {client ? (
        <>
          <p className="hint">Chosen from Onboarding: <b>{client.name}</b>, client number {client.id}. <button className="link" onClick={() => setClient(null)}>Choose another</button></p>
          <GrantForm client={client} plans={plans} onEnded={onEnded} onGranted={onGranted} onCancel={onCancel} />
        </>
      ) : (
        <ClientPicker granted={granted} onEnded={onEnded} onPick={setClient} onCancel={onCancel} />
      )}
    </article>
  );
}

function ClientPicker({ granted, onEnded, onPick, onCancel }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [number, setNumber] = useState("");
  const [lookup, setLookup] = useState(null);       // { busy } | { error }

  useEffect(() => {
    api(`/api/v1/ops-console/signups?status=${OFFERABLE.join(",")}`)
      .then((d) => setList(d.signups || []))
      .catch((e) => { if (!onEnded(e)) setError(e); });
  }, [onEnded]);

  const needle = q.trim().toLowerCase();
  const shown = (list || [])
    .filter((s) => !granted.has(s.tenant_id))
    .filter((s) => !needle || [s.company_name, s.city, s.sector, s.admin_email, String(s.tenant_id)]
      .some((v) => v && String(v).toLowerCase().includes(needle)))
    .sort((a, b) => (APPROVED.includes(a.status) === APPROVED.includes(b.status)
      ? String(a.company_name).localeCompare(String(b.company_name))
      : APPROVED.includes(a.status) ? -1 : 1));
  const withAccess = (list || []).filter((s) => granted.has(s.tenant_id)).length;

  // A client number typed in directly (for a record outside the queues above) is checked against Onboarding first.
  async function byNumber(e) {
    e.preventDefault();
    const id = Number(number);
    if (!Number.isInteger(id) || id <= 0) { setLookup({ error: "Enter a client number, a whole number above 0." }); return; }
    if (granted.has(id)) { setLookup({ error: `Client ${id} already has Data API access. Use "Change plan or name" on its record.` }); return; }
    setLookup({ busy: true });
    try {
      const rec = await api(`/api/v1/ops-console/signups/${id}`);
      if (rec.status === "REJECTED") { setLookup({ error: `${rec.company_name} was rejected in Onboarding and cannot be given access.` }); return; }
      setLookup(null);
      onPick({ id: rec.tenant_id ?? id, name: rec.company_name, status: rec.status });
    } catch (err) {
      if (onEnded(err)) return;
      setLookup({ error: err.status === 404 ? `No Onboarding record has client number ${id}.` : err });
    }
  }

  return (
    <>
      <p className="hint">Onboarding clients without Data API access. Clients on trial or paid are listed first; rejected signups are never offered.</p>
      <div className="toolbar">
        <label>Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, city, email or client number" autoFocus />
        </label>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
      <ErrorLine error={error} />
      {!list && !error && <p className="quiet">Loading</p>}
      {list && (shown.length === 0
        ? <p className="quiet">{needle ? "No client matches." : "Every listed Onboarding client already has access."}</p>
        : (
          <ul className="rows pick-list">
            {shown.map((s) => (
              <li key={s.tenant_id}>
                <button onClick={() => onPick({ id: s.tenant_id, name: s.company_name, status: s.status })}>
                  <span className="co">{s.company_name}</span>
                  <span className="sub">Client number {s.tenant_id}{[s.city, s.sector].filter(Boolean).length ? `, ${[s.city, s.sector].filter(Boolean).join(", ")}` : ""}</span>
                  <span className="sub">
                    <Badge tone={APPROVED.includes(s.status) ? "good" : "warn"}>{STATUS[s.status] || s.status}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      {list && withAccess > 0 && <p className="hint">{withAccess} listed client{withAccess === 1 ? " already has" : "s already have"} access and {withAccess === 1 ? "is" : "are"} not shown.</p>}

      <form className="toolbar top-gap" onSubmit={byNumber}>
        <label>Or enter a client number
          <input type="number" min="1" step="1" value={number} onChange={(e) => { setNumber(e.target.value); setLookup(null); }} className="wide-num" />
        </label>
        <button className="outline" disabled={!number || lookup?.busy}>{lookup?.busy ? "Looking up" : "Look up"}</button>
      </form>
      {lookup?.error && <ErrorLine error={lookup.error} />}
    </>
  );
}

/* ------------------------------------------------------------ Onboarding record */

export function OnboardingAccessPanel({ rec, role, onEnded, onOpenDataApi }) {
  const [tenants, setTenants] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const canWrite = can(role, "tenantWrite");

  const load = useCallback(() => {
    setError(null);
    Promise.all([api(`${D}/tenants`), api(`${D}/plans`)])
      .then(([t, p]) => { setTenants(t.items || []); setPlans(p.items || []); })
      .catch((e) => { if (!onEnded(e)) setError(e); });
  }, [onEnded]);
  useEffect(load, [load]);

  let body;
  if (error) {
    body = error.code === "dapi-not-configured"
      ? <p className="quiet">Data API admin is not connected on this server, so access cannot be read or given here.</p>
      : <><ErrorLine error={error} /><button className="link" onClick={load}>Try again</button></>;
  } else if (!tenants) {
    body = <p className="quiet">Loading</p>;
  } else {
    const t = tenants.find((x) => x.tenant_id === rec.tenant_id);
    if (t) {
      const plan = plans.find((p) => p.key === t.plan);
      body = (
        <>
          <dl className="facts compact-3">
            <div className="fact"><dt>Plan</dt><dd>{plan?.name || t.plan}{plan?.is_pilot ? " (pilot)" : ""}</dd></div>
            <div className="fact"><dt>Status</dt><dd>{t.status === "active" ? <Badge tone="good">Active</Badge> : <Badge tone="bad">{t.status}</Badge>}</dd></div>
            <div className="fact"><dt>Active keys</dt><dd className="fig">{t.active_keys ?? ""}</dd></div>
          </dl>
          <div className="choices top-gap">
            <button className="outline" onClick={() => onOpenDataApi(rec.tenant_id)}>Open in Data API</button>
          </div>
        </>
      );
    } else if (rec.status === "REJECTED") {
      body = <p className="quiet">No Data API access. A rejected signup cannot be given access.</p>;
    } else if (!canWrite) {
      body = <p className="quiet">No Data API access.</p>;
    } else if (!open) {
      body = (
        <>
          <p className="quiet">No Data API access yet.</p>
          <div className="choices"><button className="outline" onClick={() => setOpen(true)}>Give Data API access</button></div>
        </>
      );
    } else {
      body = (
        <GrantForm client={{ id: rec.tenant_id, name: rec.company_name, status: rec.status }} plans={plans}
                   onEnded={onEnded} onCancel={() => setOpen(false)}
                   onGranted={(id) => onOpenDataApi(id, { justGranted: true })} />
      );
    }
  }
  return (
    <section className="block">
      <h3>Data API access</h3>
      {body}
    </section>
  );
}
