/*
 * src/Engine.jsx  (kse-sentinel-ops, Sep 30 2026)
 *
 * ENGINE: the forward-test and trading-engine monitor, moved into the console
 * from the old standalone ops_dashboard.html (which stopped working once
 * sign-in enforcement went live). Read-only, per client tenant:
 *   run status, 60-day forward-paper progress, portfolio snapshot, strategies,
 *   live signals, sizing, kill switch, scan health, lot sizes, incident notes.
 * Backend: app/routers/ops_engine.py (team roles support and owner).
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const RUN_STATUS = {
  OK: ["Today's run completed", "good", "The daily scan ran and wrote today's snapshot."],
  PENDING_TODAY: ["Waiting for today's run", "quiet", "Normal: today's 20:00 to 20:30 SGT run window has not closed yet."],
  STALE_1_DAY: ["Today's run is missing", "warn", "The run window has closed and no snapshot was written. Check the runner."],
  STALE_MULTI_DAY: ["Runs missed on several days", "bad", "More than one day without a snapshot. Investigate now."],
  NO_DATA: ["No runs recorded", "bad", "No snapshots exist yet for this client and timeframe."],
};
const STRATEGY_NAMES = {
  TREND9EMA_ATR_2X: "Horizon Edge (ATR stop)",
  TREND9EMA_SMA50_7PCT: "Horizon Edge (7% SMA50 stop)",
  HORIZONDIP: "HorizonDip",
};
const SIGNAL_FILTERS = [
  [null, "All"], ["ENTRY_EXECUTED", "Entries executed"], ["ENTRY_BLOCKED", "Entries blocked"],
  ["SIGNAL_IGNORED_TREND_DISAGREE", "Ignored, trend disagrees"], ["POSITION_HELD", "Positions held"],
  ["POSITION_CLOSED", "Positions closed"], ["NO_SIGNAL", "No signal"],
];
const ACTION_LABEL = Object.fromEntries(SIGNAL_FILTERS.filter(([v]) => v));
const pkr = (n) => (n == null ? "" : `PKR ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const signed = (n) => (n == null ? "" : `${n > 0 ? "+" : ""}${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const day = (iso) => (iso ? DAY.format(new Date(`${String(iso).slice(0, 10)}T12:00:00`)) : "");
const todayPkt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

export default function Engine({ onEnded }) {
  const [tenants, setTenants] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [timeframe, setTimeframe] = useState("1D");
  const [sum, setSum] = useState(null);
  const [error, setError] = useState(null);
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    api("/api/v1/ops-console/engine/tenants")
      .then((d) => { setTenants(d.tenants); if (d.tenants.length) setTenantId(d.tenants[0].tenant_id); })
      .catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);

  useEffect(() => {
    if (tenantId == null) return;
    let live = true;
    api(`/api/v1/ops-console/engine/summary?tenant_id=${tenantId}&timeframe=${timeframe}`)
      .then((d) => { if (live) { setSum(d); setError(null); } })
      .catch((e) => { if (live && !onEnded(e)) setError(e.message); });
    return () => { live = false; };
  }, [tenantId, timeframe, stamp, onEnded]);

  return (
    <section className="engine">
      <div className="engine-head">
        <h1>Engine</h1>
        <div className="controls">
          <label>Client
            <select value={tenantId ?? ""} onChange={(e) => { setSum(null); setTenantId(Number(e.target.value)); }}>
              {(tenants || []).map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.company_name}{t.snapshot_days ? `, ${t.snapshot_days} days recorded` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>Timeframe
            <select value={timeframe} onChange={(e) => { setSum(null); setTimeframe(e.target.value); }}>
              <option value="1D">Daily (investment)</option>
              <option value="1H">Hourly (intraday)</option>
            </select>
          </label>
          <button className="outline" onClick={() => setStamp((s) => s + 1)}>Refresh</button>
        </div>
      </div>
      <p className="quiet">Live figures from the tables the trading engine reads and writes. Read-only.</p>
      {error && <p className="msg bad">{error}</p>}
      {tenants && tenants.length === 0 && <p className="quiet">No client tenants yet.</p>}
      {!sum && !error && tenantId != null && <p className="quiet">Loading</p>}
      {sum && <Panels sum={sum} tenantId={tenantId} timeframe={timeframe} onEnded={onEnded} onChanged={() => setStamp((s) => s + 1)} />}
    </section>
  );
}

function Failed({ panel }) {
  return <p className="msg bad">Not available: {panel.error}</p>;
}

function Panels({ sum, tenantId, timeframe, onEnded, onChanged }) {
  const hb = sum.heartbeat, pr = sum.progress, ks = sum.kill_switch;
  const run = hb.ok ? (RUN_STATUS[hb.data.status] || [hb.data.status, "quiet", ""]) : null;
  return (
    <>
      {ks.ok && ks.data.is_active && (
        <div className="kill-banner" role="alert">
          <b>Trading halted for this client.</b> Kill switch engaged {ks.data.activated_at ? `on ${day(ks.data.activated_at)}` : ""}
          {ks.data.activation_reason ? `: ${ks.data.activation_reason}` : "."} Only the client's own admin can release it.
        </div>
      )}

      <div className="figures engine-figs">
        <div className="figure">
          <span className={`run run-${run ? run[1] : "bad"}`}>{run ? run[0] : "Run status unavailable"}</span>
          <span className="l">{run ? run[2] : hb.error}</span>
        </div>
        <div className="figure">
          <span className="n">{pr.ok ? `${pr.data.days_completed} / ${pr.data.target_days}` : "?"}</span>
          <span className="l">{pr.ok ? `forward-paper days, ${pr.data.pct_complete}% complete` : pr.error}</span>
        </div>
        <div className="figure">
          <span className="n fig-date">{pr.ok && pr.data.last_snapshot_date ? day(pr.data.last_snapshot_date) : "None"}</span>
          <span className="l">last recorded run{hb.ok && hb.data.days_since_last_run != null ? `, ${hb.data.days_since_last_run} day(s) ago` : ""}</span>
        </div>
        <div className="figure">
          <span className="n">{hb.ok && hb.data.last_snapshot_equity != null ? Number(hb.data.last_snapshot_equity).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "?"}</span>
          <span className="l">equity in PKR at last snapshot</span>
        </div>
      </div>
      {pr.ok && (
        <p className="quiet small">
          Window started {day(pr.data.window_start_date)}; {pr.data.days_remaining} trading day(s) to go.
          {" "}{pr.data.calendar_days_elapsed_since_start} calendar days have passed, which differs from days completed because of weekends and holidays.
        </p>
      )}

      <Portfolio sum={sum} />
      <Signals tenantId={tenantId} timeframe={timeframe} onEnded={onEnded} />
      <Health sum={sum} />
      <Incidents sum={sum} tenantId={tenantId} onEnded={onEnded} onChanged={onChanged} />
      <LotSizes onEnded={onEnded} />
    </>
  );
}

function Portfolio({ sum }) {
  const st = sum.strategies, po = sum.portfolio;
  if (!st.ok) return <><h2>Portfolio</h2><Failed panel={st} /></>;
  const names = Object.keys(st.data.strategies || {});
  const totals = names.reduce((a, n) => ({
    pnl: a.pnl + (st.data.strategies[n].total_realized_pnl_pkr || 0),
    closed: a.closed + (st.data.strategies[n].closed_trades || 0),
    open: a.open + (st.data.strategies[n].open_positions || 0),
  }), { pnl: 0, closed: 0, open: 0 });
  const overlap = po.ok && po.data.exposure_by_ticker
    ? Object.entries(po.data.exposure_by_ticker).filter(([, v]) => v.held_by_multiple_strategies) : [];
  const open = po.ok && po.data.summary ? po.data.summary.total_open_positions : totals.open;
  return (
    <>
      <h2>Portfolio</h2>
      <div className="figures">
        <div className="figure">
          <span className={`n ${totals.pnl > 0 ? "up" : totals.pnl < 0 ? "down" : ""}`}>{signed(totals.pnl)}</span>
          <span className="l">realized PnL in PKR, all time, {totals.closed} closed trade(s)</span>
        </div>
        <div className="figure">
          <span className="n">{open}</span>
          <span className="l">open positions{po.ok && po.data.summary ? `, ${po.data.summary.distinct_tickers_held} ticker(s)` : ""}</span>
        </div>
        <div className="figure">
          <span className="n">{overlap.length}</span>
          <span className="l">ticker(s) held by more than one strategy</span>
        </div>
      </div>
      {overlap.length > 0 && (
        <p className="note">
          Overlapping exposure: {overlap.map(([t, v]) => `${t} (${v.strategies.map((s) => STRATEGY_NAMES[s] || s).join(" and ")}, ${pkr(v.total_notional_pkr)} combined)`).join("; ")}.
        </p>
      )}
      {names.length === 0
        ? <p className="quiet">No positions or trades recorded yet for any strategy.</p>
        : (
          <table className="plain">
            <thead><tr><th>Strategy</th><th className="r">Open</th><th className="r">Closed</th><th className="r">Realized PnL (PKR)</th><th className="r">Average per trade</th></tr></thead>
            <tbody>
              {names.map((n) => {
                const s = st.data.strategies[n];
                return (
                  <tr key={n}>
                    <td>{STRATEGY_NAMES[n] || n}</td>
                    <td className="r fig">{s.open_positions}</td>
                    <td className="r fig">{s.closed_trades}</td>
                    <td className={`r fig ${s.total_realized_pnl_pkr > 0 ? "up" : s.total_realized_pnl_pkr < 0 ? "down" : ""}`}>{signed(s.total_realized_pnl_pkr)}</td>
                    <td className="r fig">{s.closed_trades > 0 ? signed(s.avg_pnl_per_trade_pkr) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </>
  );
}

function Signals({ tenantId, timeframe, onEnded }) {
  const [filter, setFilter] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setData(null);
    api(`/api/v1/ops-console/engine/signals?tenant_id=${tenantId}&timeframe=${timeframe}&limit=50${filter ? `&action=${filter}` : ""}`)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live && !onEnded(e)) setError(e.message); });
    return () => { live = false; };
  }, [tenantId, timeframe, filter, onEnded]);
  const recs = data?.records || [];
  const executed = recs.filter((r) => r.action_taken === "ENTRY_EXECUTED").length;
  const blocked = recs.filter((r) => r.action_taken === "ENTRY_BLOCKED").length;
  const blockRate = executed + blocked ? Math.round((blocked / (executed + blocked)) * 100) : 0;
  return (
    <>
      <h2>Signals</h2>
      <div className="tabs">
        {SIGNAL_FILTERS.map(([v, l]) => (
          <button key={l} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      {error && <p className="msg bad">{error}</p>}
      {data === null && !error && <p className="quiet">Loading</p>}
      {data && (
        <>
          {!filter && executed + blocked > 0 && (
            <p className={blockRate >= 50 ? "note" : "quiet small"}>
              {executed} entr{executed === 1 ? "y" : "ies"} executed and {blocked} blocked in the latest {recs.length} records
              {blockRate >= 50 ? `: a ${blockRate}% block rate is high, worth checking what is being blocked and why.` : "."}
              {recs.length >= 45 ? " The list is near its 50-record limit, so real volume may be higher." : ""}
            </p>
          )}
          {recs.length === 0 ? <p className="quiet">No records for this filter.</p> : (
            <div className="scroll">
              <table className="plain">
                <thead><tr><th>Date</th><th>Symbol</th><th>Action</th><th>Detail</th><th>Outcome</th><th className="r">PnL (PKR)</th></tr></thead>
                <tbody>
                  {recs.map((r, i) => (
                    <tr key={i}>
                      <td className="fig">{day(r.bar_timestamp)}</td>
                      <td>{r.symbol}</td>
                      <td>{ACTION_LABEL[r.action_taken] || r.action_taken}</td>
                      <td className="why">{r.action_detail || ""}</td>
                      <td>{r.outcome_status === "PENDING" ? <span className="quiet">Pending</span> : (r.outcome_status || "")}</td>
                      <td className={`r fig ${r.outcome_pnl_pkr > 0 ? "up" : r.outcome_pnl_pkr < 0 ? "down" : ""}`}>{r.outcome_pnl_pkr != null ? signed(r.outcome_pnl_pkr) : ""}</td>
                    </tr>
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

function Health({ sum }) {
  const sz = sum.sizing, sh = sum.scan_health, ks = sum.kill_switch;
  return (
    <>
      <h2>Health and settings</h2>
      <dl className="facts">
        <div className="fact">
          <dt>Daily scan</dt>
          <dd>
            {!sh.ok ? `Not available: ${sh.error}`
              : sh.data.status === "success"
                ? `Last run ${day(sh.data.last_run_date)}, ${sh.data.ran_without_error ? "completed without errors" : "reported an error"}${sh.data.horizonedge_scan_confirmed ? "; Horizon Edge scanned" : ""}.`
                : sh.data.status === "no_log_found"
                  ? "The scan log is kept on the machine that runs the daily scan, so it cannot be read from here. The run status above comes from the database and is authoritative."
                  : sh.data.detail}
          </dd>
        </div>
        <div className="fact">
          <dt>Position sizing</dt>
          <dd>
            {!sz.ok ? `Not available: ${sz.error}`
              : sz.data.config_exists
                ? `${sz.data.effective_tier} tier, ${(sz.data.effective_max_exposure_pct * 100).toFixed(1)}% maximum exposure per position.`
                : "No sizing configuration for this client: trades size from the built-in fallback, not a chosen tier."}
          </dd>
        </div>
        <div className="fact">
          <dt>Kill switch</dt>
          <dd>{!ks.ok ? `Not available: ${ks.error}` : ks.data.is_active ? "Engaged: trading halted." : "Not engaged: trading active."}</dd>
        </div>
      </dl>
    </>
  );
}

function Incidents({ sum, tenantId, onEnded, onChanged }) {
  const inc = sum.incidents;
  const [date, setDate] = useState(todayPkt());
  const [text, setText] = useState("");
  const [state, setState] = useState(null);
  async function add() {
    setState({ busy: true });
    try {
      await api(`/api/v1/ops-console/engine/incidents?tenant_id=${tenantId}`, { method: "POST", body: { note_date: date, note_text: text } });
      setText("");
      setState({ ok: "Note added." });
      onChanged();
    } catch (e) {
      if (!onEnded(e)) setState({ bad: e.message });
    }
  }
  return (
    <>
      <h2>Incident notes</h2>
      {!inc.ok ? <Failed panel={inc} /> : inc.data.notes.length === 0 ? <p className="quiet">No notes yet.</p> : (
        <ol className="timeline">
          {inc.data.notes.map((n) => (
            <li key={n.note_id}>
              <span className="t fig">{day(n.note_date)}</span>
              <span className="what">{n.note_text}</span>
              <span className="by-line">{n.author || ""}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="reasoned incident-form">
        <label className="inline">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Note, also recorded in the audit trail
          <textarea rows="2" value={text} placeholder="For example: PSX feed delayed 20 minutes at open" onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row">
          <button className="primary" disabled={text.trim().length < 5 || !date || state?.busy} onClick={add}>{state?.busy ? "Saving" : "Add note"}</button>
        </div>
        {state?.ok && <p className="msg good">{state.ok}</p>}
        {state?.bad && <p className="msg bad">{state.bad}</p>}
      </div>
    </>
  );
}

function LotSizes({ onEnded }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api("/api/v1/ops-console/engine/lot-sizes").then(setData).catch((e) => { if (!onEnded(e)) setError(e.message); });
  }, [onEnded]);
  return (
    <>
      <h2>Lot sizes</h2>
      {!open ? (
        <button className="quietbtn" onClick={() => { setOpen(true); load(); }}>Show lot-size verification for the trading universe</button>
      ) : (
        <>
          {error && <p className="msg bad">{error}</p>}
          {!data && !error && <p className="quiet">Loading</p>}
          {data && (
            <>
              <p className="quiet small">
                {data.confirmed_count} confirmed, {data.fallback_count} on the fallback lot size, {data.total_symbols} in total
                {data.unverified_symbol_count ? `; ${data.unverified_symbol_count} symbol(s) unverified` : ""}
                {data.stale_symbol_count ? `; ${data.stale_symbol_count} no longer in the index` : ""}.
              </p>
              <div className="scroll">
                <table className="plain">
                  <thead><tr><th>Symbol</th><th>Status</th><th className="r">Lot size</th><th>Source</th><th>Verified</th><th>Symbol check</th></tr></thead>
                  <tbody>
                    {(data.symbols || []).map((s) => (
                      <tr key={s.symbol}>
                        <td>{s.symbol}</td>
                        <td>{s.status}</td>
                        <td className="r fig">{s.lot_size ?? ""}</td>
                        <td>{s.lot_size_source || ""}</td>
                        <td className="fig">{s.lot_size_verified_at ? day(s.lot_size_verified_at) : ""}</td>
                        <td>{s.symbol_confidence === "unverified_symbol" ? "Unverified" : s.symbol_confidence === "stale_index_membership" ? "No longer in the index" : "Verified"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
