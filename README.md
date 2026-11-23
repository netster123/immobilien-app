# Immobilien-Assistent

Wohnobjekte (Wohnungen, Häuser, Grundstücke …) verwalten, Eigentümer und Vermieter zuordnen und ihnen per Sprachbefehl E-Mails schreiben – mit Blick auf den bisherigen Gmail-Verlauf.

**App öffnen:** https://netster123.github.io/immobilien-app/

> „Suche die Wohnung in der Lindenstraße raus und schreib der Vermieterin, ob am Freitag um 17 Uhr eine Besichtigung geht.“

Der Assistent sucht das Objekt, öffnet es, liest den bisherigen E-Mail-Verkehr mit dem Eigentümer und legt einen fertigen Entwurf vor. **Gesendet wird erst, wenn du selbst auf „Senden“ klickst.**

## Was die App kann

- Objekte anlegen, suchen, bearbeiten (Art, Adresse, Fläche, Zimmer, Preis, Status, Notizen)
- Eigentümer, Vermieter, Verwalter oder Makler anlegen und Objekten zuordnen
- Sprachsteuerung (Mikrofon-Knopf) oder Texteingabe, Antworten werden vorgelesen
- E-Mail-Verlauf mit einem Eigentümer aus Gmail anzeigen
- E-Mails mit Gmail senden – oder im eigenen Mail-Programm öffnen
- Daten als Datei sichern und auf einem anderen Gerät wieder einlesen

## Deine Daten

Alle Objekte, Kontakte und Einstellungen liegen **nur im Browser auf deinem Gerät**. Nichts davon landet auf GitHub oder einem fremden Server. Deshalb:

- Jeder Nutzer hat seine eigenen Daten.
- Auf einem anderen Gerät oder Browser fängst du leer an → über *Einstellungen → Daten exportieren / importieren* übertragen.
- Browserdaten löschen löscht auch die App-Daten → regelmäßig exportieren.

Für die Sprachbefehle schickt die App deine Anfrage und die dazu gefundenen Objekt- und Kontaktdaten an Google Gemini.

## Einrichtung für Nutzer (2 Minuten)

1. App öffnen, oben auf **Einstellungen**.
2. **Gemini-API-Schlüssel** eintragen. Kostenlos erhältlich unter https://aistudio.google.com/apikey (mit Google-Konto anmelden → „API-Schlüssel erstellen“).
3. Optional: Name und Signatur für E-Mails eintragen.
4. Für Gmail oben auf **Gmail verbinden** klicken und mit Google anmelden. (Funktioniert nur, wenn die Google-Client-ID eingerichtet ist, siehe unten.)

Spracheingabe funktioniert in **Chrome, Edge und Safari** (nicht in Firefox). Beim ersten Mal fragt der Browser nach dem Mikrofon.

## Einmalige Einrichtung von Gmail (nur der Betreiber)

Damit die App Gmail lesen und senden darf, braucht sie eine Google-Client-ID. Die richtest du einmal ein:

1. https://console.cloud.google.com öffnen → oben **Projekt erstellen**, z. B. „Immobilien-Assistent“.
2. **APIs & Dienste → Bibliothek** → „Gmail API“ suchen → **Aktivieren**.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm** (bzw. „Google Auth Platform“):
   - Nutzertyp **Extern**, App-Name und deine E-Mail eintragen.
   - Bei **Datenzugriff / Bereiche** hinzufügen: `gmail.readonly` und `gmail.send`.
   - Bei **Zielgruppe / Testnutzer** die Gmail-Adressen aller Personen eintragen, die die App nutzen sollen (bis zu 100).
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp **Webanwendung**
   - **Autorisierte JavaScript-Quellen:** `https://netster123.github.io` (zum lokalen Testen zusätzlich `http://localhost:8765`)
   - Erstellen → die **Client-ID** kopieren (endet auf `.apps.googleusercontent.com`).
5. Die Client-ID in [`config.js`](config.js) bei `googleClientId` eintragen und hochladen. Dann müssen andere Nutzer nichts mehr eintragen. (Die Client-ID ist kein Geheimnis und darf öffentlich sein. Einen Gemini-Schlüssel dagegen **nie** in `config.js` schreiben.)

Hinweise:
- Solange die App bei Google im **Testmodus** ist, sieht man bei der Anmeldung den Hinweis „Google hat diese App nicht überprüft“ → *Weiter* klicken. Nur eingetragene Testnutzer können sich anmelden.
- Die Gmail-Verbindung hält etwa eine Stunde, danach erneut auf „Gmail verbinden“ klicken.

## Lokal starten (für Entwickler)

```bash
python3 -m http.server 8765
```

Dann http://localhost:8765 öffnen. Die App ist reines HTML/CSS/JavaScript ohne Build-Schritt.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `css/style.css` | Oberfläche |
| `js/app.js` | Listen, Detailansichten, Dialoge |
| `js/assistant.js` | Gemini-Assistent mit Werkzeugen (suchen, anlegen, Verlauf laden, Entwurf zeigen) |
| `js/gmail.js` | Google-Anmeldung, Verlauf lesen, senden |
| `js/db.js` | Datenspeicher im Browser (IndexedDB) |
| `js/speech.js` | Spracheingabe und Vorlesen |
| `config.js` | Standardwerte für alle Nutzer (Google-Client-ID, Modell) |
