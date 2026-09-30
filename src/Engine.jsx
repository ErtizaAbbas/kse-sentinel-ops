/*
 * src/Engine.jsx  (kse-sentinel-ops, Sep 30 2026)
 *
 * ENGINE: the forward-test and trading-engine monitor, moved into the console
 * from the old standalone ops_dashboard.html (which stopped working once
 * sign-in enforcement went live). Read-only, per client tenant:
 *   run status, 60-day forward-paper progress, portfolio snapshot, strategies,
 *   live signals, sizing, kill switch, scan health, lot sizes, incident notes.
 * Backend: app/routers/ops_engine.py and ops_engine_perf.py (team roles support and owner).
 *
 * v2 (Sep 30 2026): performance in PKR and %: equity curve with daily and
 * cumulative returns and drawdown, exposure, open positions marked to market,
 * closed trades, per-strategy win rate and profit factor. Every number column
 * is right-aligned in fixed-width digits, with its unit in the header.
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
const num = (n, dp = 0) => (n == null ? "" : Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const signed = (n, dp = 0) => (n == null ? "" : `${n > 0 ? "+" : ""}${num(n, dp)}`);
const pct = (n) => (n == null ? "" : `${n > 0 ? "+" : ""}${num(n, 2)}%`);
const plainPct = (n) => (n == null ? "" : `${num(n, 2)}%`);
const tone = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const day = (iso) => (iso ? DAY.format(new Date(`${String(iso).slice(0, 10)}T12:00:00`)) : "");
const todayPkt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

export default function Engine({ onEnded }) {
  const [tenants, setTenants] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [timeframe, setTimeframe] = useState("1D");
  const [sum, setSum] = useState(null);
  const [perf, setPerf] = useState(null);
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
    api(`/api/v1/ops-console/engine/performance?tenant_id=${tenantId}&timeframe=${timeframe}`)
      .then((d) => { if (live) setPerf({ ok: true, data: d }); })
      .catch((e) => { if (live && !onEnded(e)) setPerf({ ok: false, error: e.message }); });
    return () => { live = false; };
  }, [tenantId, timeframe, stamp, onEnded]);

  return (
    <section className="engine">
      <div className="engine-head">
        <h1>Engine</h1>
        <div className="controls">
          <label>Client
            <select value={tenantId ?? ""} onChange={(e) => { setSum(null); setPerf(null); setTenantId(Number(e.target.value)); }}>
              {(tenants || []).map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.company_name}{t.snapshot_days ? `, ${t.snapshot_days} days recorded` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>Timeframe
            <select value={timeframe} onChange={(e) => { setSum(null); setPerf(null); setTimeframe(e.target.value); }}>
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
      {sum && <Panels sum={sum} perf={perf} tenantId={tenantId} timeframe={timeframe} onEnded={onEnded} onChanged={() => setStamp((s) => s + 1)} />}
    </section>
  );
}

function Failed({ panel }) {
  return <p className="msg bad">Not available: {panel.error}</p>;
}

function Panels({ sum, perf, tenantId, timeframe, onEnded, onChanged }) {
  const eq = perf?.ok ? perf.data.equity : null;
  const lastDay = eq && eq.series.length ? eq.series[eq.series.length - 1] : null;
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
          <span className="n">{hb.ok && hb.data.last_snapshot_equity != null ? num(hb.data.last_snapshot_equity) : "?"}</span>
          <span className="l">
            equity in PKR at last snapshot
            {lastDay && lastDay.daily_change_pkr != null && (
              <span className={`delta ${tone(lastDay.daily_change_pkr)}`}> {signed(lastDay.daily_change_pkr)} ({pct(lastDay.daily_change_pct)}) on the day</span>
            )}
          </span>
        </div>
      </div>
      {pr.ok && (
        <p className="quiet small">
          Window started {day(pr.data.window_start_date)}; {pr.data.days_remaining} trading day(s) to go.
          {" "}{pr.data.calendar_days_elapsed_since_start} calendar days have passed, which differs from days completed because of weekends and holidays.
        </p>
      )}

      {!perf ? <p className="quiet">Loading performance</p>
        : !perf.ok ? <><h2>Performance</h2><p className="msg bad">Not available: {perf.error}</p></>
          : (
            <>
              <Performance eq={perf.data.equity} />
              <Exposure ex={perf.data.exposure} sum={sum} />
              <Positions rows={perf.data.positions} />
              <Strategies stats={perf.data.strategies} />
              <Closed closed={perf.data.closed} />
            </>
          )}
      <Signals tenantId={tenantId} timeframe={timeframe} onEnded={onEnded} />
      <Health sum={sum} />
      <Incidents sum={sum} tenantId={tenantId} onEnded={onEnded} onChanged={onChanged} />
      <LotSizes onEnded={onEnded} />
    </>
  );
}

/* ------------------------------------------------------------ performance (v2) */

function Figure({ value, label, cls = "" }) {
  return (
    <div className="figure">
      <span className={`n ${cls}`}>{value}</span>
      <span className="l">{label}</span>
    </div>
  );
}

function Performance({ eq }) {
  if (!eq || eq.count === 0) return <><h2>Performance</h2><p className="quiet">No daily snapshots yet for this client and timeframe.</p></>;
  return (
    <>
      <h2>Performance</h2>
      <div className="figures">
        <Figure value={pct(eq.total_return_pct)} cls={tone(eq.total_return_pct)}
                label={<>total return since {day(eq.series[0].date)}<span className={`delta ${tone(eq.total_return_pkr)}`}> {signed(eq.total_return_pkr)} PKR</span></>} />
        <Figure value={plainPct(eq.max_drawdown_pct)} cls={eq.max_drawdown_pct > 0 ? "down" : ""} label="maximum drawdown from a peak" />
        <Figure value={plainPct(eq.current_drawdown_pct)} cls={eq.current_drawdown_pct > 0 ? "down" : ""}
                label={eq.current_drawdown_pct > 0 ? "below the highest equity so far" : "at the highest equity so far"} />
        <Figure value={`${eq.up_days} / ${eq.down_days}`} label={`up days / down days${eq.flat_days ? `, ${eq.flat_days} flat` : ""}`} />
      </div>
      <EquityChart series={eq.series} />
      <p className="quiet small">
        {eq.best_day && <>Best day {day(eq.best_day.date)}: <span className="up">{signed(eq.best_day.change_pkr)} PKR ({pct(eq.best_day.change_pct)})</span>. </>}
        {eq.worst_day && <>Worst day {day(eq.worst_day.date)}: <span className="down">{signed(eq.worst_day.change_pkr)} PKR ({pct(eq.worst_day.change_pct)})</span>.</>}
      </p>
    </>
  );
}

/* Equity line with drawdown shading beneath it and a daily-change bar strip;
   hover or tap for the exact figures of any day. */
function EquityChart({ series }) {
  const [hover, setHover] = useState(null);
  const W = 900, H = 230, P = { l: 8, r: 8, t: 12, b: 8 }, BAR = 56;
  const vals = series.map((s) => s.equity_pkr);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || hi * 0.01 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const n = series.length;
  const x = (i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
  const y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const line = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.equity_pkr).toFixed(1)}`).join(" ");
  const peaks = series.reduce((acc, s) => [...acc, Math.max(acc.length ? acc[acc.length - 1] : -Infinity, s.equity_pkr)], []);
  const dd = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(peaks[i]).toFixed(1)}`).join(" ")
    + " " + [...series].reverse().map((s, j) => `L${x(n - 1 - j).toFixed(1)},${y(s.equity_pkr).toFixed(1)}`).join(" ") + " Z";
  const maxMove = Math.max(...series.map((s) => Math.abs(s.daily_change_pct || 0)), 0.01);
  const bw = Math.max(1.5, ((W - P.l - P.r) / Math.max(n, 1)) * 0.7);
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((fx - P.l) / (W - P.l - P.r)) * (n - 1)))));
  };
  const h = hover != null ? series[hover] : series[n - 1];
  return (
    <div className="chart">
      <div className="chart-read">
        <span className="fig">{day(h.date)}</span>
        <span>Equity <b className="fig">{num(h.equity_pkr)}</b> PKR</span>
        <span>Day <b className={`fig ${tone(h.daily_change_pkr)}`}>{signed(h.daily_change_pkr)} ({pct(h.daily_change_pct)})</b></span>
        <span>Since start <b className={`fig ${tone(h.cumulative_return_pct)}`}>{pct(h.cumulative_return_pct)}</b></span>
        <span>Drawdown <b className={`fig ${h.drawdown_pct > 0 ? "down" : ""}`}>{plainPct(h.drawdown_pct)}</b></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + BAR}`} className="chart-svg" role="img" preserveAspectRatio="none"
           aria-label={`Equity from ${num(series[0].equity_pkr)} to ${num(series[n - 1].equity_pkr)} PKR over ${n} days`}
           onMouseMove={move} onMouseLeave={() => setHover(null)} onTouchStart={(e) => move(e.touches[0] ? { currentTarget: e.currentTarget, clientX: e.touches[0].clientX } : e)}>
        <line x1={P.l} x2={W - P.r} y1={y(series[0].equity_pkr)} y2={y(series[0].equity_pkr)} className="chart-base" />
        <path d={dd} className="chart-dd" />
        <path d={line} className="chart-line" />
        {series.map((s, i) => {
          const v = s.daily_change_pct || 0, bh = (Math.abs(v) / maxMove) * (BAR / 2 - 4), mid = H + BAR / 2;
          return <rect key={i} x={x(i) - bw / 2} y={v >= 0 ? mid - bh : mid} width={bw} height={Math.max(bh, 0.5)} className={v >= 0 ? "bar-up" : "bar-down"} />;
        })}
        <line x1={P.l} x2={W - P.r} y1={H + BAR / 2} y2={H + BAR / 2} className="chart-base" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H + BAR} className="chart-cursor" />}
        {hover != null && <circle cx={x(hover)} cy={y(series[hover].equity_pkr)} r="4" className="chart-dot" />}
      </svg>
      <div className="chart-axis fig"><span>{day(series[0].date)}</span><span>{num(lo)} to {num(hi)} PKR</span><span>{day(series[n - 1].date)}</span></div>
      <p className="quiet small">Line: equity. Shaded: distance below the running peak (drawdown). Bars: daily change in %.</p>
    </div>
  );
}

function Exposure({ ex, sum }) {
  const po = sum.portfolio;
  const overlap = po.ok && po.data.exposure_by_ticker
    ? Object.entries(po.data.exposure_by_ticker).filter(([, v]) => v.held_by_multiple_strategies) : [];
  const inv = Math.max(0, Math.min(100, ex.invested_pct || 0));
  return (
    <>
      <h2>Exposure</h2>
      <div className="split" aria-hidden="true"><span style={{ width: `${inv}%` }} /></div>
      <div className="figures">
        <Figure value={plainPct(ex.invested_pct)} label={<>invested, {num(ex.invested_pkr)} PKR</>} />
        <Figure value={plainPct(ex.not_invested_pct)} label={<>not invested, {num(ex.not_invested_pkr)} PKR</>} />
        <Figure value={ex.by_ticker.length} label={`ticker(s) held${ex.unpriced_positions ? `; ${ex.unpriced_positions} without a synced price` : ""}`} />
        <Figure value={overlap.length} label="ticker(s) held by more than one strategy" />
      </div>
      {overlap.length > 0 && (
        <p className="note">
          Overlapping exposure: {overlap.map(([t, v]) => `${t} (${v.strategies.map((s) => STRATEGY_NAMES[s] || s).join(" and ")})`).join("; ")}.
        </p>
      )}
      {ex.by_ticker.length > 0 && (
        <div className="scroll">
          <table className="plain nums">
            <thead><tr><th>Ticker</th><th>Strategies</th><th className="r">Market value (PKR)</th><th className="r">Share of equity (%)</th></tr></thead>
            <tbody>
              {ex.by_ticker.map((t) => (
                <tr key={t.symbol}>
                  <td>{t.symbol}</td>
                  <td>{t.strategies.map((s) => STRATEGY_NAMES[s] || s).join(", ")}</td>
                  <td className="r fig">{num(t.market_value_pkr)}</td>
                  <td className="r fig">{t.pct_of_equity == null ? "" : num(t.pct_of_equity, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Positions({ rows }) {
  return (
    <>
      <h2>Open positions</h2>
      {rows.length === 0 ? <p className="quiet">No open positions.</p> : (
        <div className="scroll">
          <table className="plain nums">
            <thead>
              <tr>
                <th>Ticker</th><th>Strategy</th><th>Entered</th><th className="r">Days</th><th className="r">Units</th>
                <th className="r">Entry (PKR)</th><th className="r">Last (PKR)</th><th className="r">Value (PKR)</th>
                <th className="r">Unrealized (PKR)</th><th className="r">Unrealized (%)</th><th className="r">Of equity (%)</th>
                <th className="r">Stop (PKR)</th><th className="r">To stop (%)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.position_id}>
                  <td>{p.symbol}{p.direction === "SHORT" ? <span className="sub">short</span> : null}</td>
                  <td>{STRATEGY_NAMES[p.strategy] || p.strategy}</td>
                  <td className="fig">{day(p.entry_date)}</td>
                  <td className="r fig">{p.days_held ?? ""}</td>
                  <td className="r fig">{num(p.units)}</td>
                  <td className="r fig">{num(p.entry_price, 2)}</td>
                  <td className="r fig">{p.last_close == null ? <span className="quiet">no price</span> : num(p.last_close, 2)}</td>
                  <td className="r fig">{num(p.market_value_pkr)}</td>
                  <td className={`r fig ${tone(p.unrealized_pnl_pkr)}`}>{signed(p.unrealized_pnl_pkr)}</td>
                  <td className={`r fig ${tone(p.unrealized_pnl_pct)}`}>{p.unrealized_pnl_pct == null ? "" : signed(p.unrealized_pnl_pct, 2)}</td>
                  <td className="r fig">{p.pct_of_equity == null ? "" : num(p.pct_of_equity, 2)}</td>
                  <td className="r fig">{p.stop == null ? "" : num(p.stop, 2)}</td>
                  <td className={`r fig ${p.distance_to_stop_pct != null && p.distance_to_stop_pct <= 1 ? "down strong" : ""}`}>
                    {p.distance_to_stop_pct == null ? "" : num(p.distance_to_stop_pct, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.some((p) => p.distance_to_stop_pct != null && p.distance_to_stop_pct <= 1) && (
        <p className="note">Highlighted: within 1% of its stop, likely to close on the next run.</p>
      )}
    </>
  );
}

function Strategies({ stats }) {
  const names = Object.keys(stats || {});
  return (
    <>
      <h2>Strategies</h2>
      {names.length === 0 ? <p className="quiet">No positions or closed trades yet.</p> : (
        <div className="scroll">
          <table className="plain nums">
            <thead>
              <tr>
                <th>Strategy</th><th className="r">Closed</th><th className="r">Win rate (%)</th><th className="r">Realized (PKR)</th>
                <th className="r">Avg win (PKR)</th><th className="r">Avg win (%)</th><th className="r">Avg loss (PKR)</th><th className="r">Avg loss (%)</th>
                <th className="r">Profit factor</th><th className="r">Open</th><th className="r">Unrealized (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => {
                const s = stats[n];
                return (
                  <tr key={n}>
                    <td>{STRATEGY_NAMES[n] || n}</td>
                    <td className="r fig">{s.closed_trades}<span className="sub-inline"> {s.closed_trades ? `(${s.wins}W ${s.losses}L)` : ""}</span></td>
                    <td className="r fig">{s.win_rate_pct == null ? "" : num(s.win_rate_pct, 2)}</td>
                    <td className={`r fig ${tone(s.realized_pnl_pkr)}`}>{signed(s.realized_pnl_pkr)}</td>
                    <td className="r fig up">{s.avg_win_pkr == null ? "" : signed(s.avg_win_pkr)}</td>
                    <td className="r fig up">{s.avg_win_pct == null ? "" : signed(s.avg_win_pct, 2)}</td>
                    <td className="r fig down">{s.avg_loss_pkr == null ? "" : signed(s.avg_loss_pkr)}</td>
                    <td className="r fig down">{s.avg_loss_pct == null ? "" : signed(s.avg_loss_pct, 2)}</td>
                    <td className="r fig">{s.profit_factor == null ? (s.wins && !s.losses ? "no losses" : "") : num(s.profit_factor, 2)}</td>
                    <td className="r fig">{s.open_positions}</td>
                    <td className={`r fig ${tone(s.unrealized_pnl_pkr)}`}>{signed(s.unrealized_pnl_pkr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="quiet small">Profit factor: total gains divided by total losses on closed trades; above 1 means gains outweigh losses.</p>
    </>
  );
}

function Closed({ closed }) {
  const [all, setAll] = useState(false);
  const rows = all ? closed.recent : closed.recent.slice(0, 15);
  return (
    <>
      <h2>Closed trades</h2>
      {closed.total === 0 ? <p className="quiet">No closed trades yet.</p> : (
        <>
          <p className="quiet small">
            {closed.total} closed, {closed.wins} profitable ({plainPct(closed.win_rate_pct)}), realized{" "}
            <span className={tone(closed.realized_pnl_pkr)}>{signed(closed.realized_pnl_pkr)} PKR</span>.
          </p>
          <div className="scroll">
            <table className="plain nums">
              <thead>
                <tr>
                  <th>Closed</th><th>Ticker</th><th>Strategy</th><th className="r">Units</th><th className="r">Entry (PKR)</th>
                  <th className="r">Exit (PKR)</th><th className="r">PnL (PKR)</th><th className="r">PnL (%)</th><th>Exit reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.trade_id}>
                    <td className="fig">{day(t.closed_at)}</td>
                    <td>{t.symbol}</td>
                    <td>{STRATEGY_NAMES[t.strategy] || t.strategy}</td>
                    <td className="r fig">{num(t.units)}</td>
                    <td className="r fig">{num(t.entry_price, 2)}</td>
                    <td className="r fig">{num(t.exit_price, 2)}</td>
                    <td className={`r fig ${tone(t.pnl_pkr)}`}>{signed(t.pnl_pkr)}</td>
                    <td className={`r fig ${tone(t.pnl_pct)}`}>{t.pnl_pct == null ? "" : signed(t.pnl_pct, 2)}</td>
                    <td>{(t.exit_reason || "").toLowerCase().replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {closed.recent.length > 15 && (
            <button className="quietbtn" onClick={() => setAll(!all)}>{all ? "Show the latest 15" : `Show all ${closed.recent.length}`}</button>
          )}
        </>
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
                      <td className={`r fig ${tone(r.outcome_pnl_pkr)}`}>{r.outcome_pnl_pkr != null ? signed(r.outcome_pnl_pkr) : ""}</td>
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
