# Immobilien-Assistent

Wohnobjekte (Wohnungen, Häuser, Grundstücke …) verwalten, Eigentümer und Vermieter zuordnen und ihnen per Sprachbefehl E-Mails schreiben – mit Blick auf den bisherigen E-Mail-Verkehr.

> „Hat die Vermieterin von der Lindenstraße geantwortet? Schreib ihr, dass Samstag passt.“

Der Assistent sucht das Objekt, liest den E-Mail-Verlauf mit dem Eigentümer und legt eine passende Antwort als Entwurf vor. **Gesendet wird erst, wenn du selbst auf „Senden“ tippst.**

## Eigentümer und Vermieter

Jedes Objekt hat einen **Eigentümer** und einen **Vermieter**:

- Ist nur der Eigentümer eingetragen, **vermietet er selbst** – er ist dann automatisch auch der Vermieter.
- Vermietet jemand anderes (z. B. eine Hausverwaltung), trägst du den Vermieter extra ein. Er wird mit dem Eigentümer **verknüpft**.
- Trägst du bei einem weiteren Objekt denselben Eigentümer ein, wird sein Vermieter **automatisch übernommen** – und umgekehrt der Eigentümer, wenn du nur den Vermieter einträgst.
- Passt ein Vermieter nicht zum Eigentümer (er ist für jemand anderen eingetragen), zeigt die App einen Hinweis.
- „Schreib dem Vermieter …“ bzw. „Schreib dem Eigentümer …“ – der Assistent wählt die richtige Person.

## Android-App (empfohlen)

**Herunterladen:** https://github.com/netster123/immobilien-app/releases/latest → `immobilien-assistent.apk`

Neue Versionen installierst du einfach über die alte drüber – deine Daten bleiben erhalten. (Ausnahme: Wer v1.0.1 oder v1.0.2 installiert hat, muss einmalig deinstallieren, vorher Daten exportieren.)

1. Die Datei auf dem Handy herunterladen und öffnen.
2. Android fragt, ob der Browser Apps installieren darf → erlauben („Unbekannte Apps installieren“).
3. App öffnen → **Einstellungen**:
   - **Gemini-API-Schlüssel** eintragen (kostenlos unter https://aistudio.google.com/apikey).
   - **E-Mail-Konto**: Anbieter (GMX, WEB.DE, T-Online oder Andere), E-Mail-Adresse und Passwort → **Speichern und Verbindung testen**.
   - Benachrichtigungen erlauben, wenn Android fragt.

**Wichtig bei GMX:** Im GMX-Postfach (Browser) unter *Einstellungen → POP3/IMAP Abruf* den Zugriff per IMAP erlauben. Wer bei GMX die Zwei-Faktor-Anmeldung nutzt, legt dort ein **App-Passwort** an und trägt dieses statt des normalen Passworts ein.

### So funktioniert der E-Mail-Abruf

- Die App ruft das Postfach **im Hintergrund** ab, je nach Einstellung alle 15, 30 oder 60 Minuten – auch wenn die App geschlossen ist. Android legt den genauen Zeitpunkt selbst fest (Akku sparen), es kann also auch mal etwas später werden.
- Übernommen werden **nur Mails von und an deine eingetragenen Eigentümer**, nicht dein ganzes Postfach. Bei neuen Mails kommt eine Benachrichtigung.
- Beim Öffnen der App wird sofort abgerufen. Ältere Mails holt „Aus Postfach laden“ beim jeweiligen Objekt – oder der Assistent, wenn er eine Mail schreiben soll.
- Gesendete Mails gehen über dein eigenes Postfach und landen dort auch im Ordner „Gesendet“.
- Passwort und Zugangsdaten liegen verschlüsselt nur auf deinem Handy.

## Im Browser

Die App läuft auch im Browser: https://netster123.github.io/immobilien-app/

Dort fehlt nur der E-Mail-Abruf, denn ein Browser kann nicht direkt mit GMX sprechen. Entwürfe öffnest du mit „Im Mail-Programm öffnen“. Spracheingabe geht in Chrome, Edge und Safari.

## Deine Daten

Objekte, Kontakte, Mails und Einstellungen liegen **nur auf deinem Gerät**. Nichts davon landet auf GitHub oder einem fremden Server. Jeder Nutzer hat also seine eigenen Daten.

- Auf ein anderes Gerät überträgst du sie mit *Einstellungen → Daten exportieren / importieren*.
- Wer die App deinstalliert, löscht auch die Daten → vorher exportieren.
- Für Sprachbefehle schickt die App deine Anfrage und die dazu gefundenen Objekt-, Kontakt- und Maildaten an Google Gemini.

## Für Entwickler

Die Oberfläche ist reines HTML/CSS/JavaScript in `www/` (kein Build-Schritt). Die Android-App ist eine [Capacitor](https://capacitorjs.com)-Hülle darum, mit einem eigenen Mail-Baustein in Java.

```bash
npm start            # Web-Version unter http://localhost:8765
npx cap sync android # Web-Dateien in die Android-App kopieren
```

Bei jedem Push auf `main` baut GitHub Actions automatisch eine neue APK und veröffentlicht sie unter *Releases*; die Web-Version wird auf GitHub Pages aktualisiert.

| Datei | Inhalt |
|---|---|
| `www/js/app.js` | Listen, Detailansichten, Dialoge, Postfach-Einstellungen |
| `www/js/assistant.js` | Gemini-Assistent mit Werkzeugen (suchen, anlegen, Verlauf laden, Entwurf zeigen) |
| `www/js/mail.js` | Verbindung zum Mail-Baustein, Speichern der Mails |
| `www/js/rollen.js` | Regeln für Eigentümer und Vermieter (Verknüpfung, automatische Übernahme) |
| `www/js/db.js` | Datenspeicher auf dem Gerät (IndexedDB) |
| `www/js/speech.js` | Spracheingabe und Vorlesen (Android nativ, sonst Browser) |
| `android/…/MailDienst.java` | IMAP-Abruf und SMTP-Versand (z. B. GMX) |
| `android/…/MailWorker.java` | Regelmäßiger Hintergrundabruf |
| `android/…/MailPlugin.java` | Schnittstelle zwischen Oberfläche und Mail-Baustein |
| `android/…/MailKonto.java` | Verschlüsselt gespeicherte Zugangsdaten |
