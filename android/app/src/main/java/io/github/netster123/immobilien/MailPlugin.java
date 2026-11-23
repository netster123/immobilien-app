package io.github.netster123.immobilien;

import android.Manifest;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Schnittstelle zwischen der Web-Oberfläche und dem Mail-Baustein. In JavaScript: Capacitor.Plugins.Mail */
@CapacitorPlugin(
        name = "Mail",
        permissions = {@Permission(alias = "benachrichtigungen", strings = {Manifest.permission.POST_NOTIFICATIONS})}
)
public class MailPlugin extends Plugin {
    private final ExecutorService hintergrund = Executors.newSingleThreadExecutor();

    private MailDienst dienst() { return new MailDienst(getContext()); }

    private interface Aufgabe { void ausfuehren() throws Exception; }

    private void imHintergrund(PluginCall call, Aufgabe a) {
        hintergrund.execute(() -> {
            try {
                a.ausfuehren();
            } catch (Exception e) {
                call.reject(MailDienst.fehlertext(e));
            }
        });
    }

    private JSObject konfigAlsJson(MailKonto k) {
        JSObject o = new JSObject();
        o.put("eingerichtet", k.eingerichtet());
        o.put("email", k.email());
        o.put("hatPasswort", !k.passwort().isEmpty());
        o.put("imapHost", k.imapHost());
        o.put("imapPort", k.imapPort());
        o.put("smtpHost", k.smtpHost());
        o.put("smtpPort", k.smtpPort());
        o.put("absenderName", k.absenderName());
        o.put("intervall", k.intervall());
        return o;
    }

    @PluginMethod
    public void konfiguration(PluginCall call) {
        imHintergrund(call, () -> call.resolve(konfigAlsJson(dienst().konto())));
    }

    @PluginMethod
    public void konfigurieren(PluginCall call) {
        imHintergrund(call, () -> {
            MailKonto k = dienst().konto();
            k.speichern(
                    call.getString("email", "").trim(),
                    call.getString("passwort", ""),
                    call.getString("imapHost", "").trim(), call.getInt("imapPort", 993),
                    call.getString("smtpHost", "").trim(), call.getInt("smtpPort", 587),
                    call.getString("absenderName", "").trim(),
                    call.getInt("intervall", 15));
            MailWorker.planen(getContext(), k.eingerichtet() ? k.intervall() : 0);
            call.resolve(konfigAlsJson(k));
        });
    }

    @PluginMethod
    public void testen(PluginCall call) {
        imHintergrund(call, () -> {
            dienst().testen();
            call.resolve();
        });
    }

    @PluginMethod
    public void abmelden(PluginCall call) {
        imHintergrund(call, () -> {
            dienst().konto().loeschen();
            MailWorker.planen(getContext(), 0);
            Eingang.leeren(getContext());
            call.resolve();
        });
    }

    @PluginMethod
    public void kontakteSetzen(PluginCall call) {
        JSObject kontakte = call.getObject("kontakte", new JSObject());
        imHintergrund(call, () -> {
            dienst().konto().kontakteSetzen(kontakte);
            call.resolve();
        });
    }

    @PluginMethod
    public void verlauf(PluginCall call) {
        String adresse = call.getString("adresse", "");
        int max = call.getInt("max", 10);
        imHintergrund(call, () -> {
            JSObject r = new JSObject();
            r.put("mails", dienst().verlauf(adresse, max));
            call.resolve(r);
        });
    }

    @PluginMethod
    public void jetztAbrufen(PluginCall call) {
        imHintergrund(call, () -> {
            JSObject r = new JSObject();
            r.put("neu", dienst().abrufen());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void abholen(PluginCall call) {
        imHintergrund(call, () -> {
            JSObject r = new JSObject();
            r.put("mails", Eingang.alle(getContext()));
            call.resolve(r);
        });
    }

    @PluginMethod
    public void quittieren(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        imHintergrund(call, () -> {
            Set<String> s = new HashSet<>(Eingang.ids(ids));
            Eingang.entfernen(getContext(), s);
            call.resolve();
        });
    }

    @PluginMethod
    public void senden(PluginCall call) {
        String an = call.getString("an", "");
        String betreff = call.getString("betreff", "");
        String text = call.getString("text", "");
        String inReplyTo = call.getString("inReplyTo", "");
        imHintergrund(call, () -> {
            JSObject r = new JSObject();
            r.put("mail", dienst().senden(an, betreff, text, inReplyTo));
            call.resolve(r);
        });
    }
}
