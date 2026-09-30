/*
 * src/App.jsx  (kse-sentinel-ops, Sep 29 2026)
 *
 * Sentinel Operations, Phase A: the MZE Digital team's internal console.
 * Spec: KSE_Sentinel_Operations_Console_Spec.md (v3).
 *
 *   Overview    queue counts, trials ending within 7 days, recent actions
 *   Onboarding  queue on the left, the selected record on the right:
 *               details, reviewer checklist, decisions, trial controls, history
 *   Audit       every console action (owner only)
 *
 * Every decision needs a written reason: the button stays disabled until one
 * is given, and irreversible decisions ask for a second confirmation.
 * Times are shown in Pakistan time (PKT).
 */
import { useCallback, useEffect, useState } from "react";
import { api, hasSession, SessionEnded, signIn, signOut, setupMfa, verifyMfa } from "./api.js";
import QRCode from "qrcode";
import Engine from "./Engine.jsx";
import Team from "./Team.jsx";
import Join from "./Join.jsx";

/* ------------------------------------------------------------ vocabulary */

const STATUS = {
  PENDING_REVIEW: "Pending review",
  MORE_INFO_REQUESTED: "Waiting for client information",
  TRIAL_ACTIVE: "On trial",
  TRIAL_EXPIRED: "Trial ended",
  PAID_ACTIVE: "Paid",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};
const ACTION = {
  "signup.more_info_requested": "Asked for more information",
  "signup.checklist_updated": "Updated the checklist",
  "signup.details_updated": "Updated the details",
  "signup.approved": "Approved",
  "signup.rejected": "Rejected",
  "trial.extended": "Extended the trial",
  "trial.restarted": "Restarted the trial",
  "trial.stopped": "Stopped the trial",
  "team.password_reset": "Reset a team password",
};
const QUEUES = [
  { id: "review", label: "To review", statuses: "PENDING_REVIEW,MORE_INFO_REQUESTED" },
  { id: "trial", label: "On trial", statuses: "TRIAL_ACTIVE" },
  { id: "ended", label: "Trial ended", statuses: "TRIAL_EXPIRED" },
  { id: "paid", label: "Paid", statuses: "PAID_ACTIVE" },
  { id: "rejected", label: "Rejected", statuses: "REJECTED" },
];
const PKT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const PKT_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });
const when = (iso) => (iso ? `${PKT.format(new Date(iso))} PKT` : "");
const day = (iso) => (iso ? PKT_DAY.format(new Date(iso)) : "");
const pkr = (n) => (n == null ? "" : `PKR ${Number(n).toLocaleString("en-PK")}`);
const daysLeft = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null);

/* ------------------------------------------------------------ shell */

export default function App() {
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(hasSession());
  const [section, setSection] = useState("overview");
  const [notice, setNotice] = useState(null);
  const [joining, setJoining] = useState(window.location.pathname === "/join");

  const ended = useCallback((err) => {
    if (err instanceof SessionEnded) {
      setMe(null);
      setNotice(err.message);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!hasSession()) return;
    api("/api/v1/ops-console/me")
      .then(setMe)
      .catch((e) => { if (!ended(e)) setMe(null); })
      .finally(() => setChecking(false));
  }, [ended]);

  // An invitation link opens the join page, whatever the session state.
  if (joining) return <Join onDone={() => { setJoining(false); window.history.replaceState(null, "", "/"); }} />;
  if (checking) return <div className="boot">Checking your session</div>;
  if (!me) return <SignIn notice={notice} onSignedIn={(m) => { setNotice(null); setMe(m); }} />;

  const nav = [
    ["overview", "Overview"],
    ...(["owner", "reviewer"].includes(me.team_role) ? [["onboarding", "Onboarding"]] : []),
    ...(["owner", "support"].includes(me.team_role) ? [["engine", "Engine"]] : []),
    ...(me.team_role === "owner" ? [["team", "Team"], ["audit", "Audit trail"]] : []),
  ];
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark">KSE Sentinel</span>
          <span className="brand-name">Operations</span>
        </div>
        <nav>
          {nav.map(([id, label]) => (
            <button key={id} className={section === id ? "on" : ""} onClick={() => setSection(id)}>{label}</button>
          ))}
        </nav>
        <div className="who">
          <div>{me.email}</div>
          <div className="role">Team role: {me.team_role}</div>
          <button className="link" onClick={async () => { await signOut(); setMe(null); }}>Sign out</button>
        </div>
      </aside>
      <main className="work">
        {section === "overview" && <Overview onEnded={ended} onOpen={() => setSection("onboarding")} />}
        {section === "onboarding" && <Onboarding onEnded={ended} />}
        {section === "engine" && <Engine onEnded={ended} />}
        {section === "team" && <Team onEnded={ended} />}
        {section === "audit" && <Audit onEnded={ended} />}
      </main>
    </div>
  );
}

function SignIn({ notice, onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mfa, setMfa] = useState(null);          // { token, setup, secret, qr }
  const [code, setCode] = useState("");

  async function submitPassword(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await signIn(email.trim(), password);
      if (r.mfa) {
        let extra = {};
        if (r.mfa.setup) {
          const s = await setupMfa(r.mfa.token);
          extra = { secret: s.secret, qr: await QRCode.toDataURL(s.otpauth_uri, { margin: 1, width: 220, color: { dark: "#1E2761", light: "#FFFFFF" } }) };
        }
        setPassword("");
        setMfa({ ...r.mfa, ...extra });
      } else {
        onSignedIn(r);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await verifyMfa(mfa.token, code.replace(/\D/g, "")));
    } catch (err) {
      if (err.status === 401 && /expired|sign in again/i.test(err.message)) { setMfa(null); setCode(""); }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const brand = (
    <div className="brand dark">
      <span className="brand-mark">KSE Sentinel</span>
      <span className="brand-name">Operations</span>
    </div>
  );

  if (mfa) {
    return (
      <div className="signin">
        <form onSubmit={submitCode} className={mfa.setup ? "wide" : ""}>
          {brand}
          {mfa.setup ? (
            <>
              <p className="lede">Set up your authenticator. This is needed once; afterwards every sign-in asks for a code.</p>
              <ol className="steps">
                <li>Open Google Authenticator or Microsoft Authenticator on your phone and add an account.</li>
                <li>Scan this code:
                  <img className="qr" src={mfa.qr} alt="QR code for your authenticator app" width="220" height="220" />
                  <span className="hint">Cannot scan? Enter this key instead: <code className="key">{mfa.secret.match(/.{1,4}/g).join(" ")}</code></span>
                </li>
                <li>Enter the 6-digit code the app now shows.</li>
              </ol>
            </>
          ) : (
            <p className="lede">Enter the 6-digit code from your authenticator app.</p>
          )}
          <label>Authentication code
            <input className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength="7"
                   value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </label>
          {error && <p className="msg bad" role="alert">{error}</p>}
          <button className="primary" disabled={busy || code.replace(/\D/g, "").length !== 6}>{busy ? "Checking" : mfa.setup ? "Confirm and sign in" : "Sign in"}</button>
          <button type="button" className="link" onClick={() => { setMfa(null); setCode(""); setError(null); }}>Start again</button>
        </form>
      </div>
    );
  }

  return (
    <div className="signin">
      <form onSubmit={submitPassword}>
        {brand}
        <p className="lede">Internal console for the MZE Digital team.</p>
        {notice && <p className="msg">{notice}</p>}
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="msg bad" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Signing in" : "Continue"}</button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ overview */

function Overview({ onEnded, onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api("/api/v1/ops-console/overview").then(setData).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);
  if (error) return <p className="msg bad">{error}</p>;
  if (!data) return <p className="quiet">Loading</p>;
  return (
    <section className="overview">
      <h1>Overview</h1>
      <div className="figures">
        <button className="figure" onClick={onOpen}>
          <span className="n">{data.awaiting_review}</span>
          <span className="l">awaiting review</span>
        </button>
        <button className="figure" onClick={onOpen}>
          <span className="n">{data.awaiting_client_information}</span>
          <span className="l">waiting for client information</span>
        </button>
        <div className="figure">
          <span className="n">{data.counts_by_status.TRIAL_ACTIVE || 0}</span>
          <span className="l">on trial</span>
        </div>
        <div className="figure">
          <span className="n">{data.counts_by_status.PAID_ACTIVE || 0}</span>
          <span className="l">paid clients</span>
        </div>
      </div>

      <h2>Trials ending within 7 days</h2>
      {data.trials_ending_within_7_days.length === 0
        ? <p className="quiet">No trial ends in the next 7 days.</p>
        : (
          <table className="plain">
            <tbody>
              {data.trials_ending_within_7_days.map((t) => (
                <tr key={t.tenant_id}>
                  <td>{t.company_name}</td>
                  <td>{t.pilot_type === "PAID_PILOT" ? "Paid pilot" : "Free trial"}</td>
                  <td className="fig">{day(t.trial_expires_at)}</td>
                  <td className="fig">{daysLeft(t.trial_expires_at)} days left</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h2>Recent actions</h2>
      {data.recent_actions.length === 0
        ? <p className="quiet">No actions recorded yet.</p>
        : <Timeline items={data.recent_actions.map((a) => ({ ...a, label: `${ACTION[a.action] || a.action}, ${a.target}` }))} />}
    </section>
  );
}

/* ------------------------------------------------------------ onboarding */

function Onboarding({ onEnded }) {
  const [queue, setQueue] = useState(QUEUES[0]);
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api(`/api/v1/ops-console/signups?status=${queue.statuses}`)
      .then((d) => setList(d.signups))
      .catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [queue, onEnded]);
  useEffect(() => { setList(null); setSelected(null); load(); }, [load]);

  return (
    <section className="onboarding">
      <div className="queue">
        <h1>Onboarding</h1>
        <div className="tabs" role="tablist">
          {QUEUES.map((q) => (
            <button key={q.id} role="tab" aria-selected={q.id === queue.id} className={q.id === queue.id ? "on" : ""} onClick={() => setQueue(q)}>{q.label}</button>
          ))}
        </div>
        {error && <p className="msg bad">{error}</p>}
        {list === null && !error && <p className="quiet">Loading</p>}
        {list && list.length === 0 && <p className="quiet">Nothing here.</p>}
        <ul className="rows">
          {(list || []).map((s) => (
            <li key={s.tenant_id}>
              <button className={selected === s.tenant_id ? "on" : ""} onClick={() => setSelected(s.tenant_id)}>
                <span className="co">{s.company_name}</span>
                <span className="sub">{[s.city, s.sector].filter(Boolean).join(", ") || s.admin_email}</span>
                <span className="sub">
                  {STATUS[s.status] || s.status}
                  {s.status === "TRIAL_ACTIVE" && s.trial_expires_at ? `, ends ${day(s.trial_expires_at)}` : ""}
                  {["PENDING_REVIEW", "MORE_INFO_REQUESTED"].includes(s.status) ? `, checklist ${s.checklist_answered} of ${s.checklist_total}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="record">
        {selected
          ? <Record key={selected} tenantId={selected} onEnded={onEnded} onChanged={load} />
          : <p className="quiet empty">Select a record from the list.</p>}
      </div>
    </section>
  );
}

function Record({ tenantId, onEnded, onChanged }) {
  const [rec, setRec] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api(`/api/v1/ops-console/signups/${tenantId}`).then(setRec).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [tenantId, onEnded]);
  useEffect(load, [load]);
  const changed = () => { load(); onChanged(); };

  if (error) return <p className="msg bad">{error}</p>;
  if (!rec) return <p className="quiet">Loading</p>;
  const reviewable = ["PENDING_REVIEW", "MORE_INFO_REQUESTED"].includes(rec.status);
  const d = rec.details;
  return (
    <article>
      <header className="rec-head">
        <h2>{rec.company_name}</h2>
        <span className={`status s-${rec.status}`}>{STATUS[rec.status] || rec.status}</span>
      </header>
      {rec.status_note && ["MORE_INFO_REQUESTED", "REJECTED", "TRIAL_EXPIRED", "SUSPENDED"].includes(rec.status) && (
        <p className="note">{rec.status === "MORE_INFO_REQUESTED" ? "Asked the client: " : "Reason: "}{rec.status_note}</p>
      )}

      <dl className="facts">
        <Fact k="Registration number" v={d.registration_number} />
        <Fact k="Sector" v={d.sector} />
        <Fact k="City" v={d.city} />
        <Fact k="Address" v={d.address} />
        <Fact k="Contact" v={[d.contact_name, d.contact_phone].filter(Boolean).join(", ")} />
        <Fact k="Website" v={d.website} />
        <Fact k="Sign-in email" v={rec.admin_email} />
        <Fact k="Email domain" v={rec.email_domain} />
        <Fact k="Plan requested" v={[rec.tier, d.seats_requested ? `${d.seats_requested} seats` : null].filter(Boolean).join(", ")} />
        <Fact k="Signed up" v={when(rec.created_at)} fig />
        <Fact k="Signup network address" v={rec.signup_ip} fig />
        {rec.trial_expires_at && (
          <Fact k={rec.pilot_type === "PAID_PILOT" ? "Paid pilot" : "Free trial"}
                v={`${day(rec.trial_started_at)} to ${day(rec.trial_expires_at)}${rec.pilot_fee_pkr ? `, ${pkr(rec.pilot_fee_pkr)}` : ""}`} fig />
        )}
        {rec.seat_count ? <Fact k="Seats allowed" v={rec.seat_count} fig /> : null}
      </dl>

      <Checklist rec={rec} onEnded={onEnded} onSaved={changed} />
      {reviewable && <DetailsEditor rec={rec} onEnded={onEnded} onSaved={changed} />}
      <Decisions rec={rec} onEnded={onEnded} onDone={changed} />

      <h3>History</h3>
      {rec.history.length === 0
        ? <p className="quiet">No actions yet.</p>
        : <Timeline items={rec.history.map((h) => ({
            ...h,
            label: ACTION[h.action] || h.action,
            change: h.before?.status !== h.after?.status && h.after?.status
              ? `${STATUS[h.before?.status] || h.before?.status} to ${STATUS[h.after.status] || h.after.status}` : null,
          }))} />}

      {rec.users.length > 0 && (
        <>
          <h3>Users</h3>
          <table className="plain">
            <tbody>
              {rec.users.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.email_verified ? "Email verified" : "Email not verified"}</td>
                  <td className="fig">{u.last_login_at ? `Last sign-in ${when(u.last_login_at)}` : "Never signed in"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </article>
  );
}

const Fact = ({ k, v, fig }) => (
  <div className="fact">
    <dt>{k}</dt>
    <dd className={fig ? "fig" : ""}>{v || <span className="quiet">Not provided</span>}</dd>
  </div>
);

/* ------------------------------------------------------------ checklist and details */

function Checklist({ rec, onEnded, onSaved }) {
  const initial = Object.fromEntries(rec.checklist.map((c) => [c.key, { answer: c.answer || "", note: c.note || "" }]));
  const [items, setItems] = useState(initial);
  const [reason, setReason] = useState("");
  const [state, setState] = useState(null);
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);
  async function save() {
    setState({ busy: true });
    try {
      await api(`/api/v1/ops-console/signups/${rec.tenant_id}/checklist`, {
        method: "PUT",
        body: { reason, items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { answer: v.answer || null, note: v.note || null }])) },
      });
      setReason("");
      setState({ ok: "Checklist saved." });
      onSaved();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <section className="block">
      <h3>Reviewer checklist</h3>
      <div className="checks">
        {rec.checklist.map((c) => (
          <div className="check" key={c.key}>
            <span className="q">{c.label}</span>
            <div className="answers" role="radiogroup" aria-label={c.label}>
              {[["yes", "Yes"], ["no", "No"], ["n/a", "Not applicable"]].map(([v, l]) => (
                <button key={v} role="radio" aria-checked={items[c.key].answer === v}
                        className={`${items[c.key].answer === v ? "on" : ""} a-${v.replace("/", "")}`}
                        onClick={() => setItems({ ...items, [c.key]: { ...items[c.key], answer: items[c.key].answer === v ? "" : v } })}>{l}</button>
              ))}
            </div>
            <input className="note-in" placeholder="Note (optional)" aria-label={`Note: ${c.label}`} value={items[c.key].note}
                   onChange={(e) => setItems({ ...items, [c.key]: { ...items[c.key], note: e.target.value } })} />
            {c.by && <span className="by">Last set by {c.by}, {when(c.at)}</span>}
          </div>
        ))}
      </div>
      {dirty && (
        <Reasoned reason={reason} setReason={setReason} label="Save checklist" busy={state?.busy}
                  placeholder="What did you check, and where?" onSubmit={save} />
      )}
      {state?.ok && <p className="msg good">{state.ok}</p>}
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </section>
  );
}

const DETAIL_FIELDS = [
  ["registration_number", "Registration number"], ["sector", "Sector"], ["city", "City"], ["address", "Address"],
  ["contact_name", "Contact name"], ["contact_phone", "Contact phone"], ["website", "Website"],
];

function DetailsEditor({ rec, onEnded, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => Object.fromEntries(DETAIL_FIELDS.map(([k]) => [k, rec.details[k] || ""])));
  const [reason, setReason] = useState("");
  const [state, setState] = useState(null);
  if (!open) return <button className="quietbtn" onClick={() => setOpen(true)}>Edit details</button>;
  async function save() {
    setState({ busy: true });
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== (rec.details[k] || "")));
    try {
      await api(`/api/v1/ops-console/signups/${rec.tenant_id}/details`, { method: "PUT", body: { reason, ...changed } });
      setOpen(false);
      onSaved();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <section className="block">
      <h3>Edit details</h3>
      <div className="form-grid">
        {DETAIL_FIELDS.map(([k, l]) => (
          <label key={k}>{l}<input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
        ))}
      </div>
      <Reasoned reason={reason} setReason={setReason} label="Save details" busy={state?.busy}
                placeholder="Where did the new details come from?" onSubmit={save} onCancel={() => setOpen(false)} />
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </section>
  );
}

/* ------------------------------------------------------------ decisions and trial controls */

function Decisions({ rec, onEnded, onDone }) {
  const [mode, setMode] = useState(null);
  const reviewable = ["PENDING_REVIEW", "MORE_INFO_REQUESTED"].includes(rec.status);
  const options = reviewable
    ? [["approve", "Approve"], ["info", "Ask for more information"], ["reject", "Reject"]]
    : rec.status === "TRIAL_ACTIVE" ? [["extend", "Extend the trial"], ["stop", "Stop the trial"]]
      : rec.status === "TRIAL_EXPIRED" ? [["restart", "Restart the trial"]] : [];
  if (options.length === 0) return null;
  const close = () => setMode(null);
  const done = () => { setMode(null); onDone(); };
  return (
    <section className="block decide">
      <h3>{reviewable ? "Decision" : "Trial"}</h3>
      {!mode && (
        <div className="choices">
          {options.map(([id, label]) => (
            <button key={id} className={id === "reject" || id === "stop" ? "danger-outline" : "outline"} onClick={() => setMode(id)}>{label}</button>
          ))}
        </div>
      )}
      {mode === "approve" && <Approve rec={rec} onEnded={onEnded} onDone={done} onCancel={close} />}
      {mode === "info" && (
        <Simple rec={rec} path="request-info" label="Send request" onEnded={onEnded} onDone={done} onCancel={close}
                placeholder="What do you need from the client? They will receive this message." />
      )}
      {mode === "reject" && (
        <Simple rec={rec} path="reject" label="Reject" confirmText="Reject this signup? This cannot be undone." danger
                onEnded={onEnded} onDone={done} onCancel={close} placeholder="Why is this signup rejected?" />
      )}
      {(mode === "extend" || mode === "restart") && (
        <Extend rec={rec} restart={mode === "restart"} onEnded={onEnded} onDone={done} onCancel={close} />
      )}
      {mode === "stop" && (
        <Simple rec={rec} path="trial/stop" base="clients" label="Stop the trial" danger
                confirmText="Stop this trial now? The client is signed out and cannot sign in again until the trial is restarted."
                onEnded={onEnded} onDone={done} onCancel={close} placeholder="Why is the trial being stopped?" />
      )}
    </section>
  );
}

function useSubmit(onEnded, onDone) {
  const [state, setState] = useState(null);
  const run = async (path, body) => {
    setState({ busy: true });
    try {
      await api(path, { method: "POST", body });
      onDone();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  };
  return [state, run];
}

function Simple({ rec, path, base = "signups", label, placeholder, confirmText, danger, onEnded, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [state, run] = useSubmit(onEnded, onDone);
  return (
    <>
      <Reasoned reason={reason} setReason={setReason} label={label} placeholder={placeholder} danger={danger}
                confirmText={confirmText} busy={state?.busy} onCancel={onCancel}
                onSubmit={() => run(`/api/v1/ops-console/${base}/${rec.tenant_id}/${path}`, { reason })} />
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </>
  );
}

function Approve({ rec, onEnded, onDone, onCancel }) {
  const [pilot, setPilot] = useState("FREE_TRIAL");
  const [days, setDays] = useState(30);
  const [fee, setFee] = useState("");
  const [seats, setSeats] = useState(rec.details.seats_requested || 1);
  const [tier, setTier] = useState(rec.tier || "Tier-2");
  const [reason, setReason] = useState("");
  const [state, run] = useSubmit(onEnded, onDone);
  const ends = new Date(Date.now() + Number(days || 0) * 86400000).toISOString();
  const valid = days >= 1 && days <= 180 && seats >= 1 && seats <= 500 && (pilot === "FREE_TRIAL" || Number(fee) > 0);
  return (
    <>
      <div className="form-grid">
        <fieldset className="pilot">
          <legend>Type</legend>
          <label><input type="radio" name="pilot" checked={pilot === "FREE_TRIAL"} onChange={() => setPilot("FREE_TRIAL")} /> Free trial</label>
          <label><input type="radio" name="pilot" checked={pilot === "PAID_PILOT"} onChange={() => setPilot("PAID_PILOT")} /> Paid pilot</label>
        </fieldset>
        <label>Length in days (1 to 180)
          <input type="number" min="1" max="180" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          <span className="hint">Ends {day(ends)}</span>
        </label>
        {pilot === "PAID_PILOT" && (
          <label>Pilot fee in PKR<input type="number" min="1" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
        )}
        <label>Seats (1 to 500)<input type="number" min="1" max="500" value={seats} onChange={(e) => setSeats(Number(e.target.value))} /></label>
        <label>Tier
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option>Tier-1</option><option>Tier-2</option>
          </select>
        </label>
      </div>
      <Reasoned reason={reason} setReason={setReason} label={pilot === "PAID_PILOT" ? "Approve as paid pilot" : "Approve as free trial"}
                disabled={!valid} busy={state?.busy} onCancel={onCancel} placeholder="Why is this signup approved?"
                onSubmit={() => run(`/api/v1/ops-console/signups/${rec.tenant_id}/approve`, {
                  reason, seat_count: seats, trial_days: days, pilot_type: pilot, tier,
                  pilot_fee_pkr: pilot === "PAID_PILOT" ? Number(fee) : null,
                })} />
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </>
  );
}

function Extend({ rec, restart, onEnded, onDone, onCancel }) {
  const [days, setDays] = useState(14);
  const [reason, setReason] = useState("");
  const [state, run] = useSubmit(onEnded, onDone);
  const from = restart || !rec.trial_expires_at ? Date.now() : new Date(rec.trial_expires_at).getTime();
  return (
    <>
      <label className="inline">{restart ? "Restart for" : "Add"}
        <input type="number" min="1" max="180" value={days} onChange={(e) => setDays(Number(e.target.value))} /> days
        <span className="hint">New end date {day(new Date(from + days * 86400000).toISOString())}</span>
      </label>
      <Reasoned reason={reason} setReason={setReason} label={restart ? "Restart the trial" : "Extend the trial"}
                disabled={!(days >= 1 && days <= 180)} busy={state?.busy} onCancel={onCancel}
                placeholder="Why is the trial being extended?"
                onSubmit={() => run(`/api/v1/ops-console/clients/${rec.tenant_id}/trial/extend`, { reason, days })} />
      {state?.bad && <p className="msg bad">{state.bad}</p>}
    </>
  );
}

/* The console's rule made visible: no action without a written reason,
   and a second, explicit confirmation for anything irreversible. */
function Reasoned({ reason, setReason, label, placeholder, onSubmit, onCancel, busy, disabled, danger, confirmText }) {
  const [confirming, setConfirming] = useState(false);
  const ok = reason.trim().length >= 5;
  return (
    <div className={`reasoned ${danger ? "danger" : ""}`}>
      <label>Reason, recorded in the audit trail
        <textarea rows="2" value={reason} placeholder={placeholder} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} />
      </label>
      {!ok && reason.length > 0 && <span className="hint">At least 5 characters.</span>}
      {confirming && <p className="confirm">{confirmText}</p>}
      <div className="row">
        <button className={danger ? "danger" : "primary"} disabled={!ok || busy || disabled}
                onClick={() => (confirmText && !confirming ? setConfirming(true) : onSubmit())}>
          {busy ? "Saving" : confirming ? `Yes, ${label.toLowerCase()}` : label}
        </button>
        {onCancel && <button className="link" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ history and audit */

function Timeline({ items }) {
  return (
    <ol className="timeline">
      {items.map((it, i) => (
        <li key={i}>
          <span className="t fig">{when(it.time)}</span>
          <span className="what"><b>{it.label}</b>{it.change ? `: ${it.change}` : ""}</span>
          <span className="why">{it.reason}</span>
          <span className="by-line">{it.by}{it.role ? `, ${it.role}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

function Audit({ onEnded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState("");
  const load = useCallback((t) => {
    setError(null);
    api(`/api/v1/ops-console/audit?limit=200${t ? `&target_id=${encodeURIComponent(t)}` : ""}`)
      .then(setData).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);
  useEffect(() => { load(""); }, [load]);
  return (
    <section className="audit">
      <h1>Audit trail</h1>
      <p className="quiet">Every action taken in this console, with who, when and why. Entries cannot be edited or removed.</p>
      <form className="filter" onSubmit={(e) => { e.preventDefault(); load(target.trim()); }}>
        <label>Client or user ID<input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="All" /></label>
        <button className="outline">Filter</button>
      </form>
      {error && <p className="msg bad">{error}</p>}
      {data && (data.entries.length === 0
        ? <p className="quiet">No entries.</p>
        : (
          <div className="scroll">
            <table className="plain audit-table">
              <thead><tr><th>Time (PKT)</th><th>Who</th><th>Action</th><th>Record</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>
                {data.entries.map((a, i) => (
                  <tr key={i}>
                    <td className="fig">{when(a.time).replace(" PKT", "")}</td>
                    <td>{a.by}<span className="sub">{a.role}</span></td>
                    <td>{ACTION[a.action] || a.action}</td>
                    <td className="fig">{a.target_type} {a.target_id}</td>
                    <td className="why">{a.reason}</td>
                    <td>{a.before?.status && a.after?.status && a.before.status !== a.after.status
                      ? `${STATUS[a.before.status] || a.before.status} to ${STATUS[a.after.status] || a.after.status}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
