// Spracheingabe (Web Speech API) und Sprachausgabe.

const Erkennung = window.SpeechRecognition || window.webkitSpeechRecognition;

export const spracheingabeVerfuegbar = Boolean(Erkennung);

// Startet die Erkennung. onZwischen bekommt den laufenden Text, Rückgabe ist der Endtext.
export function zuhoeren(sprache, onZwischen) {
  return new Promise((resolve, reject) => {
    if (!Erkennung) return reject(new Error('Dein Browser unterstützt keine Spracheingabe. Nimm Chrome, Edge oder Safari.'));
    const rec = new Erkennung();
    rec.lang = sprache;
    rec.interimResults = true;
    rec.continuous = false;
    let endtext = '';
    rec.onresult = (ev) => {
      let zwischen = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) endtext += ev.results[i][0].transcript;
        else zwischen += ev.results[i][0].transcript;
      }
      onZwischen?.(endtext + zwischen);
    };
    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return resolve('');
      reject(new Error(ev.error === 'not-allowed' ? 'Mikrofon-Zugriff wurde nicht erlaubt.' : 'Spracheingabe-Fehler: ' + ev.error));
    };
    rec.onend = () => resolve(endtext.trim());
    zuhoeren.aktiv = rec;
    rec.start();
  });
}

export function stoppen() {
  zuhoeren.aktiv?.stop();
}

export function vorlesen(text, sprache) {
  if (!window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = sprache;
  const stimme = speechSynthesis.getVoices().find((v) => v.lang === sprache && /premium|enhanced|anna|petra|helena/i.test(v.name))
    || speechSynthesis.getVoices().find((v) => v.lang === sprache);
  if (stimme) u.voice = stimme;
  speechSynthesis.speak(u);
}
