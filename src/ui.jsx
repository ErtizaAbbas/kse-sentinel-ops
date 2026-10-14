/*
 * src/ui.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * Small shared pieces for the Data API, Secrets and Team screens:
 * time formatting in PKT, an error line that carries the request id, the
 * reason box (minimum length per action), status badges, and the show-once
 * panel for a new API key or a password reset link.
 */
import { useState } from "react";

/* ------------------------------------------------------------ time */

const PKT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const PKT_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });
const PKT_ISO = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" });

// The Data API sends some times without a zone (they are UTC) and with
// microseconds; both are normalised before parsing.
export function parseTime(v) {
  if (!v) return null;
  let s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T00:00:00Z";
  s = s.replace(/(\.\d{3})\d+/, "$1");
  if (s.includes("T") && !/([zZ]|[+-]\d\d:?\d\d)$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
export const when = (v) => { const d = parseTime(v); return d ? `${PKT.format(d)} PKT` : ""; };
export const day = (v) => { const d = parseTime(v); return d ? PKT_DAY.format(d) : ""; };
export const todayPkt = () => PKT_ISO.format(new Date());                       // "YYYY-MM-DD" in PKT
export const addDaysPkt = (n) => PKT_ISO.format(new Date(Date.now() + n * 86400000));
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);          // usage days are UTC
export const endOfDayPkt = (ymd) => new Date(`${ymd}T23:59:59+05:00`).toISOString();
export const startOfDayPkt = (ymd) => new Date(`${ymd}T00:00:00+05:00`).toISOString();

export function ago(seconds) {
  if (seconds == null) return "";
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}
export const num = (n) => (n == null ? "" : Number(n).toLocaleString("en-GB"));

/* ------------------------------------------------------------ errors and badges */

export function ErrorLine({ error }) {
  if (!error) return null;
  const msg = typeof error === "string" ? error : error.message;
  const ref = typeof error === "object" ? error.requestId : null;
  return (
    <p className="msg bad" role="alert">
      {msg}
      {ref && <span className="ref">Reference: <code>{ref}</code></span>}
    </p>
  );
}

export const Badge = ({ tone = "", children }) => <span className={`badge ${tone}`}>{children}</span>;

/* ------------------------------------------------------------ reason box */

/* No action without a written reason; a second, explicit confirmation for
   anything irreversible. `min` follows the backend: 5 characters for Data API
   and secrets actions, 10 for a client MFA reset. */
export function ReasonBox({ reason, setReason, min = 5, label, placeholder, onSubmit, onCancel, busy, disabled,
  danger, confirmText, sensitive, title, hint, children }) {
  const [confirming, setConfirming] = useState(false);
  const ok = reason.trim().length >= min;
  return (
    <div className={`reasoned ${danger ? "danger" : ""}`}>
      {title && <b>{title}</b>}
      {hint && <span className="hint">{hint}</span>}
      {children}
      <label>Reason, recorded in the audit trail
        <textarea rows="2" value={reason} placeholder={placeholder}
                  onChange={(e) => { setReason(e.target.value); setConfirming(false); }} />
      </label>
      {!ok && reason.length > 0 && <span className="hint">At least {min} characters.</span>}
      {sensitive && <span className="hint">Needs a recent authenticator code; you will be asked for one if it has expired.</span>}
      {confirming && <p className="confirm">{confirmText}</p>}
      <div className="row">
        <button type="button" className={danger ? "danger" : "primary"} disabled={!ok || busy || disabled}
                onClick={() => (confirmText && !confirming ? setConfirming(true) : onSubmit())}>
          {busy ? "Saving" : confirming ? `Yes, ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}
        </button>
        {onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ show once */

/* A value that exists only in this panel's memory: copied by the operator,
   then gone. It cannot be dismissed until the operator confirms it is kept. */
export function ShowOnce({ title, value, notice, copyLabel = "Copy", onClose, children }) {
  const [copied, setCopied] = useState(false);
  const [kept, setKept] = useState(false);
  return (
    <div className="showonce" role="alert">
      <p className="showonce-title">{title}</p>
      <p className="warn">Shown once. It is not stored anywhere and cannot be shown again.</p>
      {notice && <p className="hint">{notice}</p>}
      {children}
      <div className="row">
        <input readOnly value={value} onFocus={(e) => e.target.select()} aria-label={title} spellCheck="false" autoComplete="off" />
        <button type="button" className="primary" onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); }
        }}>{copied ? "Copied" : copyLabel}</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
        I have copied it and passed it on or stored it safely
      </label>
      <div className="row">
        <button type="button" className="outline" disabled={!kept} onClick={onClose}>Done, hide it</button>
      </div>
    </div>
  );
}
