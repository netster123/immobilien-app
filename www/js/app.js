import * as db from './db.js';
import * as mail from './mail.js';
import * as rollen from './rollen.js';
import { Assistent } from './assistant.js';
import { zuhoeren, stoppen, vorlesen, verstummen, spracheingabeVerfuegbar } from './speech.js';
import { einstellungen, speichereEinstellungen, gespeicherteEinstellungen } from './settings.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPEN = ['Wohnung', 'Haus', 'Grundstück', 'Gewerbe', 'Garage/Stellplatz', 'Sonstiges'];
const STATUS = ['Interessant', 'Angefragt', 'Besichtigung', 'Verhandlung', 'Abgeschlossen', 'Abgesagt'];

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
      : 'Noch keine Personen.'}</li>`;
    return;
  }
  ul.innerHTML = daten.map((e) => {
    const aktiv = zustand.auswahl?.art === zustand.reiter && zustand.auswahl.id === e.id;
    const titel = zustand.reiter === 'objekte' ? e.bezeichnung || 'Ohne Namen' : rollen.name(e);
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

function personAuswahl(id, personen, ohne = []) {
  const liste = personen.filter((p) => !ohne.includes(p.id));
  return liste.length ? `<select id="${id}" class="person-wahl"><option value="">Bestehende Person wählen …</option>${liste.map((x) => `<option value="${esc(x.id)}">${esc(rollen.name(x))}${x.rolle ? ` (${esc(x.rolle)})` : ''}</option>`).join('')}</select>` : '';
}

function personBlock(p, als, { selbst = false } = {}) {
  return `<div class="kontakt">
      <span class="name">${esc(rollen.name(p))}${p.firma && p.anrede !== 'Firma' ? ` · ${esc(p.firma)}` : ''}</span>
      <span class="unter">${esc(p.rolle || '')}${p.email ? ` · <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ' · keine E-Mail-Adresse'}${p.telefon ? ` · <a href="tel:${esc(p.telefon)}">${esc(p.telefon)}</a>` : ''}</span>
      ${p.adresse ? `<span class="unter">${esc(p.adresse)}</span>` : ''}
    </div>
    <div class="knopfreihe">
      <button class="knopf" type="button" data-mail="${esc(p.id)}" ${p.email ? '' : 'disabled'}>E-Mail schreiben</button>
      ${selbst ? '' : `<button class="knopf leise" type="button" data-bearbeiten="${esc(p.id)}" data-als="${als}">Bearbeiten</button>
      <button class="knopf leise" type="button" data-entfernen="${als}">Entfernen</button>`}
    </div>`;
}

async function objektZeigen(id) {
  const o = await db.holen('objekte', id);
  if (!o) return willkommenZeigen();
  zustand.auswahl = { art: 'objekte', id };
  if (zustand.reiter !== 'objekte') reiterSetzen('objekte'); else listeZeichnen();
  const { eigentuemer: eig, vermieter: verm, vermietetSelbst, hinweis } = await rollen.beteiligte(o);
  const personen = (await db.alle('eigentuemer')).sort((a, b) => rollen.name(a).localeCompare(rollen.name(b)));
  const vorschlag = eig && vermietetSelbst ? await rollen.vermieterVorschlag(eig.id, id) : null;
  const mitMail = [eig, verm].filter((p, i, a) => p?.email && a.findIndex((x) => x?.id === p.id) === i);
  const verlaeufe = await Promise.all(mitMail.map(async (p) => ({ p, mails: await mail.lokalerVerlauf(p.email, 30) })));

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

    <section class="karte rollen">
      <div class="rolle">
        <h3>Eigentümer</h3>
        ${eig ? personBlock(eig, 'Eigentümer') : `
          <p class="hinweis">Noch kein Eigentümer eingetragen.</p>
          <div class="knopfreihe">${personAuswahl('sel-eigentuemer', personen, [o.vermieter_id])}
            <button class="knopf leise" type="button" data-neu="Eigentümer">Neu anlegen</button></div>`}
      </div>
      <div class="rolle">
        <h3>Vermieter</h3>
        ${verm && vermietetSelbst ? `<p class="hinweis">Der Eigentümer vermietet selbst.</p>
          <div class="knopfreihe">${personAuswahl('sel-vermieter', personen, [o.eigentuemer_id])}
            <button class="knopf leise" type="button" data-neu="Vermieter">Anderen Vermieter anlegen</button></div>
          ${vorschlag ? `<p class="hinweis">Bei anderen Objekten dieses Eigentümers vermietet ${esc(rollen.name(vorschlag))}. <button class="knopf leise klein" type="button" id="btn-vorschlag" data-id="${esc(vorschlag.id)}">Übernehmen</button></p>` : ''}`
        : verm ? personBlock(verm, 'Vermieter') : `
          <p class="hinweis">${eig ? '' : 'Noch kein Vermieter eingetragen. Ist der Eigentümer bekannt, vermietet er sonst selbst.'}</p>
          <div class="knopfreihe">${personAuswahl('sel-vermieter', personen, [o.eigentuemer_id])}
            <button class="knopf leise" type="button" data-neu="Vermieter">Neu anlegen</button></div>`}
      </div>
      ${hinweis ? `<p class="hinweis warnung">${esc(hinweis)}</p>` : ''}
    </section>

    ${verlaeufe.map(({ p, mails }) => `
    <section class="karte">
      <div class="karte-kopf">
        <h2>E-Mails mit ${esc(rollen.name(p))} <span class="hinweis">(${esc([p.id === eig?.id ? 'Eigentümer' : '', p.id === verm?.id ? 'Vermieter' : ''].filter(Boolean).join(' und '))})</span></h2>
        ${mail.eingerichtet() ? `<button class="knopf leise klein" type="button" data-verlauf="${esc(p.email)}">Aus Postfach laden</button>` : ''}
      </div>
      <div class="mails" data-verlauf-box="${esc(p.email)}">${mails.length ? mails.map(mailHtml).join('') : `<p class="hinweis">${mail.eingerichtet()
        ? 'Noch keine Mails gespeichert. „Aus Postfach laden“ holt den bisherigen Verkehr.'
        : mail.istApp() ? 'E-Mail-Konto in den Einstellungen einrichten, dann erscheinen die Mails hier automatisch.'
          : 'Den E-Mail-Verlauf gibt es in der Android-App.'}</p>`}</div>
    </section>`).join('')}
  `;

  const neuLaden = async ({ uebernommen }, rolleText) => {
    if (uebernommen) toast(`${rolleText} ${rollen.name(uebernommen)} automatisch übernommen.`);
    await objektZeigen(id);
  };
  $('#form-objekt').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    for (const k of ['flaeche', 'zimmer', 'preis']) f[k] = f[k] === '' ? '' : Number(f[k]);
    await db.speichern('objekte', { ...(await db.holen('objekte', id)), ...f });
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
  $('#sel-eigentuemer')?.addEventListener('change', async (ev) => {
    if (ev.target.value) neuLaden(await rollen.eigentuemerSetzen(o, ev.target.value), 'Vermieter');
  });
  $('#sel-vermieter')?.addEventListener('change', async (ev) => {
    if (ev.target.value) neuLaden(await rollen.vermieterSetzen(o, ev.target.value), 'Eigentümer');
  });
  $('#btn-vorschlag')?.addEventListener('click', async (ev) => neuLaden(await rollen.vermieterSetzen(o, ev.target.dataset.id), 'Eigentümer'));
  document.querySelectorAll('#detail [data-neu]').forEach((b) => b.addEventListener('click', () => personZeigen(null, id, b.dataset.neu)));
  document.querySelectorAll('#detail [data-bearbeiten]').forEach((b) => b.addEventListener('click', () => personZeigen(b.dataset.bearbeiten, id, b.dataset.als)));
  document.querySelectorAll('#detail [data-entfernen]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.entfernen === 'Vermieter') await rollen.vermieterSetzen(o, '');
    else await db.speichern('objekte', { ...o, eigentuemer_id: '' });
    objektZeigen(id);
  }));
  document.querySelectorAll('#detail [data-mail]').forEach((b) => b.addEventListener('click', async () => {
    const p = await db.holen('eigentuemer', b.dataset.mail);
    entwurfZeigen({ objekt_id: id, person_id: p.id, an: p.email, betreff: o.bezeichnung, text: '' });
  }));
  document.querySelectorAll('#detail [data-verlauf]').forEach((b) => b.addEventListener('click', () => verlaufLaden(b)));
  document.querySelectorAll('#detail [data-antworten]').forEach((b) => b.addEventListener('click', async () => {
    const m = await db.holen('mails', b.dataset.antworten);
    const p = mitMail.find((x) => x.email.toLowerCase() === m.adresse);
    entwurfZeigen({ objekt_id: id, person_id: p?.id, an: p?.email || m.adresse, betreff: /^re:/i.test(m.betreff) ? m.betreff : 'Re: ' + m.betreff, text: '', inReplyTo: m.messageId });
  }));
}

function mailHtml(m) {
  return `<details class="mail ${m.eingehend ? 'ein' : 'aus'}">
    <summary><span class="meta">${m.eingehend ? '↘ von ' + esc(m.von) : '↗ an ' + esc(m.an)} · ${esc(datum(m.datum))}</span><span class="betreff">${esc(m.betreff || '(ohne Betreff)')}</span></summary>
    <pre>${esc(m.text)}</pre>
    ${m.eingehend && m.messageId ? `<div class="knopfreihe"><button class="knopf leise klein" type="button" data-antworten="${esc(m.id)}">Antworten</button></div>` : ''}
  </details>`;
}

async function verlaufLaden(knopf) {
  const adresse = knopf.dataset.verlauf;
  knopf.disabled = true;
  knopf.textContent = 'Lade …';
  try {
    await mail.verlauf(adresse, 20);
    if (zustand.auswahl?.art === 'objekte') await objektZeigen(zustand.auswahl.id);
    if (!(await mail.lokalerVerlauf(adresse)).length) toast(`Im Postfach keine Mails mit ${adresse} gefunden.`);
  } catch (err) {
    knopf.closest('.karte').querySelector('.mails').insertAdjacentHTML('afterbegin', `<p class="hinweis">${esc(err.message)}</p>`);
    knopf.disabled = false;
    knopf.textContent = 'Aus Postfach laden';
  }
}

// Person anzeigen/bearbeiten. Mit fuerObjektId wird sie danach dem Objekt als „als“ (Eigentümer/Vermieter) zugeordnet.
async function personZeigen(id, fuerObjektId = null, als = 'Eigentümer') {
  const p = id ? await db.holen('eigentuemer', id) : { rolle: als === 'Vermieter' ? 'Vermieter' : 'Eigentümer' };
  if (id && !fuerObjektId) {
    zustand.auswahl = { art: 'eigentuemer', id };
    listeZeichnen();
  }
  const objekt = fuerObjektId ? await db.holen('objekte', fuerObjektId) : null;
  if (!id && als === 'Vermieter' && objekt?.eigentuemer_id) p.fuer_eigentuemer_id = objekt.eigentuemer_id;
  const eigentuemerListe = (await db.alle('eigentuemer')).filter((x) => x.id !== id && x.rolle === 'Eigentümer')
    .sort((a, b) => rollen.name(a).localeCompare(rollen.name(b)));
  const objekte = id ? (await db.alle('objekte')).filter((o) => o.eigentuemer_id === id || o.vermieter_id === id) : [];
  const vermieterFuer = id ? (await db.alle('eigentuemer')).filter((x) => x.fuer_eigentuemer_id === id) : [];
  $('#detail').innerHTML = `
    <form class="karte" id="form-eig">
      <div class="karte-kopf"><h2>${id ? esc(rollen.name(p)) : `Neuer ${als}`}${objekt ? ` <span class="hinweis">für ${esc(objekt.bezeichnung)}</span>` : ''}</h2></div>
      <div class="felder">
        <label>Anrede ${auswahlFeld('anrede', ['', 'Frau', 'Herr', 'Firma'], p.anrede || '')}</label>
        <label>Name <input name="name" value="${esc(p.name)}" required></label>
        <label>Rolle ${auswahlFeld('rolle', rollen.ROLLEN, p.rolle)}</label>
        <label>Firma <input name="firma" value="${esc(p.firma)}"></label>
        <label>E-Mail <input name="email" type="email" value="${esc(p.email)}"></label>
        <label>Telefon <input name="telefon" type="tel" value="${esc(p.telefon)}"></label>
        <label class="breit" id="feld-fuer" ${p.rolle === 'Eigentümer' ? 'hidden' : ''}>Vermietet für Eigentümer
          <select name="fuer_eigentuemer_id"><option value="">– keinen bestimmten –</option>${eigentuemerListe.map((x) => `<option value="${esc(x.id)}" ${x.id === p.fuer_eigentuemer_id ? 'selected' : ''}>${esc(rollen.name(x))}</option>`).join('')}</select>
        </label>
        <label class="breit">Anschrift <input name="adresse" value="${esc(p.adresse)}"></label>
        <label class="breit">Notizen <textarea name="notizen" rows="3">${esc(p.notizen)}</textarea></label>
      </div>
      <div class="knopfreihe">
        <button class="knopf" type="submit">Speichern</button>
        ${fuerObjektId ? '<button class="knopf leise" type="button" id="btn-zurueck">Zurück zum Objekt</button>' : ''}
        ${id ? '<button class="knopf gefahr" type="button" id="btn-eig-loeschen">Löschen</button>' : ''}
      </div>
    </form>
    ${objekte.length ? `<section class="karte"><div class="karte-kopf"><h2>Objekte</h2></div>
      <ul class="eintraege">${objekte.map((o) => `<li><button data-objekt="${esc(o.id)}"><span class="titel">${esc(o.bezeichnung)}</span><span class="unter">${esc([
        o.eigentuemer_id === id ? 'Eigentümer' : '', o.vermieter_id === id || (o.eigentuemer_id === id && !o.vermieter_id) ? 'Vermieter' : '',
      ].filter(Boolean).join(' und '))} · ${esc(adresseText(o))}</span></button></li>`).join('')}</ul></section>` : ''}
    ${vermieterFuer.length ? `<section class="karte"><div class="karte-kopf"><h2>Vermieter für diesen Eigentümer</h2></div>
      <ul class="eintraege">${vermieterFuer.map((x) => `<li><button data-person="${esc(x.id)}"><span class="titel">${esc(rollen.name(x))}</span><span class="unter">${esc(x.rolle || '')}</span></button></li>`).join('')}</ul></section>` : ''}
  `;
  const form = $('#form-eig');
  form.rolle.addEventListener('change', () => { $('#feld-fuer').hidden = form.rolle.value === 'Eigentümer'; });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const werte = Object.fromEntries(new FormData(ev.target));
    if (werte.rolle === 'Eigentümer') werte.fuer_eigentuemer_id = '';
    const neu = await db.speichern('eigentuemer', { ...p, ...werte });
    mail.kontakteAbgleichen().catch(() => {});
    toast('Gespeichert.');
    if (fuerObjektId) {
      const r = await rollen.zuordnen(await db.holen('objekte', fuerObjektId), neu.id, als);
      if (r.uebernommen) toast(`${als === 'Vermieter' ? 'Eigentümer' : 'Vermieter'} ${rollen.name(r.uebernommen)} automatisch übernommen.`);
      objektZeigen(fuerObjektId);
    } else {
      personZeigen(neu.id);
    }
  });
  $('#btn-zurueck')?.addEventListener('click', () => objektZeigen(fuerObjektId));
  $('#btn-eig-loeschen')?.addEventListener('click', async () => {
    if (!confirm(`„${rollen.name(p)}“ wirklich löschen? Die Zuordnung zu Objekten wird entfernt.`)) return;
    await rollen.personEntfernen(id);
    mail.kontakteAbgleichen().catch(() => {});
    zustand.auswahl = null;
    willkommenZeigen();
    listeZeichnen();
  });
  document.querySelectorAll('#detail [data-objekt]').forEach((b) => b.addEventListener('click', () => objektZeigen(b.dataset.objekt)));
  document.querySelectorAll('#detail [data-person]').forEach((b) => b.addEventListener('click', () => personZeigen(b.dataset.person)));
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
    <p>Lege Wohnungen, Häuser und Grundstücke an, ordne ihnen Eigentümer oder Vermieter zu und lass dir vom Assistenten E-Mails schreiben – per Sprache oder Text.</p>
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
  $('#entwurf-hinweis').textContent = entwurf.inReplyTo ? 'Wird als Antwort auf die letzte Nachricht gesendet.' : '';
  $('#btn-senden').hidden = !mail.eingerichtet();
  $('#btn-senden').textContent = `Senden (${mail.adresse()})`;
  $('#dlg-entwurf').showModal();
}

async function entwurfSenden() {
  const f = $('#form-entwurf');
  if (!f.reportValidity()) return;
  const daten = { ...zustand.entwurf, an: f.an.value.trim(), betreff: f.betreff.value.trim(), text: f.text.value };
  const knopf = $('#btn-senden');
  knopf.disabled = true;
  try {
    await mail.senden(daten);
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

// ---------- Postfach ----------
function postfachKnopf() {
  const b = $('#btn-abrufen');
  b.hidden = !mail.istApp();
  b.textContent = mail.eingerichtet() ? 'Mails abrufen' : 'Postfach einrichten';
}

let ruftAb = false;
async function postfachAbrufen({ jetzt = false, still = false } = {}) {
  if (!mail.eingerichtet() || ruftAb) return;
  ruftAb = true;
  const b = $('#btn-abrufen');
  if (!still) { b.disabled = true; b.textContent = 'Rufe ab …'; }
  try {
    const neu = await mail.eingangUebernehmen({ jetztAbrufen: jetzt });
    if (neu) {
      toast(neu === 1 ? '1 neue E-Mail von einem Eigentümer' : `${neu} neue E-Mails von Eigentümern`);
      if (zustand.auswahl?.art === 'objekte') objektZeigen(zustand.auswahl.id);
    } else if (!still) toast('Keine neuen E-Mails von Eigentümern.');
  } catch (err) {
    if (!still) toast(err.message);
  } finally {
    ruftAb = false;
    b.disabled = false;
    postfachKnopf();
  }
}

// ---------- Einstellungen ----------
function einstellungenOeffnen() {
  const f = $('#form-einstellungen');
  const s = einstellungen();
  const g = gespeicherteEinstellungen();
  f.geminiKey.value = g.geminiKey || '';
  f.geminiModell.value = s.geminiModell;
  f.absenderName.value = s.absenderName || '';
  f.signatur.value = s.signatur || '';
  f.vorlesen.checked = Boolean(s.vorlesen);
  $('#postfach-app').hidden = !mail.istApp();
  $('#postfach-web').hidden = mail.istApp();
  if (mail.istApp()) postfachFormular();
  $('#dlg-einstellungen').showModal();
}

async function postfachFormular() {
  const f = $('#form-einstellungen');
  const k = (await mail.konfiguration()) || {};
  const anbieter = Object.entries(mail.ANBIETER).find(([, v]) => v.imapHost && v.imapHost === k.imapHost)?.[0]
    || (k.imapHost ? 'Andere' : 'GMX');
  f.anbieter.value = anbieter;
  passwortHinweis(anbieter);
  f.mailAdresse.value = k.email || '';
  f.mailPasswort.value = '';
  f.mailPasswort.placeholder = k.hatPasswort ? 'gespeichert – nur zum Ändern eingeben' : '';
  f.imapHost.value = k.imapHost || mail.ANBIETER[anbieter].imapHost;
  f.imapPort.value = k.imapPort || 993;
  f.smtpHost.value = k.smtpHost || mail.ANBIETER[anbieter].smtpHost;
  f.smtpPort.value = k.smtpPort || 587;
  f.intervall.value = String(k.eingerichtet ? k.intervall : 15);
  $('#postfach-status').textContent = k.eingerichtet ? `Eingerichtet: ${k.email}` : 'Noch nicht eingerichtet.';
}

function postfachWerte() {
  const f = $('#form-einstellungen');
  return {
    email: f.mailAdresse.value.trim(), passwort: f.mailPasswort.value,
    imapHost: f.imapHost.value.trim(), imapPort: Number(f.imapPort.value) || 993,
    smtpHost: f.smtpHost.value.trim(), smtpPort: Number(f.smtpPort.value) || 587,
    absenderName: f.absenderName.value.trim(), intervall: Number(f.intervall.value),
  };
}

$('#form-einstellungen').anbieter.addEventListener('change', (ev) => {
  const f = ev.target.form;
  const v = mail.ANBIETER[ev.target.value];
  f.imapHost.value = v.imapHost; f.imapPort.value = v.imapPort;
  f.smtpHost.value = v.smtpHost; f.smtpPort.value = v.smtpPort;
  $('#postfach-server').open = ev.target.value === 'Andere';
  passwortHinweis(ev.target.value);
});

function passwortHinweis(anbieter) {
  $('#passwort-hinweis').textContent = anbieter === 'Gmail'
    ? 'Bei Gmail nicht dein normales Passwort eintragen, sondern ein App-Passwort: myaccount.google.com/apppasswords (dafür muss die Bestätigung in zwei Schritten aktiv sein).'
    : anbieter === 'GMX'
      ? 'Bei GMX im Postfach unter Einstellungen → POP3/IMAP Abruf den IMAP-Zugriff erlauben. Mit Zwei-Faktor-Anmeldung ein App-Passwort verwenden.'
      : 'Viele Anbieter verlangen, dass der IMAP-Zugriff erlaubt ist, und bei Zwei-Faktor-Anmeldung ein App-Passwort.';
}

$('#btn-postfach-testen').addEventListener('click', async () => {
  const status = $('#postfach-status');
  const w = postfachWerte();
  if (!w.email) { status.textContent = 'Bitte E-Mail-Adresse eingeben.'; return; }
  status.textContent = 'Speichere und teste die Verbindung …';
  try {
    await mail.einrichten(w);
    await mail.testen();
    status.textContent = `Verbindung klappt. Abruf ${w.intervall ? `alle ${w.intervall} Minuten` : 'nur von Hand'}.`;
    $('#form-einstellungen').mailPasswort.value = '';
    postfachKnopf();
  } catch (err) {
    status.textContent = 'Fehler: ' + err.message;
  }
});

$('#btn-postfach-entfernen').addEventListener('click', async () => {
  if (!confirm('E-Mail-Konto aus der App entfernen? Gespeicherte Mails bleiben erhalten.')) return;
  await mail.abmelden();
  postfachFormular();
  postfachKnopf();
});

$('#dlg-einstellungen').addEventListener('close', async () => {
  if ($('#dlg-einstellungen').returnValue !== 'speichern') return;
  const f = $('#form-einstellungen');
  speichereEinstellungen({
    geminiKey: f.geminiKey.value.trim(), geminiModell: f.geminiModell.value.trim(),
    absenderName: f.absenderName.value.trim(),
    signatur: f.signatur.value, vorlesen: f.vorlesen.checked,
  });
  toast('Einstellungen gespeichert.');
  if (!zustand.auswahl) willkommenZeigen();
  const w = postfachWerte();
  if (mail.istApp() && w.email) {
    try { await mail.einrichten(w); postfachKnopf(); postfachAbrufen({ jetzt: true, still: true }); }
    catch (err) { toast('E-Mail-Konto: ' + err.message); }
  }
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
    mail.kontakteAbgleichen().catch(() => {});
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
  neuLaden: () => { mail.kontakteAbgleichen().catch(() => {}); return listeZeichnen(); },
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
  verstummen();
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
if (!spracheingabeVerfuegbar()) $('#btn-mikro').title = 'Spracheingabe wird von diesem Browser nicht unterstützt';

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
  if (zustand.reiter === 'objekte') objektZeigen(b.dataset.id); else personZeigen(b.dataset.id);
});
$('#btn-neu').addEventListener('click', () => (zustand.reiter === 'objekte' ? neuesObjekt() : personZeigen(null)));
$('#btn-einstellungen').addEventListener('click', einstellungenOeffnen);
$('#btn-abrufen').addEventListener('click', () => (mail.eingerichtet() ? postfachAbrufen({ jetzt: true }) : einstellungenOeffnen()));
$('#btn-senden').addEventListener('click', entwurfSenden);
$('#btn-mailto').addEventListener('click', entwurfMailto);

willkommenZeigen();
rollen.migrieren().catch(() => {}).then(listeZeichnen);

// Android-App: Postfach-Stand laden und beim Öffnen bzw. Zurückkehren neue Mails übernehmen.
(async () => {
  if (!mail.istApp()) return;
  try { await mail.konfiguration(); } catch { /* noch nicht eingerichtet */ }
  postfachKnopf();
  if (mail.eingerichtet()) {
    await mail.kontakteAbgleichen().catch(() => {});
    postfachAbrufen({ jetzt: true, still: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') postfachAbrufen({ still: true });
  });
})();
