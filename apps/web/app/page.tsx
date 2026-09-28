"use client";

import { useStream } from "@/lib/api";
import { Panel, Stat, isTerminal } from "@/components/ui";
import { OrdersTable } from "@/components/orders-table";
import { LiveFeed } from "@/components/ledger";
import { PlaceOrder } from "@/components/place-order";
import { useT } from "@/lib/i18n";

export default function Dashboard() {
  const { data, connected, error } = useStream();
  const { t } = useT();
  const orders = data?.orders ?? [];
  const count = (pred: (s: string) => boolean) => orders.filter((o) => pred(o.status)).length;
  const inFlight = count((s) => !isTerminal(s));
  const needsHuman = count((s) => s === "needs_human");
  const alerts = data?.alerts ?? [];

  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <p className="sx-index">{t("dash.index")}</p>
          <h1 className="sx-h1">
            {t("dash.h1a")} <span className="sx-em">{t("dash.h1b")}</span>
          </h1>
          <p className="sx-lede">{t("dash.lede")}</p>
        </div>
        <span className="sx-chip" data-tone={connected ? "done" : "warn"}>
          <span className="sx-dot" data-tone={connected ? undefined : "warn"} />
          {connected ? t("dash.live") : (error ?? t("dash.connecting"))}
        </span>
      </div>

      <PlaceOrder />

      <div className="sx-grid sx-grid-5">
        <Stat label={t("stat.orders")} value={orders.length} />
        <Stat label={t("stat.inflight")} value={inFlight} note={inFlight ? t("stat.inflight.on") : t("stat.inflight.off")} />
        <Stat label={t("stat.settled")} value={count((s) => s === "settled")} note="fulfill_buy_order" />
        <Stat label={t("stat.refunded")} value={count((s) => s === "refunded")} note="refund_buy_order" />
        <Stat label={t("stat.human")} value={needsHuman} note={needsHuman ? t("stat.human.on") : t("stat.human.off")} />
      </div>

      {alerts.length > 0 && (
        <div className="sx-admission">
          <p className="sx-admission-title">
            {alerts.length} {t("alerts.title")}
          </p>
          <ul className="m-0 list-none p-0" style={{ display: "grid", gap: "0.35rem" }}>
            {alerts.map((a) => (
              <li key={a.id} style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                <span className="sx-mono" style={{ fontSize: "0.6875rem", marginRight: "0.6rem" }}>
                  {a.createdAt.slice(11, 19)} · {a.severity}
                </span>
                {a.message}
                {a.orderId && (
                  <span className="sx-mono" style={{ marginLeft: "0.5rem" }}>
                    order {a.orderId}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={t("panel.orders")} meta={t("panel.orders.meta")}>
          <OrdersTable orders={orders} />
        </Panel>
        <Panel title={t("panel.ledger")} meta={t("panel.ledger.meta")}>
          <LiveFeed events={data?.events ?? []} />
        </Panel>
      </div>
    </div>
  );
}
