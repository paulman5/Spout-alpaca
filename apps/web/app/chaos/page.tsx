"use client";

import { useEffect, useState } from "react";
import { api, getAdminToken, setAdminToken, short } from "@/lib/api";
import type { OrderView } from "@spout/shared";
import { useT, type Key } from "@/lib/i18n";
import { Button, Panel } from "@/components/ui";

interface Faults {
  mode: string;
  until: number | null;
  slowMinMs: number;
  slowMaxMs: number;
  failRate: number;
  fillDelayMs: number;
  seed: number;
}

/** One action = one button and one plain-language notice (what it does, what to watch). */
function Action({ id, children, stacked = false }: { id: string; children: React.ReactNode; stacked?: boolean }) {
  const { t } = useT();
  // Controls wider than the 10rem column (the replay row) go under the description instead of beside it.
  return (
    <div className={stacked ? "sx-action sx-action-stacked" : "sx-action"}>
      {stacked ? null : <div>{children}</div>}
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--paper)" }}>{t(`${id}.title` as Key)}</p>
        <p className="sx-note" style={{ marginTop: "0.15rem" }}>{t(`${id}.what` as Key)}</p>
        <p className="sx-note" style={{ marginTop: "0.15rem" }}>
          <span className="sx-mono" style={{ fontSize: "0.625rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)" }}>
            {t("chaos.watch")}
          </span>{" "}
          {t(`${id}.watch` as Key)}
        </p>
      </div>
      {stacked ? <div style={{ minWidth: 0 }}>{children}</div> : null}
    </div>
  );
}

const SCENARIOS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const SCENARIO_CMD: Record<(typeof SCENARIOS)[number], string> = {
  A: "pnpm scenario a",
  B: "pnpm scenario b",
  C: "pnpm scenario c",
  D: "pnpm scenario d",
  E: "pnpm scenario e",
  F: "pnpm scenario f",
  G: "BROKER=alpaca, pnpm scenario g",
};

export default function ChaosPage() {
  const { t } = useT();
  const [faults, setFaults] = useState<Faults | null>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string>("");
  const [sig, setSig] = useState("");
  const [duration, setDuration] = useState(30);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [recent, setRecent] = useState<OrderView[]>([]);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    try {
      const [s, w, o] = await Promise.all([api<{ faults: Faults }>("/mock/state"), api<{ paused: boolean }>("/workers"), api<OrderView[]>("/orders?limit=8")]);
      setFaults(s.faults);
      setPaused(w.paused);
      setRecent(o);
    } catch (e) {
      setOut(String(e).replace(/^Error:\s*/, ""));
    }
  };
  useEffect(() => {
    setHasToken(!!getAdminToken());
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, []);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      const r = await fn();
      setOut(JSON.stringify(r, null, 2));
      await refresh();
    } catch (e) {
      setOut(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  };
  const setFault = (body: Record<string, unknown>) => run("fault", () => api("/mock/faults", { method: "POST", body: JSON.stringify(body) }));
  const remaining = faults?.until ? Math.max(0, Math.round((faults.until - Date.now()) / 1000)) : null;
  const saveToken = () => {
    setAdminToken(token || null);
    setHasToken(!!token);
    setOut(token ? t("access.saved") : t("access.removed"));
    setToken("");
  };

  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      <div style={{ display: "grid", gap: "0.6rem" }}>
        <p className="sx-index">{t("chaos.index")}</p>
        <h1 className="sx-h1">
          {t("chaos.h1a")} <span className="sx-em">{t("chaos.h1b")}</span>
        </h1>
        <p className="sx-lede">{t("chaos.lede")}</p>
      </div>

      <Panel title={t("access.title")} meta={hasToken ? <span style={{ color: "var(--accent)" }}>{t("access.stored")}</span> : <span style={{ color: "var(--warn)" }}>{t("access.none")}</span>}>
        <p className="sx-note" style={{ marginBottom: "0.8rem" }}>{t("access.note")}</p>
        <div className="flex gap-2">
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("access.placeholder")} className="sx-input" type="password" />
          <Button variant="primary" onClick={saveToken}>
            {t("access.save")}
          </Button>
        </div>
      </Panel>

      <Panel
        title={t("sim.title")}
        meta={
          faults ? (
            <>
              {t("chaos.mode")} · <span style={{ color: faults.mode === "none" ? "var(--accent)" : "var(--warn)" }}>{faults.mode}</span>
              {remaining !== null && ` · ${remaining}s ${t("chaos.left")}`}
            </>
          ) : (
            "…"
          )
        }
      >
        <p className="sx-note" style={{ marginBottom: "0.4rem" }}>{t("sim.note")}</p>
        <label className="flex items-center gap-3" style={{ padding: "0.5rem 0" }}>
          <span className="sx-label">{t("chaos.duration")}</span>
          <input type="number" value={duration} min={5} max={600} onChange={(e) => setDuration(Number(e.target.value))} className="sx-input" style={{ width: "5.5rem" }} />
          <span className="sx-note">{t("chaos.duration.note")}</span>
        </label>

        <Action id="sim.500">
          <Button variant="warn" disabled={!!busy} onClick={() => setFault({ mode: "http500", durationMs: duration * 1000 })}>
            http 500
          </Button>
        </Action>
        <Action id="sim.slow">
          <Button disabled={!!busy} onClick={() => setFault({ mode: "slow", slowMinMs: 2000, slowMaxMs: 10000, durationMs: duration * 1000 })}>
            slow
          </Button>
        </Action>
        <Action id="sim.flaky">
          <Button disabled={!!busy} onClick={() => setFault({ mode: "flaky", failRate: 0.5, durationMs: duration * 1000 })}>
            flaky
          </Button>
        </Action>
        <Action id="sim.closed">
          <Button disabled={!!busy} onClick={() => setFault({ mode: "market_closed" })}>
            market closed
          </Button>
        </Action>
        <Action id="sim.clear">
          <Button variant="primary" disabled={!!busy} onClick={() => setFault({ mode: "none", fillDelayMs: 3000 })}>
            clear
          </Button>
        </Action>
      </Panel>

      <Panel title={t("workers.title")} meta={paused === null ? "…" : paused ? <span style={{ color: "var(--warn)" }}>{t("workers.paused")}</span> : <span style={{ color: "var(--accent)" }}>{t("workers.running")}</span>}>
        <p className="sx-note" style={{ marginBottom: "0.4rem" }}>{t("workers.note")}</p>
        <Action id="workers.pause">
          <Button variant="warn" disabled={!!busy || paused === true} onClick={() => run("pause", () => api("/workers/pause", { method: "POST" }))}>
            pause
          </Button>
        </Action>
        <Action id="workers.resume">
          <Button variant="primary" disabled={!!busy || paused === false} onClick={() => run("resume", () => api("/workers/resume", { method: "POST" }))}>
            resume
          </Button>
        </Action>
      </Panel>

      <Panel title={t("repair.title")} meta={t("repair.meta")}>
        <Action id="repair.reconcile">
          <Button variant="primary" disabled={!!busy} onClick={() => run("reconcile", () => api("/reconcile", { method: "POST", body: JSON.stringify({ minAgeMs: 0 }) }))}>
            reconcile
          </Button>
        </Action>
        <Action id="repair.replay" stacked>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div className="flex flex-wrap gap-2">
              <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder={t("repair.replay.placeholder")} title="signature or explorer link" className="sx-input" style={{ flex: "1 1 18rem", width: "auto" }} />
              <Button
                disabled={!sig}
                onClick={() => {
                  void navigator.clipboard?.writeText(sig.trim());
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? t("repair.replay.copied") : t("repair.replay.copy")}
              </Button>
              <Button variant="primary" disabled={!!busy || !sig} onClick={() => run("replay", () => api("/replay", { method: "POST", body: JSON.stringify({ signature: sig.trim() }) }))}>
                replay
              </Button>
            </div>
            <label className="flex flex-wrap items-center gap-2">
              <span className="sx-note" style={{ whiteSpace: "nowrap" }}>{t("repair.replay.pick")}</span>
              <select className="sx-input sx-select" data-empty="true" style={{ flex: "1 1 18rem", width: "auto", minWidth: 0 }} value="" onChange={(e) => setSig(e.target.value)}>
                <option value="">{t("repair.replay.pickPlaceholder")}</option>
                {recent.map((o) => (
                  <option key={o.orderId} value={o.createdSignature}>
                    #{o.orderId} · {o.ticker} · {o.status} · {short(o.createdSignature, 5)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Action>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
        <Panel title={t("scen.title")} meta={t("scen.meta")}>
          <p className="sx-note" style={{ marginBottom: "0.6rem" }}>{t("scen.note")}</p>
          <ol className="m-0 list-none p-0" style={{ display: "grid", gap: "0.8rem" }}>
            {SCENARIOS.map((id) => (
              <li key={id} className="flex gap-4">
                <span className="sx-mono" style={{ color: "var(--accent)", flex: "none", width: "1.5rem" }}>
                  {id}
                </span>
                <div style={{ minWidth: 0 }}>
                  <p className="sx-h3" style={{ fontSize: "1.05rem" }}>
                    {t(`scen.${id}.title` as Key)} <span className="sx-mono" style={{ fontSize: "0.7rem", marginLeft: "0.5rem" }}>{SCENARIO_CMD[id]}</span>
                  </p>
                  <p className="sx-note" style={{ margin: 0 }}>{t(`scen.${id}.plain` as Key)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title={t("last.title")} meta={busy ? `${t("last.running")} ${busy}…` : t("last.meta")}>
          <pre className="sx-details" style={{ maxHeight: "28rem", margin: 0 }}>
            {out || "—"}
          </pre>
        </Panel>
      </div>
    </div>
  );
}
