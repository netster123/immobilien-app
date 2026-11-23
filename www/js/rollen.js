// Eigentümer und Vermieter eines Objekts.
//
// Objekt: eigentuemer_id, vermieter_id, vermietet_selbst
// - Ist kein eigener Vermieter eingetragen, vermietet der Eigentümer selbst (er ist dann auch Vermieter).
// - Ein eigener Vermieter (z. B. Hausverwaltung) wird mit dem Eigentümer verknüpft (Person.fuer_eigentuemer_id).
//   Bei weiteren Objekten desselben Eigentümers wird dieser Vermieter automatisch übernommen –
//   und umgekehrt der Eigentümer, wenn nur der Vermieter bekannt ist.
// Personen liegen im Speicher „eigentuemer“ (historischer Name), jede mit einer Rolle.

import * as db from './db.js';

export const ROLLEN = ['Eigentümer', 'Vermieter', 'Hausverwaltung', 'Makler'];

const holen = (id) => (id ? db.holen('eigentuemer', id) : Promise.resolve(null));

export function name(p) {
  return p ? [p.anrede === 'Firma' ? '' : p.anrede, p.name].filter(Boolean).join(' ') || p.firma || p.email || 'Unbekannt' : '';
}

// Wer ist Eigentümer, wer Vermieter – und passt das zusammen?
export async function beteiligte(o) {
  const eigentuemer = await holen(o.eigentuemer_id);
  let vermieter = null;
  let vermietetSelbst = false;
  if (o.vermieter_id && o.vermieter_id !== o.eigentuemer_id) {
    vermieter = await holen(o.vermieter_id);
  } else if (eigentuemer && o.vermietet_selbst !== false) {
    vermieter = eigentuemer;
    vermietetSelbst = true;
  }
  let hinweis = '';
  if (vermieter && !vermietetSelbst && eigentuemer && vermieter.fuer_eigentuemer_id
      && vermieter.fuer_eigentuemer_id !== eigentuemer.id) {
    const anderer = await holen(vermieter.fuer_eigentuemer_id);
    hinweis = `${name(vermieter)} ist als Vermieter für ${name(anderer) || 'einen anderen Eigentümer'} eingetragen, nicht für ${name(eigentuemer)}.`;
  }
  return { eigentuemer, vermieter, vermietetSelbst, hinweis };
}

// Bekannter Vermieter eines Eigentümers: direkt verknüpft oder von seinen anderen Objekten.
export async function vermieterVorschlag(eigentuemerId, ohneObjektId = null) {
  if (!eigentuemerId) return null;
  const zaehler = new Map();
  for (const p of await db.alle('eigentuemer')) {
    if (p.fuer_eigentuemer_id === eigentuemerId && p.id !== eigentuemerId) zaehler.set(p.id, (zaehler.get(p.id) || 0) + 2);
  }
  for (const o of await db.alle('objekte')) {
    if (o.id !== ohneObjektId && o.eigentuemer_id === eigentuemerId && o.vermieter_id && o.vermieter_id !== eigentuemerId) {
      zaehler.set(o.vermieter_id, (zaehler.get(o.vermieter_id) || 0) + 1);
    }
  }
  const best = [...zaehler.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? holen(best[0]) : null;
}

// Setzt den Eigentümer. Ohne eigenen Vermieter wird ein bekannter Vermieter dieses Eigentümers übernommen.
export async function eigentuemerSetzen(objekt, personId) {
  const o = { ...objekt, eigentuemer_id: personId || '' };
  let uebernommen = null;
  if (personId && !o.vermieter_id) {
    uebernommen = await vermieterVorschlag(personId, o.id);
    if (uebernommen) { o.vermieter_id = uebernommen.id; o.vermietet_selbst = false; }
  }
  if (o.vermieter_id === o.eigentuemer_id) { o.vermieter_id = ''; o.vermietet_selbst = true; }
  // Vorhandener Vermieter ohne Eigentümer-Verknüpfung → jetzt verknüpfen.
  if (personId && o.vermieter_id && !uebernommen) {
    const v = await holen(o.vermieter_id);
    if (v && !v.fuer_eigentuemer_id) await db.speichern('eigentuemer', { ...v, fuer_eigentuemer_id: personId });
  }
  return { objekt: await db.speichern('objekte', o), uebernommen };
}

// Setzt einen eigenen Vermieter (leer = Eigentümer vermietet selbst) und verknüpft ihn mit dem Eigentümer.
export async function vermieterSetzen(objekt, personId) {
  const o = { ...objekt };
  let uebernommen = null;
  if (!personId || personId === o.eigentuemer_id) {
    o.vermieter_id = '';
    o.vermietet_selbst = true;
  } else {
    o.vermieter_id = personId;
    o.vermietet_selbst = false;
    const p = await holen(personId);
    if (p && o.eigentuemer_id && !p.fuer_eigentuemer_id) {
      await db.speichern('eigentuemer', { ...p, fuer_eigentuemer_id: o.eigentuemer_id });
    }
    // Nur der Vermieter ist bekannt → dessen Eigentümer übernehmen.
    if (p && !o.eigentuemer_id && p.fuer_eigentuemer_id) {
      o.eigentuemer_id = p.fuer_eigentuemer_id;
      uebernommen = await holen(p.fuer_eigentuemer_id);
    }
  }
  return { objekt: await db.speichern('objekte', o), uebernommen };
}

// Ordnet eine Person in der passenden Rolle zu.
export async function zuordnen(objekt, personId, als) {
  return als === 'Vermieter' ? vermieterSetzen(objekt, personId) : eigentuemerSetzen(objekt, personId);
}

// Entfernt eine gelöschte Person aus allen Objekten und Verknüpfungen.
export async function personEntfernen(personId) {
  for (const o of await db.alle('objekte')) {
    if (o.eigentuemer_id === personId || o.vermieter_id === personId) {
      await db.speichern('objekte', {
        ...o,
        eigentuemer_id: o.eigentuemer_id === personId ? '' : o.eigentuemer_id,
        vermieter_id: o.vermieter_id === personId ? '' : o.vermieter_id,
      });
    }
  }
  for (const p of await db.alle('eigentuemer')) {
    if (p.fuer_eigentuemer_id === personId) await db.speichern('eigentuemer', { ...p, fuer_eigentuemer_id: '' });
  }
  await db.loeschen('eigentuemer', personId);
}

// Alte Daten: Wer als „Vermieter“/„Verwalter“/„Makler“ im Eigentümer-Feld stand, wird Vermieter.
export async function migrieren() {
  for (const o of await db.alle('objekte')) {
    if (!o.eigentuemer_id || o.vermieter_id) continue;
    const p = await holen(o.eigentuemer_id);
    if (p && ['Vermieter', 'Verwalter', 'Hausverwaltung', 'Makler'].includes(p.rolle)) {
      await db.speichern('objekte', { ...o, eigentuemer_id: '', vermieter_id: p.id, vermietet_selbst: false });
    }
  }
  for (const p of await db.alle('eigentuemer')) {
    if (p.rolle === 'Verwalter') await db.speichern('eigentuemer', { ...p, rolle: 'Hausverwaltung' });
  }
}
