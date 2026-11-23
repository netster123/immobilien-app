// Sprachassistent: versteht Befehle wie „Suche Objekt A raus und schreibe eine E-Mail“
// und führt sie über Werkzeuge (Funktionen) aus. E-Mails werden nur als Entwurf vorbereitet –
// gesendet wird erst, wenn der Nutzer auf „Senden“ klickt.

import * as db from './db.js';
import * as gmail from './gmail.js';
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

const EIGENTUEMER_FELDER = {
  name: { type: 'string', description: 'Vor- und Nachname' },
  rolle: { type: 'string', enum: ['Eigentümer', 'Vermieter', 'Verwalter', 'Makler'] },
  anrede: { type: 'string', enum: ['Herr', 'Frau', 'Firma'] },
  firma: { type: 'string' }, email: { type: 'string' }, telefon: { type: 'string' },
  adresse: { type: 'string' }, notizen: { type: 'string' },
};

const WERKZEUGE = [
  { name: 'objekte_suchen', description: 'Sucht Wohnobjekte nach Name, Adresse, Ort, Typ oder Notizen. Leerer Suchbegriff liefert alle.',
    parameters: { type: 'object', properties: { suchbegriff: { type: 'string' } } } },
  { name: 'objekt_oeffnen', description: 'Zeigt ein Objekt in der App an (macht es zum aktuellen Objekt).',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' } }, required: ['objekt_id'] } },
  { name: 'objekt_anlegen', description: 'Legt ein neues Wohnobjekt an und öffnet es.',
    parameters: { type: 'object', properties: OBJEKT_FELDER, required: ['bezeichnung', 'typ'] } },
  { name: 'objekt_aendern', description: 'Ändert Felder eines Objekts. Nur die genannten Felder werden überschrieben.',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' }, ...OBJEKT_FELDER }, required: ['objekt_id'] } },
  { name: 'eigentuemer_suchen', description: 'Sucht Eigentümer/Vermieter nach Name, Firma, E-Mail usw.',
    parameters: { type: 'object', properties: { suchbegriff: { type: 'string' } } } },
  { name: 'eigentuemer_anlegen', description: 'Legt einen Eigentümer/Vermieter an. Mit objekt_id wird er gleich diesem Objekt zugeordnet.',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' }, ...EIGENTUEMER_FELDER }, required: ['name'] } },
  { name: 'eigentuemer_aendern', description: 'Ändert Felder eines Eigentümers.',
    parameters: { type: 'object', properties: { eigentuemer_id: { type: 'string' }, ...EIGENTUEMER_FELDER }, required: ['eigentuemer_id'] } },
  { name: 'eigentuemer_zuordnen', description: 'Ordnet einem Objekt einen bestehenden Eigentümer zu.',
    parameters: { type: 'object', properties: { objekt_id: { type: 'string' }, eigentuemer_id: { type: 'string' } }, required: ['objekt_id', 'eigentuemer_id'] } },
  { name: 'emailverlauf_laden', description: 'Lädt den bisherigen E-Mail-Verkehr mit dem Eigentümer aus Gmail (neueste zuerst). Vor dem Schreiben einer E-Mail immer aufrufen.',
    parameters: { type: 'object', properties: { eigentuemer_id: { type: 'string' }, anzahl: { type: 'number' } }, required: ['eigentuemer_id'] } },
  { name: 'email_entwurf_zeigen', description: 'Zeigt dem Nutzer einen fertigen E-Mail-Entwurf an den Eigentümer. Der Nutzer prüft und sendet selbst. Für eine Antwort im bestehenden Verlauf thread_id und message_id der letzten Nachricht angeben.',
    parameters: { type: 'object', properties: {
      objekt_id: { type: 'string' }, eigentuemer_id: { type: 'string' },
      betreff: { type: 'string' }, text: { type: 'string', description: 'Vollständiger Text mit Anrede und Grußformel' },
      thread_id: { type: 'string' }, message_id: { type: 'string' },
    }, required: ['eigentuemer_id', 'betreff', 'text'] } },
];

function kurzObjekt(o) {
  const { id, bezeichnung, typ, strasse, plz, ort, status, eigentuemer_id } = o;
  return { id, bezeichnung, typ, adresse: [strasse, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(', '), status, eigentuemer_id };
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
      const e = o?.eigentuemer_id ? await db.holen('eigentuemer', o.eigentuemer_id) : null;
      if (o) aktuell = `Aktuell geöffnetes Objekt: ${JSON.stringify(o)}\nZugeordneter Eigentümer: ${e ? JSON.stringify(e) : 'keiner'}`;
    }
    return `Du bist der Assistent einer Immobilien-App. Der Nutzer verwaltet Wohnobjekte (Wohnungen, Häuser, Grundstücke …) und deren Eigentümer/Vermieter und schreibt ihnen E-Mails.
Der Nutzer spricht meist per Spracheingabe – Tippfehler und ungenaue Namen sind normal, suche dann großzügig.
Regeln:
- Antworte immer auf Deutsch, kurz und gesprochen-freundlich (1–3 Sätze, keine Aufzählungen, kein Markdown).
- Nutze die Werkzeuge. Erfinde nie IDs, Adressen oder Daten. Wenn ein Objekt gemeint ist, suche es und öffne es.
- Passen mehrere Objekte, nenne sie kurz und frage nach.
- Bevor du eine E-Mail schreibst: Verlauf mit emailverlauf_laden holen (falls Gmail verbunden), Inhalt und Ton darauf abstimmen, auf offene Fragen eingehen. Bei bestehendem Verlauf als Antwort im selben Thread schreiben.
- E-Mails sind höflich, sachlich, mit passender Anrede (Sehr geehrte Frau / Sehr geehrter Herr …) und Grußformel.${s.absenderName ? ` Absender ist ${s.absenderName}.` : ''}${s.signatur ? ` Signatur:\n${s.signatur}` : ''}
- Eine E-Mail zeigst du immer nur mit email_entwurf_zeigen an. Du sendest nie selbst; sag dem Nutzer, dass der Entwurf zum Prüfen und Senden bereitliegt.
- Hat das Objekt keinen Eigentümer oder dieser keine E-Mail-Adresse, frag danach.
Gmail ist ${gmail.istAngemeldet() ? `verbunden (${gmail.adresse()})` : 'nicht verbunden – Verlauf kann nicht geladen werden, E-Mails trotzdem entwerfen'}.
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
        const e = o.eigentuemer_id ? await db.holen('eigentuemer', o.eigentuemer_id) : null;
        return { objekt: o, eigentuemer: e };
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
      case 'eigentuemer_suchen': {
        const t = await db.suchen('eigentuemer', a.suchbegriff || '');
        return { anzahl: t.length, eigentuemer: t.slice(0, 20) };
      }
      case 'eigentuemer_anlegen': {
        const { objekt_id, ...felder } = a;
        const e = await db.speichern('eigentuemer', { rolle: 'Eigentümer', ...felder });
        if (objekt_id) {
          const o = await db.holen('objekte', objekt_id);
          if (o) { await db.speichern('objekte', { ...o, eigentuemer_id: e.id }); await this.ui.objektOeffnen(o.id); }
        }
        await this.ui.neuLaden();
        return { angelegt: e, zugeordnet_zu: objekt_id || null };
      }
      case 'eigentuemer_aendern': {
        const { eigentuemer_id, ...felder } = a;
        const e = await db.holen('eigentuemer', eigentuemer_id);
        if (!e) return { fehler: 'Eigentümer nicht gefunden' };
        const neu = await db.speichern('eigentuemer', { ...e, ...felder });
        await this.ui.neuLaden();
        return { geaendert: neu };
      }
      case 'eigentuemer_zuordnen': {
        const o = await db.holen('objekte', a.objekt_id);
        const e = await db.holen('eigentuemer', a.eigentuemer_id);
        if (!o || !e) return { fehler: 'Objekt oder Eigentümer nicht gefunden' };
        await db.speichern('objekte', { ...o, eigentuemer_id: e.id });
        await this.ui.objektOeffnen(o.id);
        return { ok: true };
      }
      case 'emailverlauf_laden': {
        const e = await db.holen('eigentuemer', a.eigentuemer_id);
        if (!e) return { fehler: 'Eigentümer nicht gefunden' };
        if (!e.email) return { fehler: 'Eigentümer hat keine E-Mail-Adresse' };
        if (!gmail.istAngemeldet()) return { hinweis: 'Gmail ist nicht verbunden, kein Verlauf verfügbar.' };
        const mails = await gmail.verlauf(e.email, Math.min(a.anzahl || 8, 20));
        return { anzahl: mails.length, emails: mails };
      }
      case 'email_entwurf_zeigen': {
        const e = await db.holen('eigentuemer', a.eigentuemer_id);
        if (!e) return { fehler: 'Eigentümer nicht gefunden' };
        if (!e.email) return { fehler: 'Eigentümer hat keine E-Mail-Adresse – bitte erst erfragen' };
        this.ui.entwurfZeigen({
          objekt_id: a.objekt_id || this.ui.aktuellesObjektId(), eigentuemer_id: e.id, an: e.email,
          betreff: a.betreff, text: a.text, threadId: a.thread_id, inReplyTo: a.message_id,
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
