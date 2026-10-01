/*
 * src/Billing.jsx  (kse-sentinel-ops, Sep 30 2026)
 *
 * BILLING AND PAYMENTS, Phase F part 1 (Finance and Owner).
 *   Payments   one review queue: suggested invoice with its confidence and why;
 *              confirm, query or reject, each with a reason; record by hand
 *   Invoices   issue (numbered, the client's payment reference), print, void
 *   Import     any bank's CSV: choose the date, description and credit columns
 *              once (remembered in this browser); duplicates are skipped
 *   Settings   issuer, bank account, tax rate (Owner edits; invoices wait until
 *              issuer name, account title and IBAN are filled in)
 * Backend: app/routers/ops_billing.py
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const num = (n) => (n == null ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const day = (s) => (s ? DAY.format(new Date(`${String(s).slice(0, 10)}T12:00:00`)) : "");
const PAY_STATUS = { RECEIVED: "Received", MATCHED: "Suggested match", CONFIRMED: "Confirmed", QUERIED: "Queried", REJECTED: "Rejected" };
const INV_STATUS = { ISSUED: "Unpaid", PAID: "Paid", VOID: "Void" };
const MAPPING_KEY = "kse_ops_statement_columns";

export default function Billing({ onEnded, role }) {
  const [tab, setTab] = useState("payments");
  const [settings, setSettings] = useState(null);
  const [printing, setPrinting] = useState(null);
  const loadSettings = useCallback(() => {
    api("/api/v1/ops-console/billing/settings").then(setSettings).catch((e) => onEnded(e));
  }, [onEnded]);
  useEffect(loadSettings, [loadSettings]);
  if (printing) return <InvoicePrint inv={printing} onClose={() => setPrinting(null)} />;
  return (
    <section className="billing">
      <h1>Billing</h1>
      {settings && !settings.ready_to_invoice && (
        <p className="note">Billing settings are incomplete: invoices can be issued once the issuing company, account title and IBAN are filled in{role === "owner" ? " (Settings tab)" : " by the Owner"}.</p>
      )}
      <div className="tabs" role="tablist">
        {[["payments", "Payments"], ["invoices", "Invoices"], ["import", "Import statement"], ["settings", "Settings"]].map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>
      {tab === "payments" && <Payments onEnded={onEnded} />}
      {tab === "invoices" && <Invoices onEnded={onEnded} ready={settings?.ready_to_invoice} settings={settings} onPrint={setPrinting} />}
      {tab === "import" && <Import onEnded={onEnded} onDone={() => setTab("payments")} />}
      {tab === "settings" && settings && <Settings settings={settings} onEnded={onEnded} onSaved={loadSettings} />}
    </section>
  );
}

/* ------------------------------------------------------------ payments queue */

function Payments({ onEnded }) {
  const [filter, setFilter] = useState("RECEIVED,MATCHED,QUERIED");
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    api(`/api/v1/ops-console/billing/payments?status=${filter}`).then((d) => { setData(d); setError(null); }).catch((e) => { if (!onEnded(e)) setError(e.message); });
    api("/api/v1/ops-console/billing/invoices?status=ISSUED").then((d) => setInvoices(d.invoices)).catch(() => {});
  }, [filter, onEnded]);
  useEffect(load, [load]);
  return (
    <>
      <div className="tabs sub-tabs">
        {[["RECEIVED,MATCHED,QUERIED", "To review"], ["CONFIRMED", "Confirmed"], ["REJECTED", "Rejected"], ["ALL", "All"]].map(([v, l]) => (
          <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>
        ))}
        <button className="quietbtn inline-btn" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Record a payment by hand"}</button>
      </div>
      {adding && <ManualPayment onEnded={onEnded} onDone={() => { setAdding(false); load(); }} />}
      {error && <p className="msg bad">{error}</p>}
      {data && (data.payments.length === 0 ? <p className="quiet">Nothing here.</p> : (
        <div className="scroll">
          <table className="plain nums">
            <thead><tr><th>Paid on</th><th className="r">Amount (PKR)</th><th>Bank description</th><th>Suggested invoice</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.payments.map((p) => <PaymentRow key={p.payment_id} p={p} invoices={invoices} onEnded={onEnded} onChanged={load} />)}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function PaymentRow({ p, invoices, onEnded, onChanged }) {
  const [mode, setMode] = useState(null);
  const open = ["RECEIVED", "MATCHED", "QUERIED"].includes(p.status);
  return (
    <>
      <tr>
        <td className="fig">{day(p.paid_on)}</td>
        <td className="r fig">{num(p.amount_pkr)}</td>
        <td className="why">{p.description}{p.payer_name ? <span className="sub">{p.payer_name}</span> : null}</td>
        <td>
          {p.invoice_number ? <>{p.invoice_number}<span className="sub">{p.company_name}</span></> : <span className="quiet">None</span>}
          {p.match_confidence && <span className={`conf conf-${p.match_confidence.toLowerCase()}`}>{p.match_confidence === "HIGH" ? "Strong match" : "Check this"}</span>}
          {p.match_reason && <span className="sub">{p.match_reason}</span>}
        </td>
        <td>{PAY_STATUS[p.status] || p.status}{p.note && !open ? <span className="sub">{p.note}</span> : null}{p.status === "QUERIED" && p.note ? <span className="sub">{p.note}</span> : null}</td>
        <td className="acts">
          {open && !mode && (
            <>
              <button className="link" onClick={() => setMode("confirm")}>Confirm</button>
              {p.status !== "QUERIED" && <button className="link" onClick={() => setMode("query")}>Query</button>}
              <button className="link" onClick={() => setMode("reject")}>Reject</button>
            </>
          )}
        </td>
      </tr>
      {mode && (
        <tr className="action-row"><td colSpan="6">
          <PaymentAction p={p} mode={mode} invoices={invoices} onEnded={onEnded} onDone={() => { setMode(null); onChanged(); }} onCancel={() => setMode(null)} />
        </td></tr>
      )}
    </>
  );
}

function PaymentAction({ p, mode, invoices, onEnded, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [inv, setInv] = useState(p.invoice_id || "");
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState(null);
  const chosen = invoices.find((i) => i.invoice_id === inv);
  const short = chosen && p.amount_pkr < chosen.total_pkr;
  const cfg = {
    confirm: { label: "Confirm payment", danger: false, placeholder: "For example: reference and amount match the bank statement" },
    query: { label: "Query with the client", danger: false, placeholder: "What needs clarifying? The client will be asked this." },
    reject: { label: "Reject", danger: true, placeholder: "Why is this not a valid payment?" },
  }[mode];
  const ok = reason.trim().length >= 5 && (mode !== "confirm" || (inv && !short));
  async function go() {
    if (mode === "confirm" && !confirm) { setConfirm(true); return; }
    if (mode === "reject" && !confirm) { setConfirm(true); return; }
    setState({ busy: true });
    try {
      const body = mode === "confirm" ? { reason, invoice_id: inv } : { reason };
      const r = await api(`/api/v1/ops-console/billing/payments/${p.payment_id}/${mode}`, { method: "POST", body });
      if (mode === "confirm") setState({ ok: `Confirmed: ${r.invoice_number} paid; client ${r.client_status === "PAID_ACTIVE" ? "active" : r.client_status}${r.paid_until ? `, paid until ${day(r.paid_until)}` : ""}.` });
      setTimeout(onDone, mode === "confirm" ? 1200 : 0);
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <div className={`reasoned ${cfg.danger ? "danger" : ""}`}>
      <b>{cfg.label}: PKR {num(p.amount_pkr)} of {day(p.paid_on)}</b>
      {mode === "confirm" && (
        <label>Invoice this payment settles
          <select value={inv} onChange={(e) => { setInv(e.target.value); setConfirm(false); }}>
            <option value="">Choose an unpaid invoice</option>
            {invoices.map((i) => <option key={i.invoice_id} value={i.invoice_id}>{i.number}: {i.company_name}, PKR {num(i.total_pkr)}</option>)}
          </select>
          {short && <span className="hint bad-text">The payment is less than this invoice total (PKR {num(chosen.total_pkr)}). Query it instead.</span>}
          {chosen && !short && p.amount_pkr > chosen.total_pkr && <span className="hint">Overpaid by PKR {num(p.amount_pkr - chosen.total_pkr)}: note how it is to be handled in the reason.</span>}
        </label>
      )}
      <label>Reason, recorded in the audit trail
        <textarea rows="2" value={reason} placeholder={cfg.placeholder} onChange={(e) => { setReason(e.target.value); setConfirm(false); }} />
      </label>
      {confirm && mode === "confirm" && chosen && (
        <p className="confirm neutral">This marks {chosen.number} paid and makes {chosen.company_name} an active paying client{chosen.period_end ? `, paid until ${day(chosen.period_end)}` : ""}. Continue?</p>
      )}
      {confirm && mode === "reject" && <p className="confirm">Reject this payment? It stays on record as rejected.</p>}
      <div className="row">
        <button className={cfg.danger ? "danger" : "primary"} disabled={!ok || state?.busy || state?.ok} onClick={go}>
          {state?.busy ? "Saving" : confirm ? `Yes, ${cfg.label.toLowerCase()}` : cfg.label}
        </button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
      {state?.ok && <p className="msg good">{state.ok}</p>}
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </div>
  );
}

function ManualPayment({ onEnded, onDone }) {
  const [f, setF] = useState({ amount_pkr: "", paid_on: new Date().toISOString().slice(0, 10), description: "", payer_name: "", channel_txn_id: "", reason: "" });
  const [state, setState] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = Number(f.amount_pkr) > 0 && f.paid_on && f.description.trim().length >= 3 && f.reason.trim().length >= 5;
  async function save(e) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api("/api/v1/ops-console/billing/payments", { method: "POST", body: { ...f, amount_pkr: Math.round(Number(f.amount_pkr)) } });
      onDone();
    } catch (err) {
      if (!onEnded(err)) setState({ bad: err.message });
    }
  }
  return (
    <form className="block" onSubmit={save}>
      <div className="form-grid">
        <label>Amount received (PKR)<input type="number" min="1" value={f.amount_pkr} onChange={set("amount_pkr")} /></label>
        <label>Date received<input type="date" value={f.paid_on} onChange={set("paid_on")} /></label>
        <label>Description, as on the bank statement<input value={f.description} onChange={set("description")} placeholder="Include the invoice number if quoted" /></label>
        <label>Payer (optional)<input value={f.payer_name} onChange={set("payer_name")} /></label>
        <label>Bank transaction ID (optional)<input value={f.channel_txn_id} onChange={set("channel_txn_id")} /><span className="hint">Prevents the same payment being recorded twice.</span></label>
      </div>
      <div className="reasoned">
        <label>Reason, recorded in the audit trail<textarea rows="2" value={f.reason} onChange={set("reason")} placeholder="For example: cheque deposited, not yet on the exported statement" /></label>
        <div className="row"><button className="primary" disabled={!ok || state?.busy}>Record payment</button></div>
        {state?.bad && <p className="msg bad">{state.bad}</p>}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ invoices */

function Invoices({ onEnded, ready, settings, onPrint }) {
  const [data, setData] = useState(null);
  const [clients, setClients] = useState([]);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api("/api/v1/ops-console/billing/invoices").then(setData).catch((e) => { if (!onEnded(e)) setError(e.message); });
    api("/api/v1/ops-console/billing/clients").then((d) => setClients(d.clients)).catch(() => {});
  }, [onEnded]);
  useEffect(load, [load]);
  const tax = Number(settings?.settings?.find((s) => s.key === "tax_rate_pct")?.value || 0);
  return (
    <>
      <div className="row-between">
        <p className="quiet">The invoice number is the payment reference the client quotes on their transfer.</p>
        <button className="primary" disabled={!ready} onClick={() => setIssuing(!issuing)}>{issuing ? "Close" : "Issue an invoice"}</button>
      </div>
      {issuing && <IssueInvoice clients={clients} tax={tax} onEnded={onEnded} onDone={(inv) => { setIssuing(false); load(); onPrint(inv); }} />}
      {error && <p className="msg bad">{error}</p>}
      {data && (data.invoices.length === 0 ? <p className="quiet">No invoices yet.</p> : (
        <div className="scroll">
          <table className="plain nums">
            <thead><tr><th>Number</th><th>Client</th><th>For</th><th>Period</th><th className="r">Total (PKR)</th><th>Status</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {data.invoices.map((i) => <InvoiceRow key={i.invoice_id} i={i} onEnded={onEnded} onChanged={load} onPrint={onPrint} />)}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function InvoiceRow({ i, onEnded, onChanged, onPrint }) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState(null);
  async function doVoid() {
    setState({ busy: true });
    try {
      await api(`/api/v1/ops-console/billing/invoices/${i.invoice_id}/void`, { method: "POST", body: { reason } });
      onChanged();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <>
      <tr>
        <td className="fig">{i.number}</td>
        <td>{i.company_name}</td>
        <td className="why">{i.description}</td>
        <td className="fig">{i.period_start || i.period_end ? `${day(i.period_start)} to ${day(i.period_end)}` : ""}</td>
        <td className="r fig">{num(i.total_pkr)}</td>
        <td className={i.status === "PAID" ? "up" : i.status === "VOID" ? "quiet" : ""}>{INV_STATUS[i.status] || i.status}{i.status === "PAID" && i.paid_at ? <span className="sub">{day(i.paid_at)}</span> : null}</td>
        <td className="fig">{i.status === "ISSUED" ? day(i.due_date) : ""}</td>
        <td className="acts">
          <button className="link" onClick={() => onPrint(i)}>{i.status === "PAID" ? "Receipt" : "View / print"}</button>
          {i.status === "ISSUED" && !voiding && <button className="link" onClick={() => setVoiding(true)}>Void</button>}
        </td>
      </tr>
      {voiding && (
        <tr className="action-row"><td colSpan="8">
          <div className="reasoned danger">
            <label>Reason for voiding, recorded in the audit trail<textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="row">
              <button className="danger" disabled={reason.trim().length < 5 || state?.busy} onClick={doVoid}>Void {i.number}</button>
              <button className="link" onClick={() => setVoiding(false)}>Cancel</button>
            </div>
            {state?.bad && <p className="msg bad">{state.bad}</p>}
          </div>
        </td></tr>
      )}
    </>
  );
}

function IssueInvoice({ clients, tax, onEnded, onDone }) {
  const [f, setF] = useState({ tenant_id: "", description: "", amount_pkr: "", period_start: "", period_end: "", reason: "" });
  const [state, setState] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const client = clients.find((c) => String(c.tenant_id) === String(f.tenant_id));
  const amt = Math.round(Number(f.amount_pkr) || 0);
  const taxAmt = Math.round((amt * tax) / 100);
  const ok = client && amt > 0 && f.description.trim().length >= 3 && f.reason.trim().length >= 5 && (!f.period_start || !f.period_end || f.period_end >= f.period_start);
  async function issue(e) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api("/api/v1/ops-console/billing/invoices", { method: "POST", body: { ...f, tenant_id: Number(f.tenant_id), amount_pkr: amt, period_start: f.period_start || null, period_end: f.period_end || null } });
      onDone(r.invoice);
    } catch (err) {
      if (!onEnded(err)) setState({ bad: err.message });
    }
  }
  return (
    <form className="block" onSubmit={issue}>
      <div className="form-grid">
        <label>Client
          <select value={f.tenant_id} onChange={(e) => {
            const c = clients.find((x) => String(x.tenant_id) === e.target.value);
            setF({ ...f, tenant_id: e.target.value, amount_pkr: f.amount_pkr || (c?.pilot_type === "PAID_PILOT" && c?.pilot_fee_pkr ? String(c.pilot_fee_pkr) : "") });
          }}>
            <option value="">Choose a client</option>
            {clients.map((c) => <option key={c.tenant_id} value={c.tenant_id}>{c.company_name}</option>)}
          </select>
          {client && <span className="hint">{client.pilot_type === "PAID_PILOT" ? `Paid pilot, agreed fee PKR ${num(client.pilot_fee_pkr)}. ` : ""}{client.paid_until ? `Paid until ${day(client.paid_until)}.` : "Not paid up yet."}</span>}
        </label>
        <label>For (printed on the invoice)<input value={f.description} onChange={set("description")} placeholder="For example: Subscription, October 2026, 3 seats" /></label>
        <label>Amount before tax (PKR)<input type="number" min="1" value={f.amount_pkr} onChange={set("amount_pkr")} /></label>
        <label>Period from<input type="date" value={f.period_start} onChange={set("period_start")} /></label>
        <label>Period to<input type="date" value={f.period_end} onChange={set("period_end")} /><span className="hint">Once paid, the client is paid up to this date.</span></label>
      </div>
      {amt > 0 && <p className="quiet small">Total PKR {num(amt + taxAmt)}{tax ? ` (PKR ${num(amt)} plus ${tax}% tax, PKR ${num(taxAmt)})` : " (no tax set)"}.</p>}
      <div className="reasoned">
        <label>Reason, recorded in the audit trail<textarea rows="2" value={f.reason} onChange={set("reason")} placeholder="For example: first month after the pilot" /></label>
        <div className="row"><button className="primary" disabled={!ok || state?.busy}>{state?.busy ? "Issuing" : "Issue invoice"}</button></div>
        {state?.bad && <p className="msg bad">{state.bad}</p>}
      </div>
    </form>
  );
}

function InvoicePrint({ inv, onClose }) {
  const s = inv.issuer || {};
  const paid = inv.status === "PAID";
  return (
    <div className="print-wrap">
      <div className="print-bar no-print">
        <button className="primary" onClick={() => window.print()}>Print or save as PDF</button>
        <button className="link" onClick={onClose}>Back to billing</button>
      </div>
      <article className="invoice">
        <header>
          <div>
            <div className="inv-brand">{s.issuer_name || "Issuer not set"}</div>
            {s.issuer_address && <div className="inv-addr">{s.issuer_address}</div>}
            {s.issuer_ntn && <div className="inv-addr">NTN {s.issuer_ntn}</div>}
          </div>
          <div className="inv-title">
            <div className="inv-kind">{paid ? "Receipt" : inv.status === "VOID" ? "Invoice (void)" : "Invoice"}</div>
            <div className="fig">{inv.number}</div>
          </div>
        </header>
        <dl className="inv-meta">
          <div><dt>Billed to</dt><dd>{inv.company_name}</dd></div>
          <div><dt>Issued</dt><dd>{day(inv.issued_at)}</dd></div>
          {!paid && inv.status !== "VOID" && <div><dt>Due</dt><dd>{day(inv.due_date)}</dd></div>}
          {paid && <div><dt>Paid</dt><dd>{day(inv.paid_at)}</dd></div>}
        </dl>
        <table className="inv-lines">
          <thead><tr><th>Description</th><th>Period</th><th className="r">Amount (PKR)</th></tr></thead>
          <tbody>
            <tr><td>{inv.description}</td><td>{inv.period_start || inv.period_end ? `${day(inv.period_start)} to ${day(inv.period_end)}` : ""}</td><td className="r fig">{num(inv.amount_pkr)}</td></tr>
          </tbody>
          <tfoot>
            {inv.tax_pkr > 0 && <tr><td colSpan="2">Tax ({inv.tax_rate_pct}%)</td><td className="r fig">{num(inv.tax_pkr)}</td></tr>}
            <tr className="total"><td colSpan="2">{paid ? "Total received" : "Total due"}</td><td className="r fig">PKR {num(inv.total_pkr)}</td></tr>
          </tfoot>
        </table>
        {paid ? (
          <p className="inv-paid">Received with thanks. This receipt confirms payment of invoice {inv.number} in full.</p>
        ) : inv.status === "VOID" ? (
          <p className="inv-paid">This invoice has been voided{inv.void_reason ? `: ${inv.void_reason}` : ""}.</p>
        ) : (
          <div className="inv-pay">
            <b>How to pay</b>
            <p>By bank transfer to:</p>
            <dl>
              <div><dt>Account title</dt><dd>{s.account_title}</dd></div>
              {s.bank_name && <div><dt>Bank</dt><dd>{s.bank_name}</dd></div>}
              <div><dt>IBAN</dt><dd className="fig">{(s.iban || "").replace(/(.{4})/g, "$1 ").trim()}</dd></div>
            </dl>
            <p><b>Quote the reference {inv.number}</b> in the transfer, so the payment is matched to this invoice.</p>
          </div>
        )}
        {s.invoice_note && <p className="inv-note">{s.invoice_note}</p>}
      </article>
    </div>
  );
}

/* ------------------------------------------------------------ statement import */

// Whole words only, in priority order ("cr" must not match "desCRiption"), and a
// column already chosen for another role is never offered again.
const guess = (cols, words, taken = []) => {
  const free = cols.filter((c) => !taken.includes(c));
  const wordsOf = (c) => c.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    const parts = w.split(" ");
    const hit = free.find((c) => { const ws = wordsOf(c); return parts.every((p) => ws.includes(p)); });
    if (hit) return hit;
  }
  return "";
};

function Import({ onEnded, onDone }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [prev, setPrev] = useState(null);
  const [map, setMap] = useState({});
  const [reason, setReason] = useState("");
  const [state, setState] = useState(null);
  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f.name); setState(null);
    const t = await f.text();
    setText(t);
    try {
      const p = await api("/api/v1/ops-console/billing/statements/preview", { method: "POST", body: { csv_text: t } });
      setPrev(p);
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(MAPPING_KEY) || "{}"); } catch { saved = {}; }
      const has = (c) => c && p.columns.includes(c);
      const m = {};
      const pickCol = (k, words) => { m[k] = has(saved[k]) ? saved[k] : guess(p.columns, words, Object.values(m)); };
      pickCol("date_column", ["transaction date", "txn date", "posting date", "date"]);
      pickCol("description_column", ["description", "narration", "particulars", "details", "remarks", "transaction"]);
      pickCol("credit_column", ["credit", "credits", "deposit", "deposits", "cr", "received"]);
      pickCol("debit_column", ["debit", "debits", "withdrawal", "withdrawals", "dr", "paid"]);
      m.reference_column = has(saved.reference_column) ? saved.reference_column : guess(p.columns, ["reference", "ref"], Object.values(m));
      setMap(m);
    } catch (err) {
      if (!onEnded(err)) setState({ bad: err.message });
    }
  }
  const ok = prev && map.date_column && map.description_column && map.credit_column && reason.trim().length >= 5;
  async function run() {
    setState({ busy: true });
    try {
      const r = await api("/api/v1/ops-console/billing/statements/import", {
        method: "POST",
        body: { reason, csv_text: text, filename: file, ...map, debit_column: map.debit_column || null, reference_column: map.reference_column || null },
      });
      try { localStorage.setItem(MAPPING_KEY, JSON.stringify(map)); } catch { /* remembered next time only if storage is available */ }
      setState({ done: r });
    } catch (err) {
      if (!onEnded(err)) setState({ bad: err.message });
    }
  }
  const idx = useMemo(() => Object.fromEntries((prev?.columns || []).map((c, i) => [c, i])), [prev]);
  if (state?.done) {
    const r = state.done;
    return (
      <div className="block">
        <p className="msg good">Imported {file}: {r.credits_added} payment(s) added, {r.matched} matched to an invoice, {r.duplicates_skipped} already recorded (skipped), {r.not_credits} line(s) were not money received.</p>
        {r.problems.length > 0 && <p className="msg bad">Could not read: {r.problems.join("; ")}</p>}
        <div className="row"><button className="primary" onClick={onDone}>Review the payments</button><button className="link" onClick={() => { setPrev(null); setFile(null); setState(null); setReason(""); }}>Import another file</button></div>
      </div>
    );
  }
  return (
    <div className="block">
      <p className="quiet">Export the statement from your bank as <b>CSV</b> (from Excel: File, Save As, CSV) and choose it here. Only money received is imported; a line already imported is skipped.</p>
      <label className="file">Statement file (.csv)<input type="file" accept=".csv,text/csv" onChange={pick} /></label>
      {prev && (
        <>
          <p className="quiet small">{prev.row_count} line(s) found. Check which columns hold what; your choice is remembered for next time.</p>
          <div className="form-grid">
            {[["date_column", "Date"], ["description_column", "Description / narration"], ["credit_column", "Money received (credit)"], ["debit_column", "Money paid out (debit), optional"], ["reference_column", "Reference, optional"]].map(([k, l]) => (
              <label key={k}>{l}
                <select value={map[k] || ""} onChange={(e) => setMap({ ...map, [k]: e.target.value })}>
                  <option value="">{k.includes("debit") || k.includes("reference") ? "None" : "Choose a column"}</option>
                  {prev.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="scroll">
            <table className="plain nums">
              <thead><tr><th>Date</th><th>Description</th><th className="r">Received</th></tr></thead>
              <tbody>
                {prev.sample.map((r, i) => (
                  <tr key={i}>
                    <td className="fig">{r[idx[map.date_column]] ?? ""}</td>
                    <td className="why">{r[idx[map.description_column]] ?? ""}</td>
                    <td className="r fig">{r[idx[map.credit_column]] ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="reasoned">
            <label>Reason, recorded in the audit trail<textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: September statement, main account" /></label>
            <div className="row"><button className="primary" disabled={!ok || state?.busy} onClick={run}>{state?.busy ? "Importing" : "Import"}</button></div>
          </div>
        </>
      )}
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ settings */

function Settings({ settings, onEnded, onSaved }) {
  const initial = Object.fromEntries(settings.settings.map((s) => [s.key, s.value || ""]));
  const [f, setF] = useState(initial);
  const [reason, setReason] = useState("");
  const [state, setState] = useState(null);
  const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== initial[k]));
  async function save() {
    setState({ busy: true });
    try {
      await api("/api/v1/ops-console/billing/settings", { method: "PUT", body: { reason, values: changed } });
      setReason(""); setState({ ok: "Saved." }); onSaved();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <div className="block">
      {!settings.can_edit && <p className="quiet">Only the Owner can change these.</p>}
      <div className="form-grid">
        {settings.settings.map((s) => (
          <label key={s.key}>{s.label}{settings.required.includes(s.key) ? " *" : ""}
            {s.key === "issuer_address" || s.key === "invoice_note"
              ? <textarea rows="2" value={f[s.key]} disabled={!settings.can_edit} onChange={(e) => setF({ ...f, [s.key]: e.target.value })} />
              : <input value={f[s.key]} disabled={!settings.can_edit} onChange={(e) => setF({ ...f, [s.key]: e.target.value })} />}
          </label>
        ))}
      </div>
      <p className="quiet small">* needed before invoices can be issued. Each invoice keeps the details as printed on it, so later changes do not alter invoices already issued.</p>
      {settings.can_edit && Object.keys(changed).length > 0 && (
        <div className="reasoned">
          <label>Reason, recorded in the audit trail<textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="row"><button className="primary" disabled={reason.trim().length < 5 || state?.busy} onClick={save}>Save settings</button></div>
        </div>
      )}
      {state?.ok && <p className="msg good">{state.ok}</p>}
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </div>
  );
}
