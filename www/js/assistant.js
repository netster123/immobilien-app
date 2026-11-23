// Sprachassistent: versteht Befehle wie „Suche Objekt A raus und schreibe eine E-Mail“
// und führt sie über Werkzeuge (Funktionen) aus. E-Mails werden nur als Entwurf vorbereitet –
// gesendet wird erst, wenn der Nutzer auf „Senden“ klickt.

import * as db from './db.js';
import * as mail from './mail.js';
import * as rollen from './rollen.js';
import { einstellungen } from './settings.js';

const OBJEKT_FELDER = {
  bezeichnung: { type: 'string', description: 'Kurzer Name, z. B. „Wohnung Musterstraße 5, 2. OG“' },
  typ: { type: 'string', enum: ['Wohnung', 'Haus', 'Grundstück', 'Gewerbe', 'Garage/Stellplatz', 'Sonstiges'] },
  strasse: { type: 'string' }, plz: { type: 'string' }, ort: { type: 'string' },
  flaeche: { type: 'number', description: 'Wohn- bzw. Grundstücksfläche in m²' },
  zimmer: { type: 'number' },
  preis: { type: 'number', description: 'Kaufpreis oder Miete in Euro' },
  preisart: { type: 'string', enum: ['Kauf', 'Miete'] },
  status: { type: 'string', enum: ['Interessant', 'Angefragt', 'Besichtigung', 'Verhandlung', 'Abgeschlossen', 'Abgesagt'] },
  notizen: { type: 'string' },
};

const PERSON_FELDER = {
  name: { type: 'string', description: 'Vor- und Nachname bzw. Firmenname' },
  rolle: { type: 'string', enum: rollen.ROLLEN },
  anrede: { type: 'string', enum: ['Herr', 'Frau', 'Firma'] },
  firma: { type: 'string' }, email: { type: 'string' }, telefon: { type: 'string' },
  adresse: { type: 'string' }, notizen: { type: 'string' },
  fuer_eigentuemer_id: { type: 'string', description: 'Nur bei Vermietern/Hausverwaltungen: ID des Eigentümers, für den sie vermieten' },
};
const ALS = { type: 'string', enum: ['Eigentümer', 'Vermieter'], description: 'In welcher Rolle die Person dem Objekt zugeordnet wird' };

const WERKZEUGE = [
  { name: 'objekte_suchen', description: 'Sucht Wohnobjekte nach Name, Adresse, Ort, Typ oder Notizen. Leerer Suchbegriff liefert alle.',
    parameters: { type: 'object', properties: { suchbegriff: { type: 'string' } } } },
  { name: 'objekt_oeffnen', description: 'Zeigt ein Objekt in der App an (macht es zum aktuellen Objekt) und liefert Eigentümer und Vermieter.',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' } }, required: ['objekt_id'] } },
  { name: 'objekt_anlegen', description: 'Legt ein neues Wohnobjekt an und öffnet es.',
    parameters: { type: 'object', properties: OBJEKT_FELDER, required: ['bezeichnung', 'typ'] } },
  { name: 'objekt_aendern', description: 'Ändert Felder eines Objekts. Nur die genannten Felder werden überschrieben.',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' }, ...OBJEKT_FELDER }, required: ['objekt_id'] } },
  { name: 'personen_suchen', description: 'Sucht Eigentümer, Vermieter, Hausverwaltungen und Makler nach Name, Firma, E-Mail usw.',
    parameters: { type: 'object', properties: { suchbegriff: { type: 'string' } } } },
  { name: 'person_anlegen', description: 'Legt eine Person an. Mit objekt_id und als wird sie dem Objekt gleich als Eigentümer oder Vermieter zugeordnet. Vorher mit personen_suchen prüfen, ob es sie schon gibt.',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' }, als: ALS, ...PERSON_FELDER }, required: ['name'] } },
  { name: 'person_aendern', description: 'Ändert Felder einer Person.',
    parameters: { type: 'object', properties: { person_id: { type: 'string' }, ...PERSON_FELDER }, required: ['person_id'] } },
  { name: 'person_zuordnen', description: 'Ordnet einem Objekt eine bestehende Person als Eigentümer oder als Vermieter zu. Als Vermieter mit leerer person_id: Eigentümer vermietet selbst.',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' }, person_id: { type: 'string' }, als: ALS }, required: ['objekt_id', 'als'] } },
  { name: 'emailverlauf_laden', description: 'Lädt den bisherigen E-Mail-Verkehr mit einer Person (neueste zuerst). Vor dem Schreiben einer E-Mail immer aufrufen.',
    parameters: { type: 'object', properties: { person_id: { type: 'string' }, anzahl: { type: 'number' } }, required: ['person_id'] } },
  { name: 'email_entwurf_zeigen', description: 'Zeigt dem Nutzer einen fertigen E-Mail-Entwurf an eine Person (Eigentümer oder Vermieter). Der Nutzer prüft und sendet selbst. Für eine Antwort auf eine bestehende Mail deren messageId als message_id angeben und den Betreff mit „Re: “ übernehmen.',
    parameters: { type: 'object', properties: {
      objekt_id: { type: 'string' }, person_id: { type: 'string' },
      betreff: { type: 'string' }, text: { type: 'string', description: 'Vollständiger Text mit Anrede und Grußformel' },
      message_id: { type: 'string' },
    }, required: ['person_id', 'betreff', 'text'] } },
];

function kurzPerson(p) {
  if (!p) return null;
  const { id, name, anrede, rolle, firma, email, telefon, fuer_eigentuemer_id } = p;
  return { id, name, anrede, rolle, firma, email, telefon, fuer_eigentuemer_id };
}

async function objektMitRollen(o) {
  const b = await rollen.beteiligte(o);
  return {
    ...o,
    eigentuemer: kurzPerson(b.eigentuemer),
    vermieter: kurzPerson(b.vermieter),
    vermietet_selbst: b.vermietetSelbst,
    ...(b.hinweis ? { hinweis: b.hinweis } : {}),
  };
}

function kurzObjekt(o) {
  const { id, bezeichnung, typ, strasse, plz, ort, status, eigentuemer_id, vermieter_id } = o;
  return { id, bezeichnung, typ, adresse: [strasse, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(', '), status, eigentuemer_id, vermieter_id };
}

export class Assistent {
  constructor(ui) {
    this.ui = ui; // { aktuellesObjektId(), objektOeffnen(id), entwurfZeigen(e), neuLaden(), schritt(text) }
    this.verlauf = [];
  }

  zuruecksetzen() { this.verlauf = []; }

  async systemText() {
    const s = einstellungen();
    const id = this.ui.aktuellesObjektId();
    let aktuell = 'Zurzeit ist kein Objekt geöffnet.';
    if (id) {
      const o = await db.holen('objekte', id);
      if (o) aktuell = `Aktuell geöffnetes Objekt mit Eigentümer und Vermieter: ${JSON.stringify(await objektMitRollen(o))}`;
    }
    return `Du bist der Assistent einer Immobilien-App. Der Nutzer verwaltet Wohnobjekte (Wohnungen, Häuser, Grundstücke …) und schreibt deren Eigentümern und Vermietern E-Mails.
Der Nutzer spricht meist per Spracheingabe – Tippfehler und ungenaue Namen sind normal, suche dann großzügig.
Eigentümer und Vermieter:
- Jedes Objekt hat einen Eigentümer und einen Vermieter. Ist kein eigener Vermieter eingetragen, vermietet der Eigentümer selbst und ist damit auch der Vermieter (vermietet_selbst).
- Ein eigener Vermieter (z. B. Hausverwaltung) gehört zu einem Eigentümer (fuer_eigentuemer_id). Die App übernimmt bekannte Zuordnungen automatisch.
- „Schreib dem Vermieter“ → an objekt.vermieter, „schreib dem Eigentümer“ → an objekt.eigentuemer. Ist nur „Eigentümer/Vermieter“ oder „dem Besitzer“ gesagt, nimm den Vermieter bei Miet-Themen (Besichtigung, Miete, Mängel), sonst den Eigentümer; frag nach, wenn es unklar ist und beide verschieden sind.
- Fehlt die angesprochene Person oder ihre E-Mail-Adresse, frag danach. Neue Personen legst du mit der passenden Rolle an (als: Eigentümer oder Vermieter).
Regeln:
- Antworte immer auf Deutsch, kurz und gesprochen-freundlich (1–3 Sätze, keine Aufzählungen, kein Markdown). Sprich den Nutzer mit „du“ an.
- Nutze die Werkzeuge. Erfinde nie IDs, Adressen oder Daten. Wenn ein Objekt gemeint ist, suche es und öffne es.
- Passen mehrere Objekte, nenne sie kurz und frage nach.
- Bevor du eine E-Mail schreibst: Verlauf mit emailverlauf_laden holen, Inhalt und Ton darauf abstimmen, auf offene Fragen eingehen. Bezieht sich die Mail auf eine erhaltene Nachricht, als Antwort darauf schreiben.
- E-Mails sind höflich, sachlich, mit passender Anrede (Sehr geehrte Frau / Sehr geehrter Herr …, bei Firmen „Sehr geehrte Damen und Herren“) und Grußformel.${s.absenderName ? ` Absender ist ${s.absenderName}.` : ''}${s.signatur ? ` Signatur:\n${s.signatur}` : ''}
- Eine E-Mail zeigst du immer nur mit email_entwurf_zeigen an. Du sendest nie selbst; sag dem Nutzer, dass der Entwurf zum Prüfen und Senden bereitliegt.
Postfach: ${mail.eingerichtet() ? `${mail.adresse()} ist eingerichtet, Verlauf wird live abgerufen` : 'nicht eingerichtet – es gibt nur bereits gespeicherte Mails; E-Mails trotzdem entwerfen'}.
Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.
${aktuell}`;
  }

  async werkzeugAusfuehren(name, a) {
    switch (name) {
      case 'objekte_suchen': {
        let treffer = await db.suchen('objekte', a.suchbegriff || '');
        // Wörterweise suchen, falls die exakte Kombination nichts findet.
        if (!treffer.length && a.suchbegriff) {
          const woerter = a.suchbegriff.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          treffer = (await db.alle('objekte')).filter((o) => woerter.some((w) => db.passt(o, w)));
        }
        return { anzahl: treffer.length, objekte: treffer.slice(0, 20).map(kurzObjekt) };
      }
      case 'objekt_oeffnen': {
        const o = await db.holen('objekte', a.objekt_id);
        if (!o) return { fehler: 'Objekt nicht gefunden' };
        await this.ui.objektOeffnen(o.id);
        return { objekt: await objektMitRollen(o) };
      }
      case 'objekt_anlegen': {
        const o = await db.speichern('objekte', { status: 'Interessant', ...a });
        await this.ui.objektOeffnen(o.id);
        return { angelegt: o };
      }
      case 'objekt_aendern': {
        const { objekt_id, ...felder } = a;
        const o = await db.holen('objekte', objekt_id);
        if (!o) return { fehler: 'Objekt nicht gefunden' };
        const neu = await db.speichern('objekte', { ...o, ...felder });
        await this.ui.objektOeffnen(neu.id);
        return { geaendert: neu };
      }
      case 'personen_suchen': {
        const t = await db.suchen('eigentuemer', a.suchbegriff || '');
        return { anzahl: t.length, personen: t.slice(0, 20).map(kurzPerson) };
      }
      case 'person_anlegen': {
        const { objekt_id, als, ...felder } = a;
        const rolle = felder.rolle || (als === 'Vermieter' ? 'Vermieter' : 'Eigentümer');
        const p = await db.speichern('eigentuemer', { ...felder, rolle });
        let ergebnis = { angelegt: kurzPerson(p) };
        if (objekt_id) {
          const o = await db.holen('objekte', objekt_id);
          if (o) {
            const r = await rollen.zuordnen(o, p.id, als || (rolle === 'Eigentümer' ? 'Eigentümer' : 'Vermieter'));
            ergebnis = { ...ergebnis, objekt: await objektMitRollen(r.objekt), automatisch_uebernommen: kurzPerson(r.uebernommen) };
            await this.ui.objektOeffnen(o.id);
          }
        }
        await this.ui.neuLaden();
        return ergebnis;
      }
      case 'person_aendern': {
        const { person_id, ...felder } = a;
        const p = await db.holen('eigentuemer', person_id);
        if (!p) return { fehler: 'Person nicht gefunden' };
        const neu = await db.speichern('eigentuemer', { ...p, ...felder });
        await this.ui.neuLaden();
        return { geaendert: kurzPerson(neu) };
      }
      case 'person_zuordnen': {
        const o = await db.holen('objekte', a.objekt_id);
        if (!o) return { fehler: 'Objekt nicht gefunden' };
        if (a.person_id && !(await db.holen('eigentuemer', a.person_id))) return { fehler: 'Person nicht gefunden' };
        const r = await rollen.zuordnen(o, a.person_id || '', a.als);
        await this.ui.objektOeffnen(o.id);
        return { objekt: await objektMitRollen(r.objekt), automatisch_uebernommen: kurzPerson(r.uebernommen) };
      }
      case 'emailverlauf_laden': {
        const p = await db.holen('eigentuemer', a.person_id);
        if (!p) return { fehler: 'Person nicht gefunden' };
        if (!p.email) return { fehler: 'Person hat keine E-Mail-Adresse' };
        let mails;
        let hinweis;
        try {
          mails = await mail.verlauf(p.email, Math.min(a.anzahl || 8, 20));
        } catch (err) {
          hinweis = 'Postfach nicht erreichbar (' + err.message + '), zeige gespeicherte Mails.';
          mails = await mail.lokalerVerlauf(p.email, Math.min(a.anzahl || 8, 20));
        }
        await this.ui.neuLaden();
        return { anzahl: mails.length, hinweis, emails: mails.map(({ messageId, datum, von, an, betreff, text, eingehend }) => ({ messageId, datum, von, an, betreff, text, eingehend })) };
      }
      case 'email_entwurf_zeigen': {
        const p = await db.holen('eigentuemer', a.person_id);
        if (!p) return { fehler: 'Person nicht gefunden' };
        if (!p.email) return { fehler: 'Person hat keine E-Mail-Adresse – bitte erst erfragen' };
        this.ui.entwurfZeigen({
          objekt_id: a.objekt_id || this.ui.aktuellesObjektId(), person_id: p.id, an: p.email,
          betreff: a.betreff, text: a.text, inReplyTo: a.message_id,
        });
        return { ok: true, hinweis: 'Entwurf wird angezeigt; der Nutzer sendet selbst.' };
      }
      default:
        return { fehler: 'Unbekanntes Werkzeug ' + name };
    }
  }

  async gemini(contents) {
    const s = einstellungen();
    if (!s.geminiKey) throw new Error('Bitte zuerst in den Einstellungen deinen Gemini-API-Schlüssel eintragen.');
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.geminiModell)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: await this.systemText() }] },
        contents,
        tools: [{ functionDeclarations: WERKZEUGE }],
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Gemini-Fehler: ' + (d.error?.message || r.status));
    const inhalt = d.candidates?.[0]?.content;
    if (!inhalt) throw new Error('Gemini hat keine Antwort geliefert.');
    return inhalt;
  }

  // Verarbeitet eine Anfrage des Nutzers und liefert die Textantwort.
  async fragen(text) {
    this.verlauf.push({ role: 'user', parts: [{ text }] });
    for (let runde = 0; runde < 10; runde++) {
      const inhalt = await this.gemini(this.verlauf);
      inhalt.role = 'model';
      inhalt.parts = inhalt.parts || [];
      this.verlauf.push(inhalt);
      const aufrufe = inhalt.parts.filter((p) => p.functionCall);
      if (!aufrufe.length) {
        return inhalt.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim() || 'Erledigt.';
      }
      const antworten = [];
      for (const { functionCall: fc } of aufrufe) {
        this.ui.schritt(fc.name, fc.args || {});
        let ergebnis;
        try { ergebnis = await this.werkzeugAusfuehren(fc.name, fc.args || {}); }
        catch (err) { ergebnis = { fehler: err.message }; }
        antworten.push({ functionResponse: { name: fc.name, id: fc.id, response: ergebnis } });
      }
      this.verlauf.push({ role: 'user', parts: antworten });
    }
    return 'Das hat zu viele Schritte gebraucht – bitte formuliere es etwas genauer.';
  }
}
