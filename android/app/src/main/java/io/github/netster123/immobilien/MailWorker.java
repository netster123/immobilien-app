package io.github.netster123.immobilien;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

import javax.mail.AuthenticationFailedException;

/** Ruft im Hintergrund regelmäßig das Postfach ab (Android erlaubt minimal alle 15 Minuten). */
public class MailWorker extends Worker {
    private static final String NAME = "mailabruf";

    public MailWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            int neu = new MailDienst(getApplicationContext()).abrufen();
            Log.i("MailWorker", "Abruf fertig, neue Mails: " + neu);
            return Result.success();
        } catch (AuthenticationFailedException e) {
            Log.w("MailWorker", "Anmeldung abgelehnt", e);
            return Result.failure();
        } catch (Exception e) {
            Log.w("MailWorker", "Abruf fehlgeschlagen", e);
            return Result.retry();
        }
    }

    public static void planen(Context ctx, int minuten) {
        WorkManager wm = WorkManager.getInstance(ctx.getApplicationContext());
        if (minuten <= 0) {
            wm.cancelUniqueWork(NAME);
            return;
        }
        PeriodicWorkRequest anfrage = new PeriodicWorkRequest.Builder(MailWorker.class, Math.max(15, minuten), TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, anfrage);
    }
}
