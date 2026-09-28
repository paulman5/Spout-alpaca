"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { OrderEventView, OrderView } from "@spout/shared";
import { api, explorerAddress, explorerTx, short, usdc } from "@/lib/api";
import { Button, ExternalLink, Panel, Row, StatusChip } from "@/components/ui";
import { LedgerTimeline } from "@/components/ledger";
import { useT } from "@/lib/i18n";

export default function OrderPage({ params }: { params: Promise<{ user: string; orderId: string }> }) {
  const { user, orderId } = use(params);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [events, setEvents] = useState<OrderEventView[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { t } = useT();

  const copySig = () => {
    if (!order) return;
    void navigator.clipboard?.writeText(order.createdSignature);
    setNote(t("order.copied"));
    setTimeout(() => setNote(null), 1500);
  };
  const replay = async () => {
    if (!order) return;
    try {
      await api("/replay", { method: "POST", body: JSON.stringify({ signature: order.createdSignature }) });
      setNote(t("order.replay.done"));
      await load();
    } catch (e) {
      setNote(String(e).replace(/^Error:\s*/, ""));
    }
  };

  const load = async () => {
    try {
      const [o, e] = await Promise.all([api<OrderView>(`/orders/${user}/${orderId}`), api<OrderEventView[]>(`/orders/${user}/${orderId}/events`)]);
      setOrder(o);
      setEvents(e);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, orderId]);

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div style={{ display: "grid", gap: "0.6rem" }}>
        <Link href="/" className="sx-index" style={{ textDecoration: "none" }}>
          {t("order.back")}
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="sx-h2">
            {t("order.title")} <span className="sx-mono" style={{ fontSize: "1.2rem", color: "var(--paper)" }}>{orderId}</span>
          </h1>
          {order && <StatusChip status={order.status} />}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={copySig} disabled={!order}>
              {t("order.copy")}
            </Button>
            <Button variant="primary" onClick={() => void replay()} disabled={!order}>
              {t("order.replay")}
            </Button>
            <Button onClick={() => void load()}>{t("order.refresh")}</Button>
          </div>
        </div>
        {note && (
          <p className="sx-note" style={{ color: "var(--accent)" }}>
            {note}
          </p>
        )}
      </div>
      {err && <p className="sx-mono" style={{ color: "var(--warn)" }}>{err}</p>}

      {order && (
        <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <Panel title={t("order.record")} meta="orders">
            <div style={{ display: "grid", gap: "0.1rem" }}>
              <Row k="user">
                <ExternalLink href={explorerAddress(order.userPubkey)}>{short(order.userPubkey, 8)}</ExternalLink>
              </Row>
              <Row k="ticker">{order.ticker}</Row>
              <Row k="usdc">{usdc(order.amount)}</Row>
              <Row k="client id">{order.clientOrderId}</Row>
              <Row k="created tx">
                <ExternalLink href={explorerTx(order.createdSignature)}>{short(order.createdSignature, 8)}</ExternalLink>
              </Row>
              <div style={{ borderTop: "1px solid var(--rule-soft)", margin: "0.6rem 0" }} />
              <Row k="broker order">{order.brokerOrderId ?? "—"}</Row>
              <Row k="broker status">{order.brokerStatus ?? "—"}</Row>
              <Row k="filled">
                {order.filledNotional ? `$${Number(order.filledNotional).toFixed(2)} · ${Number(order.filledQty).toFixed(6)} sh` : "—"}
              </Row>
              <div style={{ borderTop: "1px solid var(--rule-soft)", margin: "0.6rem 0" }} />
              <Row k="settle tx">
                {order.settleSignature ? <ExternalLink href={explorerTx(order.settleSignature)}>{short(order.settleSignature, 8)}</ExternalLink> : "—"}
              </Row>
              <Row k="attempts">
                <span style={{ color: order.attempts ? "var(--warn)" : undefined }}>{order.attempts}</span>
              </Row>
              <Row k="next attempt">{order.nextAttemptAt ? order.nextAttemptAt.slice(11, 19) : "—"}</Row>
              <Row k="lease">{order.lockedBy ?? "—"}</Row>
              {order.lastError && (
                <Row k="last error">
                  <span style={{ color: "var(--warn)" }}>{order.lastError}</span>
                </Row>
              )}
            </div>
          </Panel>
          <Panel title={t("order.ledger")} meta={`${events.length} ${t("order.lines")}`}>
            <LedgerTimeline events={events} />
          </Panel>
        </div>
      )}
    </div>
  );
}
