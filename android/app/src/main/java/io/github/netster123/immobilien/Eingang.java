package io.github.netster123.immobilien;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/** Zwischenspeicher für im Hintergrund abgerufene Mails, bis die App sie übernimmt. */
public final class Eingang {
    private static final String DATEI = "eingang.json";

    private Eingang() { }

    private static File datei(Context ctx) { return new File(ctx.getFilesDir(), DATEI); }

    public static synchronized JSONArray alle(Context ctx) {
        File f = datei(ctx);
        if (!f.exists()) return new JSONArray();
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int gelesen = 0;
            while (gelesen < b.length) {
                int n = in.read(b, gelesen, b.length - gelesen);
                if (n < 0) break;
                gelesen += n;
            }
            return new JSONArray(new String(b, 0, gelesen, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void schreiben(Context ctx, JSONArray a) throws Exception {
        try (FileOutputStream out = new FileOutputStream(datei(ctx))) {
            out.write(a.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    public static synchronized void hinzufuegen(Context ctx, JSONObject mail) throws Exception {
        JSONArray a = alle(ctx);
        String id = mail.optString("id");
        for (int i = 0; i < a.length(); i++) {
            if (id.equals(a.getJSONObject(i).optString("id"))) return;
        }
        a.put(mail);
        // Nicht unbegrenzt wachsen lassen.
        while (a.length() > 500) a.remove(0);
        schreiben(ctx, a);
    }

    public static synchronized void entfernen(Context ctx, Set<String> ids) throws Exception {
        JSONArray a = alle(ctx);
        JSONArray rest = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.getJSONObject(i);
            if (!ids.contains(o.optString("id"))) rest.put(o);
        }
        schreiben(ctx, rest);
    }

    public static synchronized void leeren(Context ctx) {
        //noinspection ResultOfMethodCallIgnored
        datei(ctx).delete();
    }

    public static Set<String> ids(JSONArray a) {
        Set<String> s = new HashSet<>();
        for (int i = 0; i < a.length(); i++) s.add(a.optString(i));
        return s;
    }
}
