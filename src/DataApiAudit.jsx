/*
 * src/DataApiAudit.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * DATA API: the Data API's own audit log, the authoritative record of admin
 * actions (spec Section 18.9). Each row is chained to the one before by a
 * hash, so an edited, removed or inserted row breaks the chain; "Verify
 * chain" recomputes it. Newest first, 50 at a time, "Show older" pages back.
 * Owner and Onboarding only.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { ErrorLine, num, when } from "./ui.jsx";

const D = "/api/v1/ops/dapi";
const ACTION_OK = /^[A-Za-z0-9_.:-]{1,64}$/;

export default function AuditLog({ tenants, nameOf, onEnded }) {
  const [tenant, setTenant] = useState("");
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState({ tenant: "", action: "" });
  const [rows, setRows] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const fetchPage = useCallback(async (filters, before) => {
    const q = new URLSearchParams({ limit: "50" });
    if (filters.tenant !== "") q.set("tenant_id", filters.tenant);
    if (filters.action) q.set("action", filters.action);
    if (before != null) q.set("before", String(before));
    return api(`${D}/audit?${q}`);
  }, []);

  const load = useCallback(async (filters) => {
    setBusy(true);
    setError(null);
    try {
      const d = await fetchPage(filters, null);
      setRows(d.items || []);
      setNext(d.next_before ?? null);
    } catch (e) {
      if (!onEnded(e)) setError(e);
    } finally {
      setBusy(false);
    }
  }, [fetchPage, onEnded]);
  useEffect(() => { load(applied); }, [load, applied]);

  async function older() {
    setBusy(true);
    try {
      const d = await fetchPage(applied, next);
      setRows([...(rows || []), ...(d.items || [])]);
      setNext((d.items || []).length ? d.next_before ?? null : null);
    } catch (e) {
      if (!onEnded(e)) setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function runVerify() {
    setVerifying(true);
    setVerify(null);
    try {
      setVerify(await api(`${D}/audit/verify`));
    } catch (e) {
      if (!onEnded(e)) setVerify({ error: e });
    } finally {
      setVerifying(false);
    }
  }

  const actionValid = action.trim() === "" || ACTION_OK.test(action.trim());
  return (
    <>
      <div className="row-between">
        <p className="quiet small">Every admin action on the Data API, with who, when and why. Rows cannot be edited or removed.</p>
        <button className="outline inline-btn" disabled={verifying} onClick={runVerify}>{verifying ? "Verifying" : "Verify chain"}</button>
      </div>
      {verify && !verify.error && (
        verify.ok
          ? <p className="msg good">Chain intact: all {num(verify.rows)} rows check out.</p>
          : <p className="msg bad">Chain broken at row {verify.first_broken_seq}: {verify.problem}. Report this to the Owner at once.</p>
      )}
      {verify?.error && <ErrorLine error={verify.error} />}

      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); if (actionValid) setApplied({ tenant, action: action.trim() }); }}>
        <label>Client
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            <option value="">All</option>
            {tenants.map((t) => <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>)}
          </select>
        </label>
        <label>Action
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="For example credential.revoke" />
        </label>
        <button className="outline" disabled={!actionValid}>Filter</button>
        {!actionValid && <span className="hint bad-text">Letters, digits and . _ : - only.</span>}
      </form>

      <ErrorLine error={error} />
      {!rows && !error && <p className="quiet">Loading</p>}
      {rows && (rows.length === 0 ? <p className="quiet">No entries.</p> : (
        <div className="scroll">
          <table className="plain audit-table">
            <thead><tr><th className="r">Row</th><th>Time (PKT)</th><th>Who</th><th>Action</th><th>Client</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.seq}>
                  <td className="fig r">{a.seq}</td>
                  <td className="fig">{when(a.at).replace(" PKT", "")}</td>
                  <td>{a.actor}</td>
                  <td className="fig">{a.action}</td>
                  <td>{a.tenant_id == null ? <span className="quiet">None</span> : nameOf(a.tenant_id)}</td>
                  <td className="fig">{a.target}</td>
                  <td className="why"><Details d={a.details} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {rows && next != null && (
        <button className="quietbtn" disabled={busy} onClick={older}>{busy ? "Loading" : "Show older"}</button>
      )}
    </>
  );
}

function Details({ d }) {
  if (!d || typeof d !== "object") return null;
  const entries = Object.entries(d);
  if (entries.length === 0) return null;
  return (
    <dl className="kv">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/_/g, " ")}</dt>
          <dd>{v == null ? "none" : Array.isArray(v) ? (v.length ? v.join(", ") : "none") : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
