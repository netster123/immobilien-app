package io.github.netster123.immobilien;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.text.Html;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.sun.mail.imap.IMAPFolder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.TimeZone;

import javax.mail.Address;
import javax.mail.AuthenticationFailedException;
import javax.mail.FetchProfile;
import javax.mail.Flags;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.Transport;
import javax.mail.UIDFolder;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import javax.mail.search.FromStringTerm;
import javax.mail.search.OrTerm;
import javax.mail.search.RecipientStringTerm;
import javax.mail.search.SearchTerm;

/** Abrufen (IMAP) und Senden (SMTP) von E-Mails, z. B. bei GMX. */
public class MailDienst {
    private static final Object SPERRE = new Object();
    private static final String KANAL = "mails";
    private static final int TEXT_MAX = 8000;

    private final Context ctx;
    private final MailKonto konto;

    public MailDienst(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.konto = new MailKonto(this.ctx);
    }

    public MailKonto konto() { return konto; }

    // ---------- Verbindung ----------

    private Properties grundEinstellungen() {
        Properties p = new Properties();
        p.put("mail.imaps.connectiontimeout", "20000");
        p.put("mail.imaps.timeout", "40000");
        p.put("mail.smtp.connectiontimeout", "20000");
        p.put("mail.smtp.timeout", "40000");
        p.put("mail.mime.charset", "UTF-8");
        return p;
    }

    private Store imap() throws MessagingException {
        if (!konto.eingerichtet()) throw new MessagingException("Kein E-Mail-Konto eingerichtet.");
        Session s = Session.getInstance(grundEinstellungen());
        Store st = s.getStore("imaps");
        st.connect(konto.imapHost(), konto.imapPort(), konto.email(), konto.passwort());
        return st;
    }

    private Session smtpSitzung() {
        Properties p = grundEinstellungen();
        p.put("mail.smtp.host", konto.smtpHost());
        p.put("mail.smtp.port", String.valueOf(konto.smtpPort()));
        p.put("mail.smtp.auth", "true");
        if (konto.smtpPort() == 465) {
            p.put("mail.smtp.ssl.enable", "true");
        } else {
            p.put("mail.smtp.starttls.enable", "true");
            p.put("mail.smtp.starttls.required", "true");
        }
        return Session.getInstance(p);
    }

    /** Sucht den Ordner für gesendete Mails (bei GMX „Gesendet“). */
    private Folder gesendetOrdner(Store st) throws MessagingException {
        for (Folder f : st.getDefaultFolder().list("*")) {
            if (f instanceof IMAPFolder) {
                String[] attr = ((IMAPFolder) f).getAttributes();
                if (attr != null) for (String a : attr) if ("\\Sent".equalsIgnoreCase(a)) return f;
            }
        }
        for (String name : new String[]{"Gesendet", "Sent", "Gesendete Objekte", "Sent Items", "INBOX.Sent"}) {
            Folder f = st.getFolder(name);
            if (f.exists()) return f;
        }
        return null;
    }

    public void testen() throws Exception {
        Store st = imap();
        st.close();
        Transport t = smtpSitzung().getTransport("smtp");
        t.connect(konto.smtpHost(), konto.smtpPort(), konto.email(), konto.passwort());
        t.close();
    }

    public static String fehlertext(Exception e) {
        if (e instanceof AuthenticationFailedException) {
            return "Anmeldung abgelehnt. Bitte E-Mail und Passwort prüfen. Bei GMX außerdem im Postfach unter "
                    + "Einstellungen → POP3/IMAP Abruf den Zugriff per IMAP erlauben.";
        }
        String m = e.getMessage();
        Throwable c = e.getCause();
        if (c != null && c.getMessage() != null) m = (m == null ? "" : m + ": ") + c.getMessage();
        return m == null ? e.getClass().getSimpleName() : m;
    }

    // ---------- Umwandlung ----------

    private static String iso(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(d == null ? new Date() : d);
    }

    private static String adressen(Address[] a) {
        if (a == null) return "";
        StringBuilder sb = new StringBuilder();
        for (Address x : a) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(x instanceof InternetAddress ? ((InternetAddress) x).toUnicodeString() : x.toString());
        }
        return sb.toString();
    }

    private static String finde(Part p, String typ) throws Exception {
        if (p.isMimeType(typ) && !Part.ATTACHMENT.equalsIgnoreCase(p.getDisposition())) {
            Object c = p.getContent();
            return c instanceof String ? (String) c : null;
        }
        if (p.isMimeType("multipart/*")) {
            Multipart mp = (Multipart) p.getContent();
            for (int i = 0; i < mp.getCount(); i++) {
                String t = finde(mp.getBodyPart(i), typ);
                if (t != null) return t;
            }
        }
        return null;
    }

    private static String text(Part p) {
        try {
            String t = finde(p, "text/plain");
            if (t != null) return t;
            String h = finde(p, "text/html");
            if (h != null) return Html.fromHtml(h, Html.FROM_HTML_MODE_COMPACT).toString();
        } catch (Exception ignored) { }
        return "";
    }

    private static String messageId(Message m) throws MessagingException {
        String[] h = m.getHeader("Message-ID");
        return h != null && h.length > 0 ? h[0].trim() : "";
    }

    private JSONObject alsJson(Message m, boolean eingehend, String adresse, String id) throws Exception {
        JSONObject o = new JSONObject();
        String mid = messageId(m);
        Date d = m.getSentDate();
        if (d == null) d = m.getReceivedDate();
        String t = text(m);
        if (t.length() > TEXT_MAX) t = t.substring(0, TEXT_MAX) + " …";
        o.put("id", mid.isEmpty() ? id : mid);
        o.put("messageId", mid);
        o.put("datum", iso(d));
        o.put("von", adressen(m.getFrom()));
        o.put("an", adressen(m.getRecipients(Message.RecipientType.TO)));
        o.put("betreff", m.getSubject() == null ? "" : m.getSubject());
        o.put("text", t);
        o.put("eingehend", eingehend);
        o.put("adresse", adresse);
        return o;
    }

    /** Erste Adresse der Mail (Absender/Empfänger), die zu einem bekannten Eigentümer gehört. */
    private static String passendeAdresse(Message m, Map<String, String> kontakte, boolean eingehend) throws MessagingException {
        List<Address> liste = new ArrayList<>();
        if (eingehend) {
            if (m.getFrom() != null) Collections.addAll(liste, m.getFrom());
        } else {
            Address[] alle = m.getAllRecipients();
            if (alle != null) Collections.addAll(liste, alle);
        }
        for (Address a : liste) {
            if (a instanceof InternetAddress) {
                String adr = ((InternetAddress) a).getAddress();
                if (adr != null && kontakte.containsKey(adr.toLowerCase())) return adr.toLowerCase();
            }
        }
        return null;
    }

    // ---------- Verlauf mit einer Adresse ----------

    public JSONArray verlauf(String adresse, int max) throws Exception {
        synchronized (SPERRE) {
            Store st = imap();
            try {
                List<JSONObject> alle = new ArrayList<>();
                SearchTerm suche = new OrTerm(new SearchTerm[]{
                        new FromStringTerm(adresse),
                        new RecipientStringTerm(Message.RecipientType.TO, adresse),
                        new RecipientStringTerm(Message.RecipientType.CC, adresse),
                });
                sucheIn(st.getFolder("INBOX"), true, suche, adresse, max, alle);
                Folder g = gesendetOrdner(st);
                if (g != null) sucheIn(g, false, suche, adresse, max, alle);
                Collections.sort(alle, (a, b) -> b.optString("datum").compareTo(a.optString("datum")));
                JSONArray erg = new JSONArray();
                for (int i = 0; i < Math.min(max, alle.size()); i++) erg.put(alle.get(i));
                return erg;
            } finally {
                st.close();
            }
        }
    }

    private void sucheIn(Folder f, boolean eingehend, SearchTerm suche, String adresse, int max, List<JSONObject> ziel) throws Exception {
        f.open(Folder.READ_ONLY);
        try {
            Message[] treffer = f.search(suche);
            int start = Math.max(0, treffer.length - max);
            for (int i = treffer.length - 1; i >= start; i--) {
                Message m = treffer[i];
                String id = f.getFullName() + "-" + (f instanceof UIDFolder ? ((UIDFolder) f).getUID(m) : m.getMessageNumber());
                ziel.add(alsJson(m, eingehend, adresse.toLowerCase(), id));
            }
        } finally {
            f.close(false);
        }
    }

    // ---------- Regelmäßiger Abruf ----------

    /** Holt neue Mails von/an bekannte Eigentümer in den Eingang. Liefert die Anzahl neuer Mails. */
    public int abrufen() throws Exception {
        synchronized (SPERRE) {
            Map<String, String> kontakte = konto.kontakte();
            if (!konto.eingerichtet()) return 0;
            Store st = imap();
            try {
                int neu = ordnerAbrufen((IMAPFolder) st.getFolder("INBOX"), "in", true, kontakte);
                Folder g = gesendetOrdner(st);
                if (g instanceof IMAPFolder) neu += ordnerAbrufen((IMAPFolder) g, "aus", false, kontakte);
                return neu;
            } finally {
                st.close();
            }
        }
    }

    private int ordnerAbrufen(IMAPFolder f, String schluessel, boolean eingehend, Map<String, String> kontakte) throws Exception {
        f.open(Folder.READ_ONLY);
        try {
            long gueltig = f.getUIDValidity();
            long letzteJetzt = f.getUIDNext() - 1;
            if (letzteJetzt < 0) {
                int n = f.getMessageCount();
                letzteJetzt = n > 0 ? f.getUID(f.getMessage(n)) : 0;
            }
            long gespeichertGueltig = konto.zahl("uidv_" + schluessel, -1);
            long letzte = konto.zahl("uid_" + schluessel, -1);
            // Erster Abruf oder Postfach neu aufgebaut: ab jetzt beobachten, alte Mails holt der Verlauf.
            if (gespeichertGueltig != gueltig || letzte < 0) {
                konto.zahlSetzen("uidv_" + schluessel, gueltig);
                konto.zahlSetzen("uid_" + schluessel, letzteJetzt);
                return 0;
            }
            if (letzteJetzt <= letzte) return 0;

            Message[] mails = f.getMessagesByUID(letzte + 1, UIDFolder.LASTUID);
            FetchProfile fp = new FetchProfile();
            fp.add(FetchProfile.Item.ENVELOPE);
            fp.add(UIDFolder.FetchProfileItem.UID);
            f.fetch(mails, fp);

            int neu = 0;
            long hoechste = letzte;
            for (Message m : mails) {
                if (m == null) continue;
                long uid = f.getUID(m);
                if (uid <= letzte) continue;
                hoechste = Math.max(hoechste, uid);
                String adr = passendeAdresse(m, kontakte, eingehend);
                if (adr == null) continue;
                JSONObject o = alsJson(m, eingehend, adr, schluessel + "-" + gueltig + "-" + uid);
                Eingang.hinzufuegen(ctx, o);
                neu++;
                if (eingehend) benachrichtigen(o, kontakte.get(adr));
            }
            konto.zahlSetzen("uid_" + schluessel, Math.max(hoechste, letzteJetzt));
            return neu;
        } finally {
            f.close(false);
        }
    }

    private void benachrichtigen(JSONObject mail, String name) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(KANAL) == null) {
            nm.createNotificationChannel(new NotificationChannel(KANAL, "Neue E-Mails von Eigentümern",
                    NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent oeffnen = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, oeffnen,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, KANAL)
                .setSmallIcon(android.R.drawable.sym_action_email)
                .setContentTitle("Neue E-Mail von " + (name == null || name.isEmpty() ? mail.optString("von") : name))
                .setContentText(mail.optString("betreff"))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(mail.optString("betreff") + "\n"
                        + mail.optString("text").substring(0, Math.min(300, mail.optString("text").length()))))
                .setContentIntent(pi)
                .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(mail.optString("id").hashCode(), b.build());
        } catch (SecurityException ignored) { }
    }

    // ---------- Senden ----------

    public JSONObject senden(String an, String betreff, String text, String inReplyTo) throws Exception {
        Session s = smtpSitzung();
        MimeMessage m = new MimeMessage(s);
        String name = konto.absenderName();
        m.setFrom(new InternetAddress(konto.email(), name.isEmpty() ? null : name, "UTF-8"));
        m.setRecipients(Message.RecipientType.TO, InternetAddress.parse(an));
        m.setSubject(betreff, "UTF-8");
        m.setText(text, "UTF-8");
        m.setSentDate(new Date());
        if (inReplyTo != null && !inReplyTo.isEmpty()) {
            m.setHeader("In-Reply-To", inReplyTo);
            m.setHeader("References", inReplyTo);
        }
        m.saveChanges();
        Transport.send(m, konto.email(), konto.passwort());

        // Kopie in „Gesendet“ ablegen, damit sie auch im GMX-Postfach auftaucht.
        try {
            synchronized (SPERRE) {
                Store st = imap();
                try {
                    Folder g = gesendetOrdner(st);
                    if (g != null) {
                        m.setFlag(Flags.Flag.SEEN, true);
                        g.appendMessages(new Message[]{m});
                    }
                } finally {
                    st.close();
                }
            }
        } catch (Exception ignored) { }

        String adr = an;
        try { adr = InternetAddress.parse(an)[0].getAddress(); } catch (Exception ignored) { }
        return alsJson(m, false, adr.toLowerCase(), "gesendet-" + System.currentTimeMillis());
    }
}
