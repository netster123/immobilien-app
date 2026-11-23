// E-Mail über das eigene Postfach (z. B. GMX). Funktioniert nur in der Android-App,
// weil ein Browser selbst kein IMAP/SMTP sprechen kann. Im Browser bleibt „Im Mail-Programm öffnen“.

import * as db from './db.js';

const plugin = () => window.Capacitor?.Plugins?.Mail;

export const ANBIETER = {
  GMX: { imapHost: 'imap.gmx.net', imapPort: 993, smtpHost: 'mail.gmx.net', smtpPort: 587 },
  'WEB.DE': { imapHost: 'imap.web.de', imapPort: 993, smtpHost: 'smtp.web.de', smtpPort: 587 },
  'T-Online': { imapHost: 'secureimap.t-online.de', imapPort: 993, smtpHost: 'securesmtp.t-online.de', smtpPort: 587 },
  Andere: { imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587 },
};

let konfig = null;

export function istApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.() && plugin());
}

export async function konfiguration() {
  if (!istApp()) return null;
  konfig = await plugin().konfiguration();
  return konfig;
}

export function eingerichtet() {
  return Boolean(konfig?.eingerichtet);
}

export function adresse() {
  return konfig?.email || '';
}

export async function einrichten(werte) {
  konfig = await plugin().konfigurieren(werte);
  await kontakteAbgleichen();
  try { await plugin().requestPermissions(); } catch { /* ältere Android-Versionen */ }
  return konfig;
}

export async function testen() {
  await plugin().testen();
}

export async function abmelden() {
  await plugin().abmelden();
  konfig = await plugin().konfiguration();
}

// Teilt dem Hintergrundabruf mit, welche Adressen zu Eigentümern gehören.
export async function kontakteAbgleichen() {
  if (!istApp()) return;
  const kontakte = {};
  for (const e of await db.alle('eigentuemer')) {
    if (e.email) kontakte[e.email.trim().toLowerCase()] = e.name || e.firma || e.email;
  }
  await plugin().kontakteSetzen({ kontakte });
}

// Zitierte ältere Nachrichten abschneiden, damit der Verlauf kurz bleibt.
function kuerzen(text, max = 2500) {
  const zeilen = String(text || '').replace(/\r/g, '').split('\n');
  const ende = zeilen.findIndex((z) => /^(Am .* schrieb|On .* wrote|-----\s*Original|Von: |Gesendet: )/.test(z.trim()) || z.startsWith('>'));
  const kurz = (ende > 0 ? zeilen.slice(0, ende) : zeilen).join('\n').trim();
  return kurz.length > max ? kurz.slice(0, max) + ' …' : kurz;
}

async function merken(mail, extra = {}) {
  const id = mail.messageId || mail.id;
  if (!id || await db.holen('mails', id)) return false;
  await db.speichern('mails', {
    ...mail, ...extra, id, text: kuerzen(mail.text), adresse: String(mail.adresse || '').toLowerCase(),
  });
  return true;
}

// Übernimmt die im Hintergrund abgerufenen Mails in die App. Liefert die Zahl neuer Mails.
export async function eingangUebernehmen({ jetztAbrufen = false } = {}) {
  if (!istApp() || !eingerichtet()) return 0;
  if (jetztAbrufen) await plugin().jetztAbrufen();
  const { mails = [] } = await plugin().abholen();
  let neu = 0;
  for (const m of mails) if (await merken(m)) neu++;
  if (mails.length) await plugin().quittieren({ ids: mails.map((m) => m.id) });
  return neu;
}

// Mails mit einer Adresse aus der App, neueste zuerst.
export async function lokalerVerlauf(emailAdresse, max = 20) {
  const a = String(emailAdresse || '').trim().toLowerCase();
  if (!a) return [];
  return (await db.alle('mails'))
    .filter((m) => m.adresse === a)
    .sort((x, y) => y.datum.localeCompare(x.datum))
    .slice(0, max);
}

// Holt den Verlauf zusätzlich direkt aus dem Postfach (nur App) und speichert ihn.
export async function verlauf(emailAdresse, max = 10) {
  if (istApp() && eingerichtet() && emailAdresse) {
    const { mails = [] } = await plugin().verlauf({ adresse: emailAdresse.trim(), max });
    for (const m of mails) await merken(m);
  }
  return lokalerVerlauf(emailAdresse, max);
}

export async function senden({ an, betreff, text, inReplyTo, objekt_id, eigentuemer_id }) {
  if (!istApp() || !eingerichtet()) throw new Error('Senden geht nur in der Android-App mit eingerichtetem E-Mail-Konto.');
  const { mail } = await plugin().senden({ an, betreff, text, inReplyTo: inReplyTo || '' });
  await merken(mail, { objekt_id, eigentuemer_id });
  return mail;
}
