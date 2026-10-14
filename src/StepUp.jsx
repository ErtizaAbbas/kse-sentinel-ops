/*
 * src/StepUp.jsx  (kse-sentinel-ops, Oct 14 2026)
 *
 * Step-up: sensitive actions need an authenticator code from the last ~5
 * minutes (spec Section 18.5). Signing in counts as one.
 *
 *   run(fn)      runs a sensitive call. If the window has run out, it first
 *                asks for a code; if the server still answers 403
 *                step-up-required, it asks and repeats the call once (safe:
 *                the refused call never reached the Data API).
 *   useAction()  run(fn) plus busy and error state for a button.
 *   StepUpChip   "Verified for N min" in the side rail while the window is open.
 *
 * A wrong code answers 403 step-up-code-incorrect and never signs the user
 * out; 423 account-locked closes the prompt with the server's message.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SessionEnded, stepUpStatus, stepUpVerify } from "./api.js";
import { ErrorLine } from "./ui.jsx";

export class StepUpCancelled extends Error {}

const Ctx = createContext(null);
export const useStepUp = () => useContext(Ctx);

export function StepUpProvider({ children }) {
  const deadline = useRef(0);
  const [left, setLeft] = useState(0);
  const [asking, setAsking] = useState(null);       // { resolve, reject }

  const tick = useCallback(() => setLeft(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))), []);
  const refresh = useCallback(async () => {
    try {
      const s = await stepUpStatus();
      deadline.current = Date.now() + (Number(s.seconds_left) || 0) * 1000;
    } catch {
      deadline.current = 0;
    }
    tick();
  }, [tick]);

  useEffect(() => {
    refresh();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [refresh, tick]);

  const ask = useCallback(() => new Promise((resolve, reject) => setAsking({ resolve, reject })), []);

  const run = useCallback(async (fn) => {
    if (Math.ceil((deadline.current - Date.now()) / 1000) <= 10) await ask();
    try {
      return await fn();
    } catch (e) {
      if (e?.code === "step-up-required") {
        deadline.current = 0;
        tick();
        await ask();
        return await fn();
      }
      throw e;
    }
  }, [ask, tick]);

  const finish = (how, value) => {
    const a = asking;
    setAsking(null);
    if (a) a[how](value);
  };

  return (
    <Ctx.Provider value={{ run, left, refresh }}>
      {children}
      {asking && (
        <StepUpDialog
          onVerified={async () => { await refresh(); finish("resolve"); }}
          onCancel={() => finish("reject", new StepUpCancelled("Cancelled."))}
          onFail={(err) => finish("reject", err)}
        />
      )}
    </Ctx.Provider>
  );
}

function StepUpDialog({ onVerified, onCancel, onFail }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const digits = code.replace(/\D/g, "");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await stepUpVerify(digits);
      await onVerified();
    } catch (err) {
      if (err instanceof SessionEnded || err.status === 423 || err.code === "account-locked") { onFail(err); return; }
      setError(err);
      setCode("");
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" role="presentation">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="stepup-title" onSubmit={submit}
            onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
        <h2 id="stepup-title">Enter your authenticator code</h2>
        <p className="quiet">This change needs a fresh code from your authenticator app. It then stays valid for about 5 minutes.</p>
        <input className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength="7"
               aria-label="Authentication code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        <ErrorLine error={error} />
        <div className="row">
          <button className="primary" disabled={busy || digits.length !== 6}>{busy ? "Checking" : "Verify and continue"}</button>
          <button type="button" className="link" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

export function StepUpChip() {
  const ctx = useStepUp();
  if (!ctx || ctx.left <= 0) return null;
  const mins = Math.ceil(ctx.left / 60);
  return <div className="stepup-chip">Verified for {ctx.left < 60 ? "under a minute" : `${mins} min`}</div>;
}

/* A button's action: busy and error state, with step-up when `sensitive`.
   Resolves to the response, or to undefined when it failed or was cancelled. */
export function useAction(onEnded) {
  const { run } = useStepUp();
  const [state, setState] = useState(null);
  const go = useCallback(async (fn, { sensitive = true } = {}) => {
    setState({ busy: true });
    try {
      const r = sensitive ? await run(fn) : await fn();
      setState(null);
      return r ?? {};
    } catch (e) {
      if (e instanceof StepUpCancelled) { setState(null); return undefined; }
      if (onEnded && onEnded(e)) return undefined;
      setState({ error: e });
      return undefined;
    }
  }, [run, onEnded]);
  const clear = useCallback(() => setState(null), []);
  return [state, go, clear];
}
