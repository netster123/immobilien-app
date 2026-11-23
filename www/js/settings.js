// Einstellungen pro Nutzer, gespeichert nur im eigenen Browser (localStorage).
import { STANDARD } from '../config.js';

const KEY = 'immobilien-app-einstellungen';

export function einstellungen() {
  let gespeichert = {};
  try { gespeichert = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* leer */ }
  return { ...STANDARD, ...Object.fromEntries(Object.entries(gespeichert).filter(([, v]) => v !== '' && v != null)) };
}

export function speichereEinstellungen(werte) {
  try { localStorage.setItem(KEY, JSON.stringify(werte)); } catch { /* privates Fenster */ }
}

export function gespeicherteEinstellungen() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
