import * as db from './db.js';
import * as gmail from './gmail.js';
import { Assistent } from './assistant.js';
import { zuhoeren, stoppen, vorlesen, spracheingabeVerfuegbar } from './speech.js';
import { einstellungen, speichereEinstellungen, gespeicherteEinstellungen } from './settings.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPEN = ['Wohnung', 'Haus', 'Grundstück', 'Gewerbe', 'Garage/Stellplatz', 'Sonstiges'];
const STATUS = ['Interessant', 'Angefragt', 'Besichtigung', 'Verhandlung', 'Abgeschlossen', 'Abgesagt'];
const ROLLEN = ['Eigentümer', 'Vermieter', 'Verwalter', 'Makler'];

const zustand = { reiter: 'objekte', auswahl: null, entwurf: null };

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

function adresseText(o) {
  return [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function datum(iso) {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------- Liste links ----------
async function listeZeichnen() {
  const begriff = $('#suche').value.trim();
  const ul = $('#eintraege');
  const daten = (await db.suchen(zustand.reiter, begriff))
    .sort((a, b) => (b.geaendert || '').localeCompare(a.geaendert || ''));
  if (!daten.length) {
    ul.innerHTML = `<li class="leer">${begriff ? 'Nichts gefunden.' : zustand.reiter === 'objekte'
      ? 'Noch keine Objekte. Klick auf „+ Neu“ oder sag: „Lege eine Wohnung in der Musterstraße 5 in Berlin an.“'
      : 'Noch keine Eigentümer.'}</li>`;
    return;
  }
  ul.innerHTML = daten.map((e) => {
    const aktiv = zustand.auswahl?.art === zustand.reiter && zustand.auswahl.id === e.id;
    const titel = zustand.reiter === 'objekte' ? e.bezeichnung || 'Ohne Namen' : e.name || e.firma || 'Ohne Namen';
    const unter = zustand.reiter === 'objekte' ? [e.typ, adresseText(e)].filter(Boolean).join(' · ') : [e.rolle, e.email].filter(Boolean).join(' · ');
    return `<li><button data-id="${esc(e.id)}" aria-current="${aktiv}"><span class="titel">${esc(titel)}</span><span class="unter">${esc(unter)}</span></button></li>`;
  }).join('');
}

function reiterSetzen(name) {
  zustand.reiter = name;
  document.querySelectorAll('.reiter button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.reiter === name)));
  listeZeichnen();
}

// ---------- Detailansicht ----------
function auswahlFeld(name, werte, aktuell) {
  return `<select name="${name}">${werte.map((w) => `<option ${w === aktuell ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>`;
}

async function objektZeigen(id) {
  const o = await db.holen('objekte', id);
  if (!o) return willkommenZeigen();
  zustand.auswahl = { art: 'objekte', id };
  if (zustand.reiter !== 'objekte') reiterSetzen('objekte'); else listeZeichnen();
  const e = o.eigentuemer_id ? await db.holen('eigentuemer', o.eigentuemer_id) : null;
  const alleEig = (await db.alle('eigentuemer')).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const gesendet = (await db.alle('gesendet')).filter((g) => g.objekt_id === id).sort((a, b) => b.datum.localeCompare(a.datum));

  $('#detail').innerHTML = `
    <form class="karte" id="form-objekt">
      <div class="karte-kopf">
        <h2>${esc(o.bezeichnung || 'Objekt')} <span class="marke-status">${esc(o.status || '')}</span></h2>
        <span class="hinweis">zuletzt geändert ${esc(datum(o.geaendert))}</span>
      </div>
      <div class="felder">
        <label class="breit">Bezeichnung <input name="bezeichnung" value="${esc(o.bezeichnung)}" required></label>
        <label>Art ${auswahlFeld('typ', TYPEN, o.typ)}</label>
        <label>Status ${auswahlFeld('status', STATUS, o.status)}</label>
        <label>Straße und Nr. <input name="strasse" value="${esc(o.strasse)}"></label>
        <label>PLZ <input name="plz" value="${esc(o.plz)}" inputmode="numeric"></label>
        <label>Ort <input name="ort" value="${esc(o.ort)}"></label>
        <label>Fläche (m²) <input name="flaeche" type="number" step="any" value="${esc(o.flaeche)}"></label>
        <label>Zimmer <input name="zimmer" type="number" step="0.5" value="${esc(o.zimmer)}"></label>
        <label>Preis (€) <input name="preis" type="number" step="any" value="${esc(o.preis)}"></label>
        <label>Preisart ${auswahlFeld('preisart', ['Kauf', 'Miete'], o.preisart)}</label>
        <label class="breit">Notizen <textarea name="notizen" rows="3">${esc(o.notizen)}</textarea></label>
      </div>
      <div class="knopfreihe">
        <button class="knopf" type="submit">Speichern</button>
        <button class="knopf gefahr" type="button" id="btn-objekt-loeschen">Objekt löschen</button>
      </div>
    </form>

    <section class="karte">
      <div class="karte-kopf"><h2>Eigentümer / Vermieter</h2></div>
      ${e ? `
        <div class="kontakt">
          <span class="name">${esc([e.anrede, e.name].filter(Boolean).join(' '))}${e.firma ? ` · ${esc(e.firma)}` : ''}</span>
          <span class="unter">${esc(e.rolle || '')}${e.email ? ` · <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : ' · keine E-Mail-Adresse'}${e.telefon ? ` · <a href="tel:${esc(e.telefon)}">${esc(e.telefon)}</a>` : ''}</span>
          ${e.adresse ? `<span class="unter">${esc(e.adresse)}</span>` : ''}
        </div>
        <div class="knopfreihe">
          <button class="knopf" type="button" id="btn-mail-neu" ${e.email ? '' : 'disabled'}>E-Mail schreiben</button>
          <button class="knopf leise" type="button" data-eigentuemer="${esc(e.id)}" id="btn-eig-bearbeiten">Bearbeiten</button>
          <button class="knopf leise" type="button" id="btn-eig-loesen">Zuordnung lösen</button>
        </div>` : `
        <p class="hinweis">Diesem Objekt ist noch niemand zugeordnet.</p>
        <div class="knopfreihe">
          ${alleEig.length ? `<select id="sel-eig" style="max-width:260px"><option value="">Bestehenden wählen …</option>${alleEig.map((x) => `<option value="${esc(x.id)}">${esc(x.name || x.firma)}</option>`).join('')}</select>` : ''}
          <button class="knopf" type="button" id="btn-eig-neu">Neu anlegen</button>
        </div>`}
    </section>

    ${e?.email ? `
    <section class="karte">
      <div class="karte-kopf">
        <h2>E-Mail-Verlauf mit ${esc(e.name || e.email)}</h2>
        <button class="knopf leise klein" type="button" id="btn-verlauf">${gmail.istAngemeldet() ? 'Aus Gmail laden' : 'Gmail verbinden und laden'}</button>
      </div>
      <div class="mails" id="verlauf">${gesendet.length ? gesendet.map((g) => mailHtml({ ...g, eingehend: false, von: 'Ich', an: g.an })).join('') : '<p class="hinweis">Noch nichts geladen.</p>'}</div>
    </section>` : ''}
  `;

  $('#form-objekt').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    for (const k of ['flaeche', 'zimmer', 'preis']) f[k] = f[k] === '' ? '' : Number(f[k]);
    await db.speichern('objekte', { ...o, ...f });
    toast('Gespeichert.');
    objektZeigen(id);
  });
  $('#btn-objekt-loeschen').addEventListener('click', async () => {
    if (!confirm(`„${o.bezeichnung}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`)) return;
    await db.loeschen('objekte', id);
    zustand.auswahl = null;
    willkommenZeigen();
    listeZeichnen();
  });
  $('#btn-mail-neu')?.addEventListener('click', () => entwurfZeigen({ objekt_id: id, eigentuemer_id: e.id, an: e.email, betreff: o.bezeichnung, text: '' }));
  $('#btn-eig-bearbeiten')?.addEventListener('click', () => eigentuemerZeigen(e.id, id));
  $('#btn-eig-loesen')?.addEventListener('click', async () => {
    await db.speichern('objekte', { ...o, eigentuemer_id: '' });
    objektZeigen(id);
  });
  $('#sel-eig')?.addEventListener('change', async (ev) => {
    if (!ev.target.value) return;
    await db.speichern('objekte', { ...o, eigentuemer_id: ev.target.value });
    objektZeigen(id);
  });
  $('#btn-eig-neu')?.addEventListener('click', () => eigentuemerZeigen(null, id));
  $('#btn-verlauf')?.addEventListener('click', () => verlaufLaden(e.email, gesendet));
}

function mailHtml(m) {
  return `<details class="mail ${m.eingehend ? 'ein' : 'aus'}">
    <summary><span class="meta">${m.eingehend ? '↘ von ' + esc(m.von) : '↗ an ' + esc(m.an)} · ${esc(datum(m.datum))}</span><span class="betreff">${esc(m.betreff || '(ohne Betreff)')}</span></summary>
    <pre>${esc(m.text)}</pre>
  </details>`;
}

async function verlaufLaden(adresse, gesendetLokal) {
  const box = $('#verlauf');
  try {
    if (!gmail.istAngemeldet()) await gmailVerbinden();
    box.innerHTML = '<p class="hinweis">Lade …</p>';
    const mails = await gmail.verlauf(adresse, 15);
    box.innerHTML = mails.length ? mails.map(mailHtml).join('')
      : `<p class="hinweis">In Gmail kein Verlauf mit ${esc(adresse)} gefunden.</p>${gesendetLokal.map((g) => mailHtml({ ...g, eingehend: false })).join('')}`;
  } catch (err) {
    box.innerHTML = `<p class="hinweis">${esc(err.message)}</p>`;
  }
}

async function eigentuemerZeigen(id, fuerObjektId = null) {
  const e = id ? await db.holen('eigentuemer', id) : { rolle: 'Eigentümer' };
  if (id && !fuerObjektId) {
    zustand.auswahl = { art: 'eigentuemer', id };
    listeZeichnen();
  }
  const objekte = id ? (await db.alle('objekte')).filter((o) => o.eigentuemer_id === id) : [];
  $('#detail').innerHTML = `
    <form class="karte" id="form-eig">
      <div class="karte-kopf"><h2>${id ? esc(e.name || 'Eigentümer') : 'Neuer Eigentümer / Vermieter'}</h2></div>
      <div class="felder">
        <label>Anrede ${auswahlFeld('anrede', ['', 'Frau', 'Herr', 'Firma'], e.anrede || '')}</label>
        <label>Name <input name="name" value="${esc(e.name)}" required></label>
        <label>Rolle ${auswahlFeld('rolle', ROLLEN, e.rolle)}</label>
        <label>Firma <input name="firma" value="${esc(e.firma)}"></label>
        <label>E-Mail <input name="email" type="email" value="${esc(e.email)}"></label>
        <label>Telefon <input name="telefon" type="tel" value="${esc(e.telefon)}"></label>
        <label class="breit">Anschrift <input name="adresse" value="${esc(e.adresse)}"></label>
        <label class="breit">Notizen <textarea name="notizen" rows="3">${esc(e.notizen)}</textarea></label>
      </div>
      <div class="knopfreihe">
        <button class="knopf" type="submit">Speichern</button>
        ${fuerObjektId ? '<button class="knopf leise" type="button" id="btn-zurueck">Zurück zum Objekt</button>' : ''}
        ${id ? '<button class="knopf gefahr" type="button" id="btn-eig-loeschen">Löschen</button>' : ''}
      </div>
    </form>
    ${objekte.length ? `<section class="karte"><div class="karte-kopf"><h2>Objekte</h2></div>
      <ul class="eintraege">${objekte.map((o) => `<li><button data-objekt="${esc(o.id)}"><span class="titel">${esc(o.bezeichnung)}</span><span class="unter">${esc(adresseText(o))}</span></button></li>`).join('')}</ul></section>` : ''}
  `;
  $('#form-eig').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const neu = await db.speichern('eigentuemer', { ...e, ...Object.fromEntries(new FormData(ev.target)) });
    if (fuerObjektId) {
      const o = await db.holen('objekte', fuerObjektId);
      await db.speichern('objekte', { ...o, eigentuemer_id: neu.id });
      objektZeigen(fuerObjektId);
    } else {
      eigentuemerZeigen(neu.id);
    }
    toast('Gespeichert.');
  });
  $('#btn-zurueck')?.addEventListener('click', () => objektZeigen(fuerObjektId));
  $('#btn-eig-loeschen')?.addEventListener('click', async () => {
    if (!confirm(`„${e.name}“ wirklich löschen? Die Zuordnung zu Objekten wird entfernt.`)) return;
    for (const o of await db.alle('objekte')) if (o.eigentuemer_id === id) await db.speichern('objekte', { ...o, eigentuemer_id: '' });
    await db.loeschen('eigentuemer', id);
    zustand.auswahl = null;
    willkommenZeigen();
    listeZeichnen();
  });
  document.querySelectorAll('#detail [data-objekt]').forEach((b) => b.addEventListener('click', () => objektZeigen(b.dataset.objekt)));
}

async function neuesObjekt() {
  const o = await db.speichern('objekte', { bezeichnung: 'Neues Objekt', typ: 'Wohnung', status: 'Interessant' });
  await objektZeigen(o.id);
  $('#form-objekt [name=bezeichnung]').select();
}

function willkommenZeigen() {
  const s = einstellungen();
  $('#detail').innerHTML = `<div class="willkommen">
    <h1>Willkommen</h1>
    <p>Lege links Wohnungen, Häuser und Grundstücke an, ordne ihnen Eigentümer oder Vermieter zu und lass dir vom Assistenten E-Mails schreiben – per Sprache oder Text.</p>
    ${s.geminiKey ? '' : '<p><button class="knopf" id="btn-start-einst" type="button">Zuerst Gemini-Schlüssel eintragen</button></p>'}
  </div>`;
  $('#btn-start-einst')?.addEventListener('click', einstellungenOeffnen);
}

// ---------- E-Mail-Entwurf ----------
function entwurfZeigen(entwurf) {
  zustand.entwurf = entwurf;
  const f = $('#form-entwurf');
  f.an.value = entwurf.an || '';
  f.betreff.value = entwurf.betreff || '';
  f.text.value = entwurf.text || '';
  $('#entwurf-hinweis').textContent = entwurf.threadId ? 'Wird als Antwort im bestehenden Gmail-Verlauf gesendet.' : '';
  $('#btn-senden').textContent = gmail.istAngemeldet() ? `Mit Gmail senden (${gmail.adresse()})` : 'Gmail verbinden und senden';
  $('#btn-senden').disabled = !gmail.istKonfiguriert();
  $('#btn-senden').title = gmail.istKonfiguriert() ? '' : 'Für Gmail bitte die Google-Client-ID in den Einstellungen eintragen.';
  $('#dlg-entwurf').showModal();
}

async function entwurfSenden() {
  const f = $('#form-entwurf');
  if (!f.reportValidity()) return;
  const daten = { ...zustand.entwurf, an: f.an.value.trim(), betreff: f.betreff.value.trim(), text: f.text.value };
  const knopf = $('#btn-senden');
  knopf.disabled = true;
  try {
    if (!gmail.istAngemeldet()) await gmailVerbinden();
    await gmail.senden(daten);
    await db.speichern('gesendet', { objekt_id: daten.objekt_id, eigentuemer_id: daten.eigentuemer_id, an: daten.an, betreff: daten.betreff, text: daten.text, datum: new Date().toISOString() });
    $('#dlg-entwurf').close();
    toast(`E-Mail an ${daten.an} gesendet.`);
    chatNachricht('ki', `E-Mail „${daten.betreff}“ an ${daten.an} wurde gesendet.`);
    if (zustand.auswahl?.art === 'objekte') objektZeigen(zustand.auswahl.id);
  } catch (err) {
    toast(err.message);
  } finally {
    knopf.disabled = false;
  }
}

function entwurfMailto() {
  const f = $('#form-entwurf');
  location.href = `mailto:${encodeURIComponent(f.an.value)}?subject=${encodeURIComponent(f.betreff.value)}&body=${encodeURIComponent(f.text.value)}`;
}

// ---------- Gmail ----------
function gmailKnopf() {
  const b = $('#btn-gmail');
  b.textContent = gmail.istAngemeldet() ? `Gmail: ${gmail.adresse()}` : 'Gmail verbinden';
  b.classList.toggle('verbunden', gmail.istAngemeldet());
}

async function gmailVerbinden() {
  if (!gmail.istKonfiguriert()) {
    einstellungenOeffnen();
    throw new Error('Für Gmail bitte zuerst die Google-Client-ID in den Einstellungen eintragen.');
  }
  await gmail.anmelden();
  gmailKnopf();
  toast('Gmail verbunden.');
}

// ---------- Einstellungen ----------
function einstellungenOeffnen() {
  const f = $('#form-einstellungen');
  const s = einstellungen();
  const g = gespeicherteEinstellungen();
  f.geminiKey.value = g.geminiKey || '';
  f.geminiModell.value = s.geminiModell;
  f.googleClientId.value = g.googleClientId || '';
  f.googleClientId.placeholder = s.googleClientId || '….apps.googleusercontent.com';
  f.absenderName.value = s.absenderName || '';
  f.signatur.value = s.signatur || '';
  f.vorlesen.checked = Boolean(s.vorlesen);
  $('#dlg-einstellungen').showModal();
}

$('#dlg-einstellungen').addEventListener('close', () => {
  if ($('#dlg-einstellungen').returnValue !== 'speichern') return;
  const f = $('#form-einstellungen');
  speichereEinstellungen({
    geminiKey: f.geminiKey.value.trim(), geminiModell: f.geminiModell.value.trim(),
    googleClientId: f.googleClientId.value.trim(), absenderName: f.absenderName.value.trim(),
    signatur: f.signatur.value, vorlesen: f.vorlesen.checked,
  });
  toast('Einstellungen gespeichert.');
  if (!zustand.auswahl) willkommenZeigen();
});

$('#btn-export').addEventListener('click', async () => {
  const daten = await db.exportieren();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(daten, null, 2)], { type: 'application/json' }));
  a.download = `immobilien-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#inp-import').addEventListener('change', async (ev) => {
  const datei = ev.target.files[0];
  if (!datei) return;
  try {
    await db.importieren(JSON.parse(await datei.text()));
    toast('Daten importiert.');
    listeZeichnen();
  } catch (err) {
    toast('Import fehlgeschlagen: ' + err.message);
  }
  ev.target.value = '';
});

// ---------- Assistent ----------
const SCHRITT_TEXTE = {
  objekte_suchen: (a) => `Suche Objekte${a.suchbegriff ? ` „${a.suchbegriff}“` : ''}`,
  objekt_oeffnen: () => 'Öffne Objekt',
  objekt_anlegen: (a) => `Lege „${a.bezeichnung}“ an`,
  objekt_aendern: () => 'Ändere Objekt',
  eigentuemer_suchen: (a) => `Suche Eigentümer${a.suchbegriff ? ` „${a.suchbegriff}“` : ''}`,
  eigentuemer_anlegen: (a) => `Lege Eigentümer „${a.name}“ an`,
  eigentuemer_aendern: () => 'Ändere Eigentümer',
  eigentuemer_zuordnen: () => 'Ordne Eigentümer zu',
  emailverlauf_laden: () => 'Lese bisherigen E-Mail-Verkehr',
  email_entwurf_zeigen: () => 'Schreibe E-Mail-Entwurf',
};

function chatNachricht(art, text) {
  const div = document.createElement('div');
  div.className = 'nachricht ' + art;
  div.textContent = text;
  $('#chat').appendChild(div);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return div;
}

const assistent = new Assistent({
  aktuellesObjektId: () => (zustand.auswahl?.art === 'objekte' ? zustand.auswahl.id : null),
  objektOeffnen: (id) => objektZeigen(id),
  entwurfZeigen,
  neuLaden: () => listeZeichnen(),
  schritt: (name, args) => chatNachricht('schritt', '› ' + (SCHRITT_TEXTE[name]?.(args) || name)),
});

let beschaeftigt = false;
async function anfrage(text) {
  text = text.trim();
  if (!text || beschaeftigt) return;
  beschaeftigt = true;
  chatNachricht('nutzer', text);
  const denkt = chatNachricht('ki denkt', '');
  try {
    const antwort = await assistent.fragen(text);
    denkt.classList.remove('denkt');
    denkt.textContent = antwort;
    if (einstellungen().vorlesen) vorlesen(antwort, einstellungen().sprache);
  } catch (err) {
    denkt.remove();
    chatNachricht('fehler', err.message);
    if (/Gemini-API-Schlüssel/.test(err.message)) einstellungenOeffnen();
  } finally {
    beschaeftigt = false;
    $('#chat').scrollTop = $('#chat').scrollHeight;
  }
}

$('#eingabe').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const feld = $('#eingabe-text');
  const text = feld.value;
  feld.value = '';
  anfrage(text);
});

let hoert = false;
$('#btn-mikro').addEventListener('click', async () => {
  const knopf = $('#btn-mikro');
  if (hoert) { stoppen(); return; }
  speechSynthesis?.cancel();
  hoert = true;
  knopf.classList.add('hoert');
  const feld = $('#eingabe-text');
  try {
    const text = await zuhoeren(einstellungen().sprache, (zw) => { feld.value = zw; });
    feld.value = '';
    if (text) anfrage(text);
  } catch (err) {
    chatNachricht('fehler', err.message);
  } finally {
    hoert = false;
    knopf.classList.remove('hoert');
  }
});
if (!spracheingabeVerfuegbar) $('#btn-mikro').title = 'Spracheingabe wird von diesem Browser nicht unterstützt';

$('#btn-neues-gespraech').addEventListener('click', () => {
  assistent.zuruecksetzen();
  $('#chat').innerHTML = '';
  chatNachricht('system', 'Neues Gespräch gestartet.');
});

// ---------- Allgemeine Ereignisse ----------
document.querySelectorAll('.reiter button').forEach((b) => b.addEventListener('click', () => reiterSetzen(b.dataset.reiter)));
$('#suche').addEventListener('input', listeZeichnen);
$('#eintraege').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-id]');
  if (!b) return;
  if (zustand.reiter === 'objekte') objektZeigen(b.dataset.id); else eigentuemerZeigen(b.dataset.id);
});
$('#btn-neu').addEventListener('click', () => (zustand.reiter === 'objekte' ? neuesObjekt() : eigentuemerZeigen(null)));
$('#btn-einstellungen').addEventListener('click', einstellungenOeffnen);
$('#btn-gmail').addEventListener('click', async () => {
  try {
    if (gmail.istAngemeldet()) { gmail.abmelden(); gmailKnopf(); toast('Gmail getrennt.'); }
    else await gmailVerbinden();
  } catch (err) { toast(err.message); }
});
$('#btn-senden').addEventListener('click', entwurfSenden);
$('#btn-mailto').addEventListener('click', entwurfMailto);

willkommenZeigen();
listeZeichnen();
