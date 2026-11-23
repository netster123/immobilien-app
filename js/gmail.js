// Gmail-Anbindung über die Google-Anmeldung (OAuth) direkt im Browser.
// Der Zugriffsschlüssel liegt nur im Arbeitsspeicher und läuft nach ca. 1 Stunde ab.

import { einstellungen } from './settings.js';

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

let token = null;
let tokenAblauf = 0;
let tokenClient = null;
let eigeneAdresse = null;

function gisLaden() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Google-Anmeldung konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

export function istKonfiguriert() {
  return Boolean(einstellungen().googleClientId);
}

export function istAngemeldet() {
  return Boolean(token && Date.now() < tokenAblauf);
}

export function adresse() {
  return eigeneAdresse;
}

export async function anmelden() {
  const clientId = einstellungen().googleClientId;
  if (!clientId) throw new Error('Für Gmail fehlt die Google-Client-ID (Einstellungen).');
  await gisLaden();
  await new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (antwort) => {
        if (antwort.error) return reject(new Error('Google-Anmeldung fehlgeschlagen: ' + antwort.error));
        token = antwort.access_token;
        tokenAblauf = Date.now() + (Number(antwort.expires_in) - 60) * 1000;
        resolve();
      },
      error_callback: (f) => reject(new Error('Google-Anmeldung abgebrochen: ' + (f?.message || f?.type || ''))),
    });
    tokenClient.requestAccessToken();
  });
  const profil = await api('/profile');
  eigeneAdresse = profil.emailAddress;
  return eigeneAdresse;
}

export function abmelden() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenAblauf = 0;
  eigeneAdresse = null;
}

async function api(pfad, optionen = {}) {
  if (!istAngemeldet()) throw new Error('Nicht bei Gmail angemeldet. Bitte oben auf „Gmail verbinden“ klicken.');
  const r = await fetch(API + pfad, {
    ...optionen,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(optionen.headers || {}) },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gmail-Fehler ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

function b64urlDecode(daten) {
  const b64 = daten.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function header(nachricht, name) {
  return (nachricht.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function textAusTeil(teil) {
  if (!teil) return '';
  if (teil.mimeType === 'text/plain' && teil.body?.data) return b64urlDecode(teil.body.data);
  for (const t of teil.parts || []) {
    const x = textAusTeil(t);
    if (x) return x;
  }
  if (teil.mimeType === 'text/html' && teil.body?.data) {
    const doc = new DOMParser().parseFromString(b64urlDecode(teil.body.data), 'text/html');
    return doc.body.textContent || '';
  }
  return '';
}

// Zitierte ältere Nachrichten abschneiden, damit der Verlauf kurz bleibt.
function kuerzen(text, max = 2500) {
  const zeilen = text.replace(/\r/g, '').split('\n');
  const ende = zeilen.findIndex((z) => /^(Am .* schrieb|On .* wrote|-----Original|Von: )/.test(z.trim()) || z.startsWith('>'));
  const kurz = (ende > 0 ? zeilen.slice(0, ende) : zeilen).join('\n').trim();
  return kurz.length > max ? kurz.slice(0, max) + ' …' : kurz;
}

// Lädt den E-Mail-Verlauf mit einer Adresse (eingehend und ausgehend), neueste zuerst.
export async function verlauf(emailAdresse, max = 10) {
  if (!emailAdresse) return [];
  const q = encodeURIComponent(`from:${emailAdresse} OR to:${emailAdresse} OR cc:${emailAdresse}`);
  const liste = await api(`/messages?q=${q}&maxResults=${max}`);
  const nachrichten = await Promise.all((liste.messages || []).map((m) => api(`/messages/${m.id}?format=full`)));
  return nachrichten.map((n) => ({
    id: n.id,
    threadId: n.threadId,
    messageId: header(n, 'Message-ID'),
    datum: new Date(Number(n.internalDate)).toISOString(),
    von: header(n, 'From'),
    an: header(n, 'To'),
    betreff: header(n, 'Subject'),
    text: kuerzen(textAusTeil(n.payload)),
    eingehend: !(n.labelIds || []).includes('SENT'),
  }));
}

function mimeWort(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(text))) + '?=';
}

export async function senden({ an, betreff, text, threadId, inReplyTo }) {
  const kopf = [
    `To: ${an}`,
    `Subject: ${mimeWort(betreff)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (inReplyTo) kopf.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  const roh = kopf.join('\r\n') + '\r\n\r\n' + text.replace(/\r?\n/g, '\r\n');
  const body = { raw: b64urlEncode(roh) };
  if (threadId) body.threadId = threadId;
  return api('/messages/send', { method: 'POST', body: JSON.stringify(body) });
}
