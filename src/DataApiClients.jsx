/*
 * src/DataApiClients.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * DATA API: clients and their API keys.
 *
 * Clients   list and detail; change plan, suspend or reactivate, set or clear
 *           an override (units per minute, day, month; key limit). Owner and
 *           Onboarding, each with a reason and step-up.
 *           Oct 20 2026: "Give access to a client" above the list and in the
 *           empty state (DataApiGrant.jsx); after a grant the client's detail
 *           opens with "Create a key" as the highlighted next step.
 * API keys  list per client; create (the key is shown once and never stored);
 *           revoke with a reason; Rotate:
 *             1. a new key with the same kind, scopes and address list, named
 *                "replaces <old prefix>, revoke old by <date>";
 *             2. the new key is shown once;
 *             3. the old key stays active for the chosen overlap and is
 *                flagged "Due for revoke" once that date has passed;
 *                with no overlap, the old key is revoked straight away.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { can } from "./roles.js";
import { useAction } from "./StepUp.jsx";
import { GiveAccess } from "./DataApiGrant.jsx";
import { addDaysPkt, Badge, ErrorLine, endOfDayPkt, num, ReasonBox, ShowOnce, todayPkt, when } from "./ui.jsx";

const D = "/api/v1/ops/dapi";

export const OVERRIDABLE = [
  ["units_per_minute", "Units per minute"],
  ["units_per_day", "Units per day"],
  ["units_per_month", "Units per month"],
  ["max_credentials", "Active keys allowed"],
];
const SCOPES = [
  ["account:read", "Account, read"],
  ["analytics:read", "Analytics, read"],
  ["portfolio:read", "Portfolios, read"],
  ["portfolio:write", "Portfolios, write"],
  ["exports:create", "Exports, create"],
  ["webhooks:manage", "Webhooks, manage"],
  ["stream:connect", "Stream, connect"],
];
const DEFAULT_SCOPES = ["account:read", "analytics:read"];

const limitOf = (t, plans, field) => t?.overrides?.[field] ?? plans.find((p) => p.key === t?.plan)?.[field];

/* ============================================================ clients */

/* focus: { tenantId, justGranted, n } opens that client (n changes on every new focus). */
export function Clients({ me, tenants, plans, onEnded, onChanged, onOpenKeys, focus, onGranted }) {
  const [selected, setSelected] = useState(focus?.tenantId ?? tenants[0]?.tenant_id ?? null);
  const [granting, setGranting] = useState(false);
  const canGrant = can(me.team_role, "tenantWrite");
  useEffect(() => { if (selected == null && tenants.length) setSelected(tenants[0].tenant_id); }, [tenants, selected]);
  useEffect(() => { if (focus?.tenantId != null) { setSelected(focus.tenantId); setGranting(false); } }, [focus?.n, focus?.tenantId]);
  const giveButton = canGrant && !granting && (
    <button className="primary" onClick={() => setGranting(true)}>Give access to a client</button>
  );
  return (
    <div className="split-view">
      <div>
        {giveButton && <div className="list-actions">{giveButton}</div>}
        {tenants.length === 0 ? (
          <p className="quiet">No Data API clients yet.{canGrant ? " Give an Onboarding client access to start." : ""}</p>
        ) : (
          <ul className="rows">
            {tenants.map((t) => (
              <li key={t.tenant_id}>
                <button className={!granting && selected === t.tenant_id ? "on" : ""} onClick={() => { setGranting(false); setSelected(t.tenant_id); }}>
                  <span className="co">{t.name}</span>
                  <span className="sub">
                    {plans.find((p) => p.key === t.plan)?.name || t.plan}, {t.status === "active" ? "active" : <span className="down">{t.status}</span>}
                  </span>
                  <span className="sub">{t.active_keys} active key{t.active_keys === 1 ? "" : "s"}, {num(t.units_this_month)} units this month
                    {t.webhooks_needing_attention > 0 && <>, <span className="down">{t.webhooks_needing_attention} webhook{t.webhooks_needing_attention === 1 ? "" : "s"} need attention</span></>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="record">
        {granting ? (
          <GiveAccess tenants={tenants} plans={plans} onEnded={onEnded}
                      onCancel={() => setGranting(false)}
                      onGranted={(id) => { setGranting(false); onGranted(id); }} />
        ) : selected != null ? (
          <ClientDetail key={selected} id={selected} me={me} plans={plans} onEnded={onEnded} onChanged={onChanged} onOpenKeys={onOpenKeys}
                        justGranted={!!focus?.justGranted && focus.tenantId === selected} />
        ) : (
          <div className="empty">
            <p className="quiet">{tenants.length ? "Select a client from the list." : "No Data API clients yet."}</p>
            {giveButton}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientDetail({ id, me, plans, onEnded, onChanged, onOpenKeys, justGranted }) {
  const [t, setT] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null);         // "plan" | "status" | field name
  const canWrite = can(me.team_role, "tenantWrite");
  const canKey = can(me.team_role, "keyWrite");
  const load = useCallback(() => {
    api(`${D}/tenants/${id}`).then(setT).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [id, onEnded]);
  useEffect(load, [load]);
  const done = (fresh) => { setMode(null); if (fresh && fresh.tenant_id) setT(fresh); else load(); onChanged(); };

  if (error) return <ErrorLine error={error} />;
  if (!t) return <p className="quiet">Loading</p>;
  const plan = plans.find((p) => p.key === t.plan);
  const monthLimit = limitOf(t, plans, "units_per_month");
  const keyLimit = limitOf(t, plans, "max_credentials");
  return (
    <article>
      <header className="rec-head">
        <h2>{t.name}</h2>
        <span className={`status ${t.status === "active" ? "s-TRIAL_ACTIVE" : "s-SUSPENDED"}`}>{t.status === "active" ? "Active" : "Suspended"}</span>
      </header>
      <dl className="facts">
        <div className="fact"><dt>Plan</dt><dd>{plan?.name || t.plan}{plan?.is_pilot ? " (pilot)" : ""}</dd></div>
        <div className="fact"><dt>Units this month</dt><dd className="fig">{num(t.units_this_month)}{monthLimit != null ? ` of ${num(monthLimit)}` : ""}</dd></div>
        <div className="fact"><dt>Active keys</dt><dd className="fig">{t.active_keys}{keyLimit != null ? ` of ${keyLimit}` : ""}</dd></div>
        <div className="fact"><dt>Portfolios</dt><dd className="fig">{t.portfolios}</dd></div>
        <div className="fact"><dt>Webhooks</dt><dd className="fig">{t.webhooks}{t.webhooks_needing_attention ? <span className="down">, {t.webhooks_needing_attention} need attention</span> : ""}</dd></div>
        <div className="fact"><dt>Client number</dt><dd className="fig">{t.tenant_id}</dd></div>
        <div className="fact"><dt>Created</dt><dd className="fig">{when(t.created_at)}</dd></div>
        <div className="fact"><dt>Last changed</dt><dd className="fig">{when(t.updated_at)}</dd></div>
      </dl>
      {plan && (
        <p className="hint plan-line">Plan includes: {(plan.delivery || []).join(", ")}; data sets {(plan.datasets || []).join(", ")}.</p>
      )}
      {justGranted && (
        <div className="next-step">
          <p><b>Data API access given.</b> The grant is in the audit log with your name and reason. Next: create this client's first key; it is shown once.</p>
          {canKey && <button className="primary" autoFocus onClick={() => onOpenKeys(t.tenant_id, { create: true })}>Create a key</button>}
        </div>
      )}
      <div className="choices top-gap">
        <button className="outline" onClick={() => onOpenKeys(t.tenant_id)}>Open API keys</button>
        {canWrite && !mode && (
          <>
            <button className="outline" onClick={() => setMode("plan")}>Change plan or name</button>
            {t.status === "active"
              ? <button className="danger-outline" onClick={() => setMode("status")}>Suspend</button>
              : <button className="outline" onClick={() => setMode("status")}>Reactivate</button>}
          </>
        )}
      </div>
      {mode === "plan" && <ChangePlan t={t} plans={plans} onEnded={onEnded} onDone={done} onCancel={() => setMode(null)} />}
      {mode === "status" && <ChangeStatus t={t} onEnded={onEnded} onDone={done} onCancel={() => setMode(null)} />}

      <h3>Limits and overrides</h3>
      <p className="hint">An override replaces the plan's figure for this client only. Clearing it returns to the plan.</p>
      <table className="plain">
        <thead><tr><th>Limit</th><th className="r">Plan</th><th className="r">Override</th><th className="r">In force</th><th></th></tr></thead>
        <tbody>
          {OVERRIDABLE.map(([field, lbl]) => {
            const has = t.overrides && Object.prototype.hasOwnProperty.call(t.overrides, field);
            return (
              <OverrideRow key={field} t={t} field={field} lbl={lbl} planValue={plan?.[field]} has={has}
                           open={mode === field} canWrite={canWrite && !mode}
                           onOpen={() => setMode(field)} onCancel={() => setMode(null)} onEnded={onEnded} onDone={done} />
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

function ChangePlan({ t, plans, onEnded, onDone, onCancel }) {
  const [name, setName] = useState(t.name);
  const [plan, setPlan] = useState(t.plan);
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  const changed = name.trim() !== t.name || plan !== t.plan;
  return (
    <div className="top-gap">
      <ReasonBox reason={reason} setReason={setReason} label="Save plan" busy={state?.busy} sensitive
                 disabled={!changed || !name.trim()} title="Change plan or name" onCancel={onCancel}
                 placeholder="For example: pilot ended, signed as a broker"
                 onSubmit={async () => {
                   const r = await go(() => api(`${D}/tenants/${t.tenant_id}`, { method: "PUT", body: { name: name.trim(), plan, reason } }));
                   if (r !== undefined) onDone(r);
                 }}>
        <div className="form-grid">
          <label>Client name<input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} /></label>
          <label>Plan
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.filter((p) => p.active || p.key === t.plan).map((p) => (
                <option key={p.key} value={p.key}>{p.name}{p.is_pilot ? " (pilot)" : ""}</option>
              ))}
            </select>
          </label>
        </div>
      </ReasonBox>
      <ErrorLine error={state?.error} />
    </div>
  );
}

function ChangeStatus({ t, onEnded, onDone, onCancel }) {
  const suspend = t.status === "active";
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  return (
    <div className="top-gap">
      <ReasonBox reason={reason} setReason={setReason} label={suspend ? "Suspend" : "Reactivate"} busy={state?.busy}
                 sensitive danger={suspend} title={suspend ? `Suspend ${t.name}` : `Reactivate ${t.name}`}
                 hint={suspend ? "Every key of this client is refused until it is reactivated. Keys are not revoked." : "Its active keys work again at once."}
                 confirmText={suspend ? "Suspend this client now? Their systems stop receiving data at once." : undefined}
                 placeholder={suspend ? "Why is this client suspended?" : "Why is this client reactivated?"}
                 onCancel={onCancel}
                 onSubmit={async () => {
                   const r = await go(() => api(`${D}/tenants/${t.tenant_id}/status`, { method: "POST", body: { status: suspend ? "suspended" : "active", reason } }));
                   if (r !== undefined) onDone(r);
                 }} />
      <ErrorLine error={state?.error} />
    </div>
  );
}

function OverrideRow({ t, field, lbl, planValue, has, open, canWrite, onOpen, onCancel, onEnded, onDone }) {
  const [value, setValue] = useState(has ? String(t.overrides[field]) : "");
  const [clear, setClear] = useState(false);
  const [reason, setReason] = useState("");
  const [state, go] = useAction(onEnded);
  const n = Number(value);
  const valid = clear || (value.trim() !== "" && Number.isInteger(n) && n >= 0);
  const inForce = has ? t.overrides[field] : planValue;
  return (
    <>
      <tr>
        <td>{lbl}</td>
        <td className="fig r">{num(planValue)}</td>
        <td className="fig r">{has ? <b>{num(t.overrides[field])}</b> : <span className="quiet">None</span>}</td>
        <td className="fig r">{num(inForce)}</td>
        <td className="acts">
          {canWrite && (
            <>
              <button className="link" onClick={() => { setClear(false); onOpen(); }}>{has ? "Change" : "Set"}</button>
              {has && <button className="link" onClick={() => { setClear(true); onOpen(); }}>Clear</button>}
            </>
          )}
        </td>
      </tr>
      {open && (
        <tr className="action-row">
          <td colSpan="5">
            <ReasonBox reason={reason} setReason={setReason} label={clear ? "Clear override" : "Save override"} busy={state?.busy}
                       sensitive disabled={!valid} title={`${clear ? "Clear" : "Set"} ${lbl.toLowerCase()} for ${t.name}`}
                       hint={clear ? `Returns to the plan's ${num(planValue)}.` : "A whole number, 0 or more."}
                       placeholder="For example: agreed extra capacity for the month-end run"
                       onCancel={onCancel}
                       onSubmit={async () => {
                         const r = await go(() => api(`${D}/tenants/${t.tenant_id}/overrides/${field}`, {
                           method: "PUT", body: { value: clear ? null : n, reason },
                         }));
                         if (r !== undefined) onDone(r);
                       }}>
              {!clear && (
                <label className="inline">New value
                  <input type="number" min="0" step="1" value={value} onChange={(e) => setValue(e.target.value)} className="wide-num" />
                </label>
              )}
            </ReasonBox>
            <ErrorLine error={state?.error} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ============================================================ API keys */

const MARK = /replaces (kse_(?:live|test)_[a-z0-9]+), revoke old by (\d{4}-\d{2}-\d{2})/;

export function Keys({ me, tenants, plans, onEnded, initialTenant, initialCreate, onChanged }) {
  const [tenantId, setTenantId] = useState(initialTenant ?? tenants[0]?.tenant_id ?? "");
  useEffect(() => { if (tenantId === "" && tenants.length) setTenantId(tenants[0].tenant_id); }, [tenants, tenantId]);
  const canWrite = can(me.team_role, "keyWrite");
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [showRevoked, setShowRevoked] = useState(false);
  // Arriving from a new grant opens "Create a key" for that client straight away.
  const [creating, setCreating] = useState(!!initialCreate && canWrite && initialTenant != null);
  const [mode, setMode] = useState(null);          // { kind: "revoke"|"rotate", id, reason? }
  const [shown, setShown] = useState(null);        // { title, value, notice, after }

  const load = useCallback(() => {
    if (tenantId === "") return;
    setError(null);
    api(`${D}/tenants/${tenantId}/keys`).then((d) => setItems(d.items || [])).catch((e) => { if (!onEnded(e)) setError(e); });
  }, [tenantId, onEnded]);
  // Open forms close only when the chosen client changes, not on the first load.
  const shownFor = useRef(tenantId);
  useEffect(() => {
    if (shownFor.current !== tenantId) { shownFor.current = tenantId; setMode(null); setCreating(false); }
    setItems(null);
    load();
  }, [load, tenantId]);

  const tenant = tenants.find((t) => t.tenant_id === Number(tenantId));
  const keyLimit = limitOf(tenant, plans, "max_credentials");
  const active = (items || []).filter((k) => k.status === "active");
  const today = todayPkt();
  // Rotation markers on active keys point at the key they replace.
  const replacedBy = {};
  for (const k of active) {
    const m = MARK.exec(k.name || "");
    if (m) replacedBy[m[1]] = { date: m[2], by: k.prefix };
  }
  const list = (items || []).filter((k) => showRevoked || k.status === "active")
    .sort((a, b) => (a.status === b.status ? (a.created_at < b.created_at ? 1 : -1) : a.status === "active" ? -1 : 1));

  const afterShown = () => {
    const after = shown?.after;
    setShown(null);
    if (after) setMode(after);
  };

  return (
    <>
      <div className="toolbar">
        <label>Client
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value === "" ? "" : Number(e.target.value))}>
            {tenants.map((t) => <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Show revoked keys</label>
        {canWrite && !creating && !shown && tenantId !== "" && (
          <button className="primary" onClick={() => { setCreating(true); setMode(null); }}>Create a key</button>
        )}
      </div>
      {items && <p className="hint">{active.length} active{keyLimit != null ? ` of ${keyLimit} allowed` : ""}. Keys are stored only as a hash; nobody can see an existing key, including this console.</p>}

      {shown && (
        <ShowOnce title={shown.title} value={shown.value} notice={shown.notice} copyLabel="Copy key" onClose={afterShown}>
          {shown.extra && <p className="hint">{shown.extra}</p>}
        </ShowOnce>
      )}
      {creating && !shown && (
        <CreateKey tenantId={tenantId} onEnded={onEnded} onCancel={() => setCreating(false)}
                   onCreated={(r) => {
                     setCreating(false);
                     setShown({ title: `New key ${r.prefix}`, value: r.key, notice: r.notice });
                     load(); onChanged();
                   }} />
      )}

      <ErrorLine error={error} />
      {!items && !error && <p className="quiet">Loading</p>}
      {items && (list.length === 0 ? <p className="quiet">{showRevoked ? "No keys." : "No active keys."}</p> : (
        <div className="scroll">
          <table className="plain">
            <thead><tr><th>Key</th><th>Kind</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Expires</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((k) => {
                const rep = replacedBy[k.prefix];
                const flag = k.status === "active" && rep
                  ? (today >= rep.date
                    ? <Badge tone="bad">Due for revoke since {rep.date}</Badge>
                    : <Badge tone="warn">Replaced by {rep.by}, overlap until {rep.date}</Badge>)
                  : null;
                return (
                  <KeyRow key={k.id} k={k} flag={flag} canWrite={canWrite && !shown} mode={mode?.id === k.id ? mode : null}
                          tenantId={tenantId} onEnded={onEnded}
                          onMode={(m) => { setCreating(false); setMode(m); }}
                          onDone={(next) => { setMode(null); if (next?.shown) setShown(next.shown); load(); onChanged(); }} />
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function KeyRow({ k, flag, canWrite, mode, tenantId, onEnded, onMode, onDone }) {
  const activeKey = k.status === "active";
  return (
    <>
      <tr className={activeKey ? "" : "dim"}>
        <td><span className="fig">{k.prefix}</span><span className="sub">{k.name}</span>{flag && <span className="sub">{flag}</span>}</td>
        <td>{k.kind === "test" ? "Test" : "Live"}</td>
        <td className="scope-cell">{(k.scopes || []).join(", ")}{k.ip_allowlist?.length ? <span className="sub">Addresses: {k.ip_allowlist.join(", ")}</span> : null}</td>
        <td className="fig">{when(k.created_at)}<span className="sub">{k.created_by}</span></td>
        <td className="fig">{k.last_used_at ? when(k.last_used_at) : <span className="quiet">Never</span>}</td>
        <td className="fig">{k.expires_at ? when(k.expires_at) : <span className="quiet">No expiry</span>}</td>
        <td>{activeKey ? <Badge tone="good">Active</Badge> : <><Badge tone="quiet">{k.status}</Badge>{k.revoked_at && <span className="sub">{when(k.revoked_at)}{k.revoked_reason ? `: ${k.revoked_reason}` : ""}</span>}</>}</td>
        <td className="acts">
          {activeKey && canWrite && !mode && (
            <>
              <button className="link" onClick={() => onMode({ kind: "rotate", id: k.id })}>Rotate</button>
              <button className="link" onClick={() => onMode({ kind: "revoke", id: k.id })}>Revoke</button>
            </>
          )}
        </td>
      </tr>
      {mode && (
        <tr className="action-row">
          <td colSpan="8">
            {mode.kind === "revoke" && <Revoke k={k} initialReason={mode.reason} onEnded={onEnded} onDone={() => onDone()} onCancel={() => onMode(null)} />}
            {mode.kind === "rotate" && <Rotate k={k} tenantId={tenantId} onEnded={onEnded} onDone={onDone} onCancel={() => onMode(null)} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Revoke({ k, initialReason = "", onEnded, onDone, onCancel }) {
  const [reason, setReason] = useState(initialReason);
  const [state, go] = useAction(onEnded);
  return (
    <>
      <ReasonBox reason={reason} setReason={setReason} label="Revoke key" busy={state?.busy} sensitive danger
                 title={`Revoke ${k.prefix}`} hint="The key stops working at once. This cannot be undone."
                 confirmText="Revoke this key now? Any system still using it is refused from this moment."
                 placeholder="For example: replaced by a rotated key" onCancel={onCancel}
                 onSubmit={async () => {
                   const r = await go(() => api(`${D}/keys/${encodeURIComponent(k.id)}/revoke`, { method: "POST", body: { reason } }));
                   if (r !== undefined) onDone();
                 }} />
      <ErrorLine error={state?.error} />
    </>
  );
}

function Rotate({ k, tenantId, onEnded, onDone, onCancel }) {
  const [days, setDays] = useState(7);
  const [state, go] = useAction(onEnded);
  const valid = Number.isInteger(days) && days >= 0 && days <= 30;
  const until = addDaysPkt(valid ? days : 0);
  const marker = `replaces ${k.prefix}, revoke old by ${until}`;
  const base = (k.name || "").replace(MARK, "").replace(/[:\s]+$/, "");
  const name = base && `${base}: ${marker}`.length <= 64 ? `${base}: ${marker}` : marker;
  async function create() {
    const r = await go(() => api(`${D}/tenants/${tenantId}/keys`, {
      method: "POST",
      body: { name, kind: k.kind, scopes: k.scopes, ip_allowlist: k.ip_allowlist || [], expires_at: k.expires_at || null },
    }));
    if (r === undefined) return;
    onDone({
      shown: {
        title: `New key ${r.prefix}, replacing ${k.prefix}`,
        value: r.key,
        notice: r.notice,
        extra: days === 0
          ? `Next: the old key ${k.prefix} is revoked once you hide this key.`
          : `The old key ${k.prefix} stays active until ${until}. After that date it is flagged "Due for revoke" in this list.`,
        after: days === 0 ? { kind: "revoke", id: k.id, reason: `Rotated, replaced by ${r.prefix}` } : null,
      },
    });
  }
  return (
    <div className="reasoned">
      <b>Rotate {k.prefix}</b>
      <span className="hint">A new key is created with the same kind ({k.kind}), scopes ({(k.scopes || []).join(", ")}) and address list. The client switches to it during the overlap; then the old key is revoked.</span>
      <label className="inline">Keep the old key active for
        <input type="number" min="0" max="30" value={days} onChange={(e) => setDays(e.target.value === "" ? 0 : Number(e.target.value))} /> days
        <span className="hint">{days === 0 ? "No overlap: the old key is revoked right after the new one is shown." : `Revoke the old key on or after ${until} (PKT).`}</span>
      </label>
      <span className="hint">New key name: <code className="key">{name}</code></span>
      <span className="hint">Needs a recent authenticator code; you will be asked for one if it has expired. The client's key limit must have room for one more active key during the overlap.</span>
      <div className="row">
        <button type="button" className="primary" disabled={!valid || state?.busy} onClick={create}>{state?.busy ? "Creating" : "Create the new key"}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
      <ErrorLine error={state?.error} />
    </div>
  );
}

function CreateKey({ tenantId, onEnded, onCreated, onCancel }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("live");
  const [scopes, setScopes] = useState(DEFAULT_SCOPES);
  const [ips, setIps] = useState("");
  const [expires, setExpires] = useState("");
  const [state, go] = useAction(onEnded);
  const today = todayPkt();
  const ipList = ips.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const valid = name.trim().length >= 1 && name.trim().length <= 64 && scopes.length > 0 && (!expires || expires > today);
  async function submit() {
    const r = await go(() => api(`${D}/tenants/${tenantId}/keys`, {
      method: "POST",
      body: { name: name.trim(), kind, scopes, ip_allowlist: ipList, expires_at: expires ? endOfDayPkt(expires) : null },
    }));
    if (r !== undefined) onCreated(r);
  }
  return (
    <div className="reasoned top-gap">
      <b>Create a key</b>
      <div className="form-grid">
        <label>Name (what it is for)<input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="For example: Reporting dashboard" /></label>
        <label>Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="live">Live</option>
            <option value="test">Test</option>
          </select>
        </label>
        <label>Expires (optional)
          <input type="date" min={addDaysPkt(1)} value={expires} onChange={(e) => setExpires(e.target.value)} />
          <span className="hint">{expires ? "At the end of that day, PKT." : "No expiry."}</span>
        </label>
      </div>
      <fieldset className="scopes">
        <legend>Scopes</legend>
        {SCOPES.map(([s, l]) => (
          <label key={s} className="check">
            <input type="checkbox" checked={scopes.includes(s)}
                   onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
            {l} <span className="fig quiet">{s}</span>
          </label>
        ))}
      </fieldset>
      <label>Allowed addresses (optional, one per line; empty means any)
        <textarea rows="2" value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.10" />
      </label>
      <span className="hint">Needs a recent authenticator code. The key is shown once, here, and is not stored anywhere.</span>
      <div className="row">
        <button type="button" className="primary" disabled={!valid || state?.busy} onClick={submit}>{state?.busy ? "Creating" : "Create key"}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
      <ErrorLine error={state?.error} />
    </div>
  );
}
