"use client";

import Link from "next/link";
import type { OrderView } from "@spout/shared";
import { ago, explorerTx, short, usdc } from "@/lib/api";
import { ExternalLink, StatusChip } from "./ui";
import { useT } from "@/lib/i18n";

export function OrdersTable({ orders }: { orders: OrderView[] }) {
  const { t } = useT();
  if (orders.length === 0) {
    return (
      <p className="sx-note">
        {t("table.empty")} <span className="sx-mono">pnpm place-order AAPL 25</span>.
      </p>
    );
  }
  return (
    <div className="sx-table-wrap">
      <table className="sx-table">
        <thead>
          <tr>
            <th>{t("table.order")}</th>
            <th>{t("table.ticker")}</th>
            <th className="sx-num">{t("table.usdc")}</th>
            <th>{t("table.status")}</th>
            <th>{t("table.broker")}</th>
            <th>{t("table.settlement")}</th>
            <th className="sx-num">{t("table.retries")}</th>
            <th className="sx-num">{t("table.updated")}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={`${o.userPubkey}/${o.orderId}`}>
              <td>
                <Link href={`/orders/${o.userPubkey}/${o.orderId}`} className="sx-link sx-mono" style={{ color: "var(--paper)" }}>
                  {o.orderId}
                </Link>
              </td>
              <td style={{ color: "var(--paper)" }}>{o.ticker}</td>
              <td className="sx-num sx-mono">{usdc(o.amount)}</td>
              <td>
                <StatusChip status={o.status} />
              </td>
              <td className="sx-mono" style={{ fontSize: "0.75rem" }}>
                {o.brokerOrderId ? (
                  <span title={o.brokerOrderId}>
                    {short(o.brokerOrderId, 4)} <span style={{ color: "var(--paper)" }}>{o.brokerStatus}</span>
                    {o.filledNotional && <span style={{ color: "var(--accent)" }}> ${Number(o.filledNotional).toFixed(2)}</span>}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="sx-mono" style={{ fontSize: "0.75rem" }}>
                {o.settleSignature ? <ExternalLink href={explorerTx(o.settleSignature)}>{short(o.settleSignature, 5)}</ExternalLink> : "—"}
              </td>
              <td className="sx-num sx-mono" style={{ color: o.attempts > 0 ? "var(--warn)" : undefined }}>
                {o.attempts}
              </td>
              <td className="sx-num sx-mono" style={{ fontSize: "0.6875rem" }} title={o.lockedBy ? `leased by ${o.lockedBy}` : undefined}>
                {ago(o.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
