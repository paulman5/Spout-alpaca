import type { Lang } from "./i18n";

/** Plain-language meaning of each ledger reason, so the timeline reads like a story. */
const en: Record<string, string> = {
  event_ingested: "Order seen on the blockchain and recorded.",
  duplicate_event_ignored: "The same event arrived again; nothing changed.",
  broker_intent_recorded: "About to place the trade at the broker; the intent is saved first.",
  broker_recovery_found: "The broker already had this order; it was adopted instead of placed again.",
  broker_recovered: "Recovered the broker order after a restart.",
  broker_recovered_filled: "Recovered the broker order after a restart; it was already filled.",
  broker_accepted: "The broker accepted the trade.",
  broker_duplicate_adopted: "The broker reported a duplicate; the original order was adopted.",
  broker_filled: "The broker filled the trade.",
  broker_filled_partial: "The broker filled part of the trade, then closed it; settling for the filled amount.",
  broker_rejected: "The broker refused the trade for good; refunding.",
  broker_rejected_after_accept: "The broker rejected the trade after accepting it; refunding.",
  broker_canceled_after_accept: "The broker canceled the trade; refunding.",
  settlement_started: "Settling the order on the blockchain.",
  fulfill_tx_signed: "Settlement transaction signed and saved before sending.",
  fulfill_confirmed: "Settlement confirmed on the blockchain.",
  refund_tx_signed: "Refund transaction signed and saved before sending.",
  refund_confirmed: "Refund confirmed on the blockchain.",
  already_settled_3012: "The blockchain reports the order was already closed (error 3012); recorded as done.",
  settlement_confirmed_on_recheck: "The earlier settlement had landed after all; recorded as done.",
  settlement_signature_recheck: "Checked whether an earlier settlement landed.",
  pda_already_closed: "The on-chain order was already closed; nothing to send.",
  pda_closed_before_processing: "The on-chain order was already closed before any trade; no trade placed.",
  retry_scheduled: "Temporary failure; a retry is scheduled.",
  retries_exhausted_no_broker_trade: "Too many failures and no trade at the broker; refunding.",
  retries_exhausted_but_broker_filled: "Too many failures but the broker filled the trade; a human must settle it.",
  retries_exhausted_broker_open: "Too many failures with an open broker order; canceling before any refund.",
  retries_exhausted_broker_unreachable: "Too many failures and the broker cannot be reached; a human must decide.",
  retries_exhausted_settling: "Too many failures while settling; a human must finish it.",
  retries_exhausted_refunding: "Too many failures while refunding; a human must finish it.",
  filled_at_broker_while_refunding: "The broker filled the trade during the refund; not refunded, a human must settle it.",
  broker_cancel_requested: "Asked the broker to cancel the open order.",
  broker_cancel_confirmed: "The broker confirmed the cancel; nothing was filled.",
  order_exceeds_cap: "Order above the automatic limit; waiting for manual approval.",
  unexpected_permanent_error: "Unexpected permanent error; a human must look.",
  fulfill_rejected_by_program: "The program rejected the settlement; a human must look.",
  refund_rejected_by_program: "The program rejected the refund; a human must look.",
  reconciled_broker_filled: "Reconciliation found the fill the poller had missed.",
  reconciled_broker_order_found: "Reconciliation found the broker order the database had not recorded.",
  reconciled_broker_rejected: "Reconciliation found the broker rejected the trade; refunding.",
  reconciled_broker_canceled: "Reconciliation found the broker canceled the trade; refunding.",
  reconciled_pda_closed: "Reconciliation found the on-chain order already closed.",
  reconciled_pda_closed_before_fill: "Reconciliation found the on-chain order closed with no fill recorded; a human must verify.",
  reconciled_schedule_reset: "Reconciliation brought the next attempt forward.",
  scenario_drift_injected: "Test hook: the database was altered on purpose.",
  chain_event_BuyOrderFulfilled: "The blockchain emitted BuyOrderFulfilled for this order.",
  chain_event_BuyOrderRefunded: "The blockchain emitted BuyOrderRefunded for this order.",
};

const fr: Record<string, string> = {
  event_ingested: "Ordre vu sur la blockchain et enregistré.",
  duplicate_event_ignored: "Le même événement est arrivé une nouvelle fois ; rien n'a changé.",
  broker_intent_recorded: "Sur le point de placer le trade chez le courtier ; l'intention est d'abord sauvegardée.",
  broker_recovery_found: "Le courtier avait déjà cet ordre ; il a été repris au lieu d'être replacé.",
  broker_recovered: "Ordre courtier retrouvé après un redémarrage.",
  broker_recovered_filled: "Ordre courtier retrouvé après un redémarrage ; il était déjà exécuté.",
  broker_accepted: "Le courtier a accepté le trade.",
  broker_duplicate_adopted: "Le courtier a signalé un doublon ; l'ordre d'origine a été repris.",
  broker_filled: "Le courtier a exécuté le trade.",
  broker_filled_partial: "Le courtier a exécuté une partie du trade puis l'a clos ; règlement du montant exécuté.",
  broker_rejected: "Le courtier a refusé le trade définitivement ; remboursement.",
  broker_rejected_after_accept: "Le courtier a rejeté le trade après l'avoir accepté ; remboursement.",
  broker_canceled_after_accept: "Le courtier a annulé le trade ; remboursement.",
  settlement_started: "Règlement de l'ordre sur la blockchain.",
  fulfill_tx_signed: "Transaction de règlement signée et sauvegardée avant l'envoi.",
  fulfill_confirmed: "Règlement confirmé sur la blockchain.",
  refund_tx_signed: "Transaction de remboursement signée et sauvegardée avant l'envoi.",
  refund_confirmed: "Remboursement confirmé sur la blockchain.",
  already_settled_3012: "La blockchain indique que l'ordre était déjà clos (erreur 3012) ; enregistré comme terminé.",
  settlement_confirmed_on_recheck: "Le règlement précédent avait finalement abouti ; enregistré comme terminé.",
  settlement_signature_recheck: "Vérification qu'un règlement précédent a abouti.",
  pda_already_closed: "L'ordre on-chain était déjà clos ; rien à envoyer.",
  pda_closed_before_processing: "L'ordre on-chain était déjà clos avant tout trade ; aucun trade placé.",
  retry_scheduled: "Panne passagère ; un nouvel essai est programmé.",
  retries_exhausted_no_broker_trade: "Trop d'échecs et aucun trade chez le courtier ; remboursement.",
  retries_exhausted_but_broker_filled: "Trop d'échecs mais le courtier a exécuté le trade ; un humain doit régler.",
  retries_exhausted_broker_open: "Trop d'échecs avec un ordre courtier ouvert ; annulation avant tout remboursement.",
  retries_exhausted_broker_unreachable: "Trop d'échecs et courtier injoignable ; un humain doit décider.",
  retries_exhausted_settling: "Trop d'échecs pendant le règlement ; un humain doit terminer.",
  retries_exhausted_refunding: "Trop d'échecs pendant le remboursement ; un humain doit terminer.",
  filled_at_broker_while_refunding: "Le courtier a exécuté le trade pendant le remboursement ; pas de remboursement, un humain doit régler.",
  broker_cancel_requested: "Annulation de l'ordre ouvert demandée au courtier.",
  broker_cancel_confirmed: "Le courtier a confirmé l'annulation ; rien n'a été exécuté.",
  order_exceeds_cap: "Ordre au-dessus de la limite automatique ; en attente d'approbation manuelle.",
  unexpected_permanent_error: "Erreur permanente inattendue ; un humain doit regarder.",
  fulfill_rejected_by_program: "Le programme a rejeté le règlement ; un humain doit regarder.",
  refund_rejected_by_program: "Le programme a rejeté le remboursement ; un humain doit regarder.",
  reconciled_broker_filled: "La réconciliation a trouvé l'exécution que le poller avait manquée.",
  reconciled_broker_order_found: "La réconciliation a trouvé l'ordre courtier que la base n'avait pas enregistré.",
  reconciled_broker_rejected: "La réconciliation a trouvé que le courtier a rejeté le trade ; remboursement.",
  reconciled_broker_canceled: "La réconciliation a trouvé que le courtier a annulé le trade ; remboursement.",
  reconciled_pda_closed: "La réconciliation a trouvé l'ordre on-chain déjà clos.",
  reconciled_pda_closed_before_fill: "La réconciliation a trouvé l'ordre on-chain clos sans exécution enregistrée ; un humain doit vérifier.",
  reconciled_schedule_reset: "La réconciliation a avancé le prochain essai.",
  scenario_drift_injected: "Outil de test : la base a été modifiée exprès.",
  chain_event_BuyOrderFulfilled: "La blockchain a émis BuyOrderFulfilled pour cet ordre.",
  chain_event_BuyOrderRefunded: "La blockchain a émis BuyOrderRefunded pour cet ordre.",
};

export function explainReason(reason: string, lang: Lang): string | null {
  const d = lang === "fr" ? fr : en;
  return d[reason] ?? null;
}

const ACTORS_EN: Record<string, string> = { "listener:ws": "listener", "listener:backfill": "listener (backfill)", "listener:replay": "replay", reconciler: "reconciler", "api:chaos": "test hook" };
const ACTORS_FR: Record<string, string> = { "listener:ws": "listener", "listener:backfill": "listener (rattrapage)", "listener:replay": "rejeu", reconciler: "réconciliateur", "api:chaos": "outil de test" };

export function explainActor(actor: string, lang: Lang): string {
  const d = lang === "fr" ? ACTORS_FR : ACTORS_EN;
  if (d[actor]) return d[actor]!;
  const m = /^worker:(.+)$/.exec(actor);
  if (m) {
    const id = m[1]!;
    return `worker ${id.length > 10 ? id.slice(0, 6) : id}`;
  }
  return actor;
}
