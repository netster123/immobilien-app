// Spracheingabe und Sprachausgabe.
// In der Android-App über native Bausteine (WebView kann das nicht selbst), im Browser über die Web Speech API.

const nativ = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null);
const Erkennung = window.SpeechRecognition || window.webkitSpeechRecognition;

export function spracheingabeVerfuegbar() {
  return Boolean(nativ()?.SpeechRecognition || Erkennung);
}

async function zuhoerenNativ(sprache, onZwischen) {
  const SR = nativ().SpeechRecognition;
  const { available } = await SR.available();
  if (!available) throw new Error('Auf diesem Handy ist keine Spracherkennung verfügbar (Google-App installieren).');
  const rechte = await SR.requestPermissions();
  if (rechte.speechRecognition !== 'granted') throw new Error('Mikrofon-Zugriff wurde nicht erlaubt.');
  onZwischen?.('Ich höre zu …');
  const ergebnis = await SR.start({ language: sprache, maxResults: 1, partialResults: false, popup: false });
  return (ergebnis?.matches?.[0] || '').trim();
}

function zuhoerenWeb(sprache, onZwischen) {
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
    zuhoerenWeb.aktiv = rec;
    rec.start();
  });
}

// Startet die Erkennung. onZwischen bekommt den laufenden Text, Rückgabe ist der Endtext.
export function zuhoeren(sprache, onZwischen) {
  return nativ()?.SpeechRecognition ? zuhoerenNativ(sprache, onZwischen) : zuhoerenWeb(sprache, onZwischen);
}

export function stoppen() {
  if (nativ()?.SpeechRecognition) nativ().SpeechRecognition.stop().catch(() => {});
  else zuhoerenWeb.aktiv?.stop();
}

export function verstummen() {
  if (nativ()?.TextToSpeech) nativ().TextToSpeech.stop().catch(() => {});
  else window.speechSynthesis?.cancel();
}

export function vorlesen(text, sprache) {
  if (!text) return;
  if (nativ()?.TextToSpeech) {
    nativ().TextToSpeech.speak({ text, lang: sprache, rate: 1.0 }).catch(() => {});
    return;
  }
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = sprache;
  const stimmen = speechSynthesis.getVoices();
  const stimme = stimmen.find((v) => v.lang === sprache && /premium|enhanced|anna|petra|helena/i.test(v.name))
    || stimmen.find((v) => v.lang === sprache);
  if (stimme) u.voice = stimme;
  speechSynthesis.speak(u);
}
