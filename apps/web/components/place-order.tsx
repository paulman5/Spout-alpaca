"use client";

import { useState } from "react";
import Link from "next/link";
import { api, explorerTx, short } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, ExternalLink, Panel } from "./ui";

interface Placed {
  user: string;
  orderId: string;
  signature: string;
  ticker: string;
  usdc: number;
}

/** One click = one real devnet order, signed by the API's keypair (demo helper). */
export function PlaceOrder() {
  const { t } = useT();
  const [ticker, setTicker] = useState("AAPL");
  const [usdc, setUsdc] = useState(5);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlaced(await api<Placed>("/orders/place", { method: "POST", body: JSON.stringify({ ticker, usdc }) }));
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t("place.title")} meta={t("place.meta")}>
      <p className="sx-note" style={{ marginBottom: "0.8rem" }}>{t("place.note")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label style={{ display: "grid", gap: "0.3rem" }}>
          <span className="sx-label">{t("place.ticker")}</span>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="sx-input" style={{ width: "7rem" }} maxLength={8} />
        </label>
        <label style={{ display: "grid", gap: "0.3rem" }}>
          <span className="sx-label">{t("place.amount")}</span>
          <input type="number" min={1} max={1000} value={usdc} onChange={(e) => setUsdc(Number(e.target.value))} className="sx-input" style={{ width: "7rem" }} />
        </label>
        <Button variant="primary" disabled={busy || !ticker} onClick={() => void submit()}>
          {busy ? t("place.placing") : t("place.button")}
        </Button>
      </div>
      {error && (
        <p className="sx-mono" style={{ color: "var(--warn)", marginTop: "0.8rem" }}>
          {error}
        </p>
      )}
      {placed && !error && (
        <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.3rem" }}>
          <p style={{ margin: 0, fontSize: "0.875rem" }}>{t("place.done")}</p>
          <p className="sx-mono" style={{ margin: 0, fontSize: "0.75rem" }}>
            {placed.ticker} · ${placed.usdc.toFixed(2)} · #{placed.orderId} · {t("place.tx")}{" "}
            <ExternalLink href={explorerTx(placed.signature)}>{short(placed.signature, 8)}</ExternalLink> ·{" "}
            <Link href={`/orders/${placed.user}/${placed.orderId}`} className="sx-link">
              {t("place.open")}
            </Link>
          </p>
        </div>
      )}
    </Panel>
  );
}
