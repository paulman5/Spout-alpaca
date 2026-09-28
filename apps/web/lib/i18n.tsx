"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "en" | "fr";
export type Theme = "dark" | "light";

const en = {
  "nav.orders": "Orders",
  "nav.chaos": "Chaos lab",
  "nav.lang": "FR",
  "nav.theme.light": "Light",
  "nav.theme.dark": "Dark",
  "cfg.broker": "broker",
  "cfg.offline": "api offline",

  "place.title": "Place an order",
  "place.meta": "real devnet transaction",
  "place.note": "Signs a buy order on Solana devnet with the service keypair, exactly like the pnpm place-order script. The listener sees it within seconds and the workers take it from there. Needs the admin token (Chaos lab, Access card).",
  "place.ticker": "ticker",
  "place.amount": "USDC",
  "place.button": "place order",
  "place.placing": "signing and sending…",
  "place.done": "Order placed on devnet. Watch it move through the states in the table below, then open it.",
  "place.tx": "transaction",
  "place.open": "open the order",
  "repair.replay.pick": "or pick a recent order",
  "repair.replay.pickPlaceholder": "recent orders",
  "repair.replay.copy": "copy",
  "repair.replay.copied": "copied",
  "order.replay": "replay this event",
  "order.replay.done": "Replayed. Nothing changed: the duplicate was ignored (see the new ledger line).",
  "order.copy": "copy signature",
  "order.copied": "signature copied",
  "dash.index": "Orders · live",
  "dash.h1a": "Every order,",
  "dash.h1b": "accounted for.",
  "dash.lede": "A devnet BuyOrderCreated becomes one broker trade and one on-chain settlement. Never two. The ledger below is the proof, reconstructed from Postgres.",
  "dash.live": "stream live",
  "dash.connecting": "connecting",
  "stat.orders": "Orders",
  "stat.inflight": "In flight",
  "stat.inflight.on": "being worked",
  "stat.inflight.off": "queue empty",
  "stat.settled": "Settled",
  "stat.refunded": "Refunded",
  "stat.human": "Needs human",
  "stat.human.on": "dead-lettered",
  "stat.human.off": "nothing to escalate",
  "alerts.title": "alert(s) · a human must look",
  "panel.orders": "Orders",
  "panel.orders.meta": "newest first",
  "panel.ledger": "Ledger",
  "panel.ledger.meta": "order_events · latest 30",
  "table.order": "Order",
  "table.ticker": "Ticker",
  "table.usdc": "USDC",
  "table.status": "Status",
  "table.broker": "Broker",
  "table.settlement": "Settlement",
  "table.retries": "Retries",
  "table.updated": "Updated",
  "table.empty": "No orders yet. Place one on devnet with",
  "feed.waiting": "Waiting for events…",

  "order.back": "Orders · back",
  "order.title": "Order",
  "order.refresh": "refresh",
  "order.record": "Record",
  "order.ledger": "Ledger",
  "order.lines": "lines · order_events",

  "chaos.index": "Chaos lab",
  "chaos.h1a": "Break it",
  "chaos.h1b": "on purpose.",
  "chaos.lede": "This page lets you cause the failures a real system meets, and watch how the pipeline reacts. Every button explains what it does and what to look at afterwards, on the Orders page and in each order's ledger. Nothing here touches real money: the broker is a simulator unless the header says broker · alpaca.",
  "chaos.watch": "watch",
  "chaos.duration": "duration",
  "chaos.duration.note": "seconds the failure lasts (for http 500, slow and flaky)",
  "chaos.mode": "mode",
  "chaos.left": "left",

  "access.title": "Access",
  "access.stored": "token stored",
  "access.none": "no token",
  "access.note": "The hosted API is public, so every button that changes something asks for an admin token. Paste it once; this browser remembers it. Without it you get a 401 and nothing happens, which is the intended protection.",
  "access.placeholder": "admin token",
  "access.save": "save",
  "access.saved": "Admin token saved in this browser.",
  "access.removed": "Admin token removed.",

  "sim.title": "Broker simulator",
  "sim.note": "The simulator plays the role of the brokerage. These buttons make it misbehave. Place an order afterwards (pnpm place-order AAPL 25) and open it on the Orders page.",
  "sim.500.title": "Broker down (HTTP 500)",
  "sim.500.what": "Every call to the broker fails with a server error for the chosen duration, like an outage on their side.",
  "sim.500.watch": "The order stays in broker_placing and the ledger shows retry_scheduled lines whose delay doubles each time. When the outage ends, the order completes. No refund.",
  "sim.slow.title": "Broker slow (2 to 10 s)",
  "sim.slow.what": "The broker answers, but only after a random delay between two and ten seconds, like a congested API.",
  "sim.slow.watch": "Steps take longer but nothing fails; a call that exceeds the client timeout is retried like a transient failure.",
  "sim.flaky.title": "Broker flaky (50% errors)",
  "sim.flaky.what": "One call in two fails at random. The randomness comes from a seed, so the same run can be replayed exactly.",
  "sim.flaky.watch": "A mix of retry_scheduled lines and successful steps; every order still ends settled.",
  "sim.closed.title": "Market closed",
  "sim.closed.what": "The broker refuses new orders for good, the way a real exchange does outside trading hours.",
  "sim.closed.watch": "No retry: the ledger shows broker_rejected with code market_closed, then refund_confirmed. The order ends refunded and the user gets their USDC back on-chain.",
  "sim.clear.title": "Back to normal",
  "sim.clear.what": "Removes every injected failure. Do this after each experiment, otherwise the failure stays active.",
  "sim.clear.watch": "The mode above returns to none.",

  "workers.title": "Workers",
  "workers.note": "The workers are the processes that place trades and settle orders. This is the kill switch an operator uses during an incident.",
  "workers.paused": "paused",
  "workers.running": "running",
  "workers.pause.title": "Pause",
  "workers.pause.what": "Workers stop picking up new orders. Whatever step is running finishes cleanly; nothing new starts. The circuit breaker uses the same switch when too many critical alerts happen.",
  "workers.pause.watch": "New orders stay recorded and wait. The card header turns to paused.",
  "workers.resume.title": "Resume",
  "workers.resume.what": "Workers start again and drain everything that waited.",
  "workers.resume.watch": "Waiting orders move through the states within seconds.",

  "repair.title": "Repair and replay",
  "repair.meta": "on demand",
  "repair.reconcile.title": "Reconcile now",
  "repair.reconcile.what": "Compares three sources of truth, the broker, the database and the blockchain, and repairs any difference: a fill the poller missed, an order the chain already closed.",
  "repair.reconcile.watch": "The report below lists what was repaired; each repair also appears in the order's ledger with a reconciled_ reason.",
  "repair.replay.title": "Replay an event",
  "repair.replay.what": "Feeds a blockchain transaction to the pipeline again, as if the network had delivered it twice. Paste the signature of an order's created transaction.",
  "repair.replay.watch": "newOrders stays 0 and the order's ledger gains a duplicate_event_ignored line. Nothing is traded or settled twice.",
  "repair.replay.placeholder": "transaction signature or explorer link",

  "scen.title": "Scripted scenarios A to G",
  "scen.meta": "run from the repo root",
  "scen.note": "Each script places a real devnet order, causes one failure, and checks the outcome automatically in the database, the simulator and the chain.",
  "scen.A.title": "Idempotent replay",
  "scen.A.plain": "The same blockchain event is fed to the system three times. Nothing happens twice: one broker order, one settlement.",
  "scen.B.title": "Crash after broker-accept",
  "scen.B.plain": "A worker is killed right after the broker said yes, before the database was updated. On restart the trade is found again, not repeated.",
  "scen.C.title": "Broker outage",
  "scen.C.plain": "The broker answers errors for 30 seconds. The worker waits longer and longer between attempts, then completes. No refund.",
  "scen.D.title": "Lost confirmation",
  "scen.D.plain": "The settlement transaction lands but its confirmation is lost. The retry sees the chain already closed the order (error 3012) and records it as settled.",
  "scen.E.title": "Market closed",
  "scen.E.plain": "The broker refuses the order for good. No retries: the user is refunded on-chain.",
  "scen.F.title": "Reconciliation",
  "scen.F.plain": "The database is made wrong on purpose. The reconciler compares broker, database and chain and repairs it.",
  "scen.G.title": "Real Alpaca sandbox",
  "scen.G.plain": "One real order: devnet event, real sandbox trade, settlement back on devnet. Needs US market hours.",
  "last.title": "Last response",
  "last.meta": "what the API answered",
  "last.running": "running",
};

const fr: typeof en = {
  "nav.orders": "Ordres",
  "nav.chaos": "Labo chaos",
  "nav.lang": "EN",
  "nav.theme.light": "Clair",
  "nav.theme.dark": "Sombre",
  "cfg.broker": "courtier",
  "cfg.offline": "api hors ligne",

  "place.title": "Passer un ordre",
  "place.meta": "vraie transaction devnet",
  "place.note": "Signe un ordre d'achat sur Solana devnet avec la clé du service, exactement comme le script pnpm place-order. Le listener le voit en quelques secondes et les workers prennent le relais. Nécessite le jeton administrateur (Labo chaos, carte Accès).",
  "place.ticker": "titre",
  "place.amount": "USDC",
  "place.button": "passer l'ordre",
  "place.placing": "signature et envoi…",
  "place.done": "Ordre placé sur devnet. Regarde-le traverser les états dans le tableau ci-dessous, puis ouvre-le.",
  "place.tx": "transaction",
  "place.open": "ouvrir l'ordre",
  "repair.replay.pick": "ou choisis un ordre récent",
  "repair.replay.pickPlaceholder": "ordres récents",
  "repair.replay.copy": "copier",
  "repair.replay.copied": "copié",
  "order.replay": "rejouer cet événement",
  "order.replay.done": "Rejoué. Rien n'a changé : le doublon a été ignoré (voir la nouvelle ligne du ledger).",
  "order.copy": "copier la signature",
  "order.copied": "signature copiée",
  "dash.index": "Ordres · en direct",
  "dash.h1a": "Chaque ordre,",
  "dash.h1b": "tracé jusqu'au bout.",
  "dash.lede": "Un BuyOrderCreated sur devnet devient un seul trade chez le courtier et un seul règlement on-chain. Jamais deux. Le ledger ci-dessous en est la preuve, reconstruite depuis Postgres.",
  "dash.live": "flux en direct",
  "dash.connecting": "connexion",
  "stat.orders": "Ordres",
  "stat.inflight": "En cours",
  "stat.inflight.on": "en traitement",
  "stat.inflight.off": "file vide",
  "stat.settled": "Réglés",
  "stat.refunded": "Remboursés",
  "stat.human": "Intervention humaine",
  "stat.human.on": "à traiter",
  "stat.human.off": "rien à escalader",
  "alerts.title": "alerte(s) · un humain doit regarder",
  "panel.orders": "Ordres",
  "panel.orders.meta": "plus récents d'abord",
  "panel.ledger": "Ledger",
  "panel.ledger.meta": "order_events · 30 derniers",
  "table.order": "Ordre",
  "table.ticker": "Titre",
  "table.usdc": "USDC",
  "table.status": "Statut",
  "table.broker": "Courtier",
  "table.settlement": "Règlement",
  "table.retries": "Essais",
  "table.updated": "Mis à jour",
  "table.empty": "Aucun ordre pour l'instant. Placez-en un sur devnet avec",
  "feed.waiting": "En attente d'événements…",

  "order.back": "Ordres · retour",
  "order.title": "Ordre",
  "order.refresh": "rafraîchir",
  "order.record": "Fiche",
  "order.ledger": "Ledger",
  "order.lines": "lignes · order_events",

  "chaos.index": "Labo chaos",
  "chaos.h1a": "Casser,",
  "chaos.h1b": "exprès.",
  "chaos.lede": "Cette page provoque les pannes qu'un vrai système rencontre, pour observer comment le pipeline réagit. Chaque bouton explique ce qu'il fait et quoi regarder ensuite, sur la page Ordres et dans le ledger de chaque ordre. Rien ici ne touche de l'argent réel : le courtier est un simulateur tant que l'en-tête n'affiche pas courtier · alpaca.",
  "chaos.watch": "à observer",
  "chaos.duration": "durée",
  "chaos.duration.note": "secondes pendant lesquelles la panne dure (pour http 500, lent et instable)",
  "chaos.mode": "mode",
  "chaos.left": "restantes",

  "access.title": "Accès",
  "access.stored": "jeton enregistré",
  "access.none": "aucun jeton",
  "access.note": "L'API hébergée est publique, donc chaque bouton qui modifie quelque chose demande un jeton administrateur. Collez-le une fois ; ce navigateur s'en souvient. Sans lui, la réponse est 401 et rien ne se passe : c'est la protection voulue.",
  "access.placeholder": "jeton administrateur",
  "access.save": "enregistrer",
  "access.saved": "Jeton enregistré dans ce navigateur.",
  "access.removed": "Jeton supprimé.",

  "sim.title": "Simulateur de courtier",
  "sim.note": "Le simulateur joue le rôle du courtier. Ces boutons le font dysfonctionner. Placez ensuite un ordre (pnpm place-order AAPL 25) et ouvrez-le sur la page Ordres.",
  "sim.500.title": "Courtier en panne (HTTP 500)",
  "sim.500.what": "Chaque appel au courtier échoue avec une erreur serveur pendant la durée choisie, comme une panne de leur côté.",
  "sim.500.watch": "L'ordre reste en broker_placing et le ledger montre des lignes retry_scheduled dont le délai double à chaque fois. Quand la panne cesse, l'ordre se termine. Pas de remboursement.",
  "sim.slow.title": "Courtier lent (2 à 10 s)",
  "sim.slow.what": "Le courtier répond, mais après un délai aléatoire de deux à dix secondes, comme une API saturée.",
  "sim.slow.watch": "Les étapes durent plus longtemps mais rien n'échoue ; un appel qui dépasse le délai client est réessayé comme une panne passagère.",
  "sim.flaky.title": "Courtier instable (50 % d'erreurs)",
  "sim.flaky.what": "Un appel sur deux échoue au hasard. Le hasard vient d'une graine, donc la même séquence peut être rejouée à l'identique.",
  "sim.flaky.watch": "Un mélange de lignes retry_scheduled et d'étapes réussies ; chaque ordre finit quand même réglé.",
  "sim.closed.title": "Marché fermé",
  "sim.closed.what": "Le courtier refuse définitivement les nouveaux ordres, comme une vraie bourse hors des heures d'ouverture.",
  "sim.closed.watch": "Aucun réessai : le ledger montre broker_rejected avec le code market_closed, puis refund_confirmed. L'ordre finit remboursé et l'utilisateur récupère ses USDC on-chain.",
  "sim.clear.title": "Retour à la normale",
  "sim.clear.what": "Retire toutes les pannes injectées. À faire après chaque expérience, sinon la panne reste active.",
  "sim.clear.watch": "Le mode ci-dessus revient à none.",

  "workers.title": "Workers",
  "workers.note": "Les workers sont les processus qui passent les trades et règlent les ordres. C'est l'interrupteur d'urgence qu'un opérateur utilise pendant un incident.",
  "workers.paused": "en pause",
  "workers.running": "en marche",
  "workers.pause.title": "Pause",
  "workers.pause.what": "Les workers cessent de prendre de nouveaux ordres. L'étape en cours se termine proprement ; rien de nouveau ne démarre. Le disjoncteur utilise le même interrupteur quand trop d'alertes critiques surviennent.",
  "workers.pause.watch": "Les nouveaux ordres restent en recorded et attendent. L'en-tête de la carte passe à en pause.",
  "workers.resume.title": "Reprise",
  "workers.resume.what": "Les workers redémarrent et traitent tout ce qui attendait.",
  "workers.resume.watch": "Les ordres en attente traversent les états en quelques secondes.",

  "repair.title": "Réparer et rejouer",
  "repair.meta": "à la demande",
  "repair.reconcile.title": "Réconcilier maintenant",
  "repair.reconcile.what": "Compare trois sources de vérité, le courtier, la base de données et la blockchain, et répare tout écart : un remplissage raté par le poller, un ordre déjà clos par la chaîne.",
  "repair.reconcile.watch": "Le rapport ci-dessous liste ce qui a été réparé ; chaque réparation apparaît aussi dans le ledger de l'ordre avec une raison reconciled_.",
  "repair.replay.title": "Rejouer un événement",
  "repair.replay.what": "Renvoie une transaction blockchain au pipeline, comme si le réseau l'avait livrée deux fois. Collez la signature de la transaction de création d'un ordre.",
  "repair.replay.watch": "newOrders reste à 0 et le ledger de l'ordre gagne une ligne duplicate_event_ignored. Rien n'est tradé ni réglé deux fois.",
  "repair.replay.placeholder": "signature de transaction ou lien explorer",

  "scen.title": "Scénarios scriptés A à G",
  "scen.meta": "à lancer depuis la racine du repo",
  "scen.note": "Chaque script place un vrai ordre devnet, provoque une panne, et vérifie automatiquement le résultat dans la base, le simulateur et la chaîne.",
  "scen.A.title": "Rejeu idempotent",
  "scen.A.plain": "Le même événement blockchain est envoyé trois fois au système. Rien ne se produit deux fois : un ordre courtier, un règlement.",
  "scen.B.title": "Crash après acceptation",
  "scen.B.plain": "Un worker est tué juste après le oui du courtier, avant la mise à jour de la base. Au redémarrage, le trade est retrouvé, pas répété.",
  "scen.C.title": "Panne du courtier",
  "scen.C.plain": "Le courtier répond des erreurs pendant 30 secondes. Le worker attend de plus en plus longtemps entre les essais, puis termine. Pas de remboursement.",
  "scen.D.title": "Confirmation perdue",
  "scen.D.plain": "La transaction de règlement passe mais sa confirmation est perdue. Le réessai voit que la chaîne a déjà clos l'ordre (erreur 3012) et l'enregistre comme réglé.",
  "scen.E.title": "Marché fermé",
  "scen.E.plain": "Le courtier refuse l'ordre définitivement. Aucun réessai : l'utilisateur est remboursé on-chain.",
  "scen.F.title": "Réconciliation",
  "scen.F.plain": "La base est faussée exprès. Le réconciliateur compare courtier, base et chaîne, et répare.",
  "scen.G.title": "Vrai sandbox Alpaca",
  "scen.G.plain": "Un ordre réel : événement devnet, vrai trade sandbox, règlement de retour sur devnet. Nécessite les heures de marché US.",
  "last.title": "Dernière réponse",
  "last.meta": "ce que l'API a répondu",
  "last.running": "en cours",
};

export type Key = keyof typeof en;
const dicts: Record<Lang, typeof en> = { en, fr };

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  t: (k: Key) => string;
}

const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => undefined, theme: "dark", setTheme: () => undefined, t: (k) => en[k] });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    try {
      // ?lang=fr&theme=light in the URL wins once, then the choice is remembered in this browser.
      const q = new URLSearchParams(window.location.search);
      const ql = q.get("lang");
      const qt = q.get("theme");
      if (ql === "fr" || ql === "en") window.localStorage.setItem("spout.lang", ql);
      if (qt === "light" || qt === "dark") window.localStorage.setItem("spout.theme", qt);
      const l = window.localStorage.getItem("spout.lang") as Lang | null;
      const th = window.localStorage.getItem("spout.theme") as Theme | null;
      if (l === "fr" || l === "en") setLangState(l);
      if (th === "light" || th === "dark") setThemeState(th);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem("spout.lang", l);
    } catch {
      /* ignore */
    }
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem("spout.theme", t);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<Ctx>(() => ({ lang, setLang, theme, setTheme, t: (k) => dicts[lang][k] ?? en[k] }), [lang, theme, setLang, setTheme]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
