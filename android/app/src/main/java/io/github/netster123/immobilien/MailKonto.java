package io.github.netster123.immobilien;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** Zugangsdaten und Abrufstand, verschlüsselt auf dem Gerät gespeichert. */
public class MailKonto {
    private static final String DATEI = "mailkonto";
    private final SharedPreferences prefs;

    public MailKonto(Context ctx) {
        SharedPreferences p;
        try {
            String alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            p = EncryptedSharedPreferences.create(DATEI, alias, ctx.getApplicationContext(),
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            throw new IllegalStateException("Sicherer Speicher nicht verfügbar: " + e.getMessage(), e);
        }
        prefs = p;
    }

    public String email() { return prefs.getString("email", ""); }
    public String passwort() { return prefs.getString("passwort", ""); }
    public String imapHost() { return prefs.getString("imapHost", ""); }
    public int imapPort() { return prefs.getInt("imapPort", 993); }
    public String smtpHost() { return prefs.getString("smtpHost", ""); }
    public int smtpPort() { return prefs.getInt("smtpPort", 587); }
    public String absenderName() { return prefs.getString("absenderName", ""); }
    public int intervall() { return prefs.getInt("intervall", 15); }

    public boolean eingerichtet() {
        return !email().isEmpty() && !passwort().isEmpty() && !imapHost().isEmpty() && !smtpHost().isEmpty();
    }

    public void speichern(String email, String passwort, String imapHost, int imapPort,
                          String smtpHost, int smtpPort, String absenderName, int intervall) {
        SharedPreferences.Editor e = prefs.edit()
                .putString("email", email)
                .putString("imapHost", imapHost).putInt("imapPort", imapPort)
                .putString("smtpHost", smtpHost).putInt("smtpPort", smtpPort)
                .putString("absenderName", absenderName).putInt("intervall", intervall);
        // Leeres Passwort heißt: bisheriges behalten.
        if (passwort != null && !passwort.isEmpty()) e.putString("passwort", passwort);
        // Anderes Konto → Abrufstand zurücksetzen.
        if (!email.equalsIgnoreCase(email())) {
            for (String k : prefs.getAll().keySet()) if (k.startsWith("uid")) e.remove(k);
        }
        e.apply();
    }

    public void loeschen() { prefs.edit().clear().apply(); }

    /** Adresse (klein geschrieben) → Name des Eigentümers. */
    public Map<String, String> kontakte() {
        Map<String, String> m = new HashMap<>();
        try {
            JSONObject o = new JSONObject(prefs.getString("kontakte", "{}"));
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                m.put(k.toLowerCase(), o.optString(k, k));
            }
        } catch (Exception ignored) { }
        return m;
    }

    public void kontakteSetzen(JSONObject kontakte) {
        prefs.edit().putString("kontakte", kontakte.toString()).apply();
    }

    public long zahl(String schluessel, long standard) { return prefs.getLong(schluessel, standard); }
    public void zahlSetzen(String schluessel, long wert) { prefs.edit().putLong(schluessel, wert).apply(); }
}
