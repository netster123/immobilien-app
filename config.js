// Standardwerte für alle Nutzer. Jeder kann sie in der App unter „Einstellungen“ überschreiben.
// Hier NIEMALS einen Gemini-API-Schlüssel eintragen – diese Datei ist öffentlich.
export const STANDARD = {
  // Öffentliche OAuth-Client-ID aus der Google Cloud Console (kein Geheimnis).
  // Wenn sie hier steht, müssen andere Nutzer nur noch „Gmail verbinden“ klicken.
  googleClientId: '',
  geminiModell: 'gemini-3.8-flash',
  sprache: 'de-DE',
  vorlesen: true,
  absenderName: '',
  signatur: '',
};
