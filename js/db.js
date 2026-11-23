// Datenspeicher im Browser (IndexedDB). Alle Daten bleiben auf dem Gerät des Nutzers.

const DB_NAME = 'immobilien-app';
const DB_VERSION = 1;
export const STORES = ['objekte', 'eigentuemer', 'gesendet'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export function neueId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).slice(0, 8);
}

export const alle = (store) => tx(store, 'readonly', (s) => s.getAll());
export const holen = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const loeschen = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));

export async function speichern(store, obj) {
  const jetzt = new Date().toISOString();
  const eintrag = { ...obj };
  if (!eintrag.id) {
    eintrag.id = neueId();
    eintrag.erstellt = jetzt;
  }
  eintrag.geaendert = jetzt;
  await tx(store, 'readwrite', (s) => s.put(eintrag));
  return eintrag;
}

// Einfache Volltextsuche: alle Suchwörter müssen irgendwo im Eintrag vorkommen.
export function passt(eintrag, suchbegriff) {
  if (!suchbegriff) return true;
  const text = Object.values(eintrag).filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' ').toLowerCase();
  return suchbegriff.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
}

export async function suchen(store, suchbegriff) {
  return (await alle(store)).filter((e) => passt(e, suchbegriff));
}

// Sicherung: alles als JSON exportieren bzw. wieder einlesen.
export async function exportieren() {
  const daten = { app: 'immobilien-app', version: 1, exportiert: new Date().toISOString() };
  for (const s of STORES) daten[s] = await alle(s);
  return daten;
}

export async function importieren(daten) {
  if (daten?.app !== 'immobilien-app') throw new Error('Das ist keine Sicherungsdatei dieser App.');
  for (const s of STORES) {
    for (const e of daten[s] || []) await tx(s, 'readwrite', (st) => st.put(e));
  }
}
