package local.personal.iptvplayer;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// In-app update: downloads the release APK into the app cache and hands it to the system
// installer. Android always asks the user to confirm an install, and the user must allow
// "install unknown apps" for this app once.
@CapacitorPlugin(name = "ApkUpdate")
public class ApkUpdatePlugin extends Plugin {
    // Keep in sync with the repository in src/main/updater.js and lib/androidUpdate.js.
    private static final String ALLOWED = "https://github.com/ocainadev/telara/";
    // Debug builds may also fetch from the emulator host, to test with a local mock release.
    private static final String DEBUG_ALLOWED = "http://10.0.2.2:";

    private File apk;

    private boolean isDebuggable() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private boolean allowed(String url) {
        return url != null && (url.startsWith(ALLOWED) || (isDebuggable() && url.startsWith(DEBUG_ALLOWED)));
    }

    @PluginMethod
    public void download(PluginCall call) {
        String link = call.getString("url");
        if (!allowed(link)) {
            call.reject("link not allowed");
            return;
        }
        new Thread(() -> {
            File dir = new File(getContext().getCacheDir(), "update");
            deleteRecursively(dir);
            dir.mkdirs();
            File part = new File(dir, "app.apk.part");
            File done = new File(dir, "app.apk");
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(link).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "iptv-player-updater");
                conn.setInstanceFollowRedirects(true);
                if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
                long total = conn.getContentLengthLong();
                long received = 0;
                int lastPercent = -1;
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                    byte[] buffer = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buffer)) > 0) {
                        out.write(buffer, 0, n);
                        received += n;
                        int percent = total > 0 ? (int) (received * 100 / total) : 0;
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject data = new JSObject();
                            data.put("percent", percent);
                            notifyListeners("progress", data);
                        }
                    }
                }
                if (received < 1024 * 1024 || (total > 0 && received != total) || !part.renameTo(done)) {
                    throw new Exception("incomplete download");
                }
                apk = done;
                call.resolve();
            } catch (Exception e) {
                part.delete();
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        Context context = getContext();
        if (apk == null || !apk.exists()) {
            call.reject("no downloaded update");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
            openUnknownSourcesSettings(context);
            call.reject("permission", "permission");
            return;
        }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no installer");
        }
    }

    // The per-app screen exists on phones; some TV builds only have the general security screen.
    private void openUnknownSourcesSettings(Context context) {
        Intent specific = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(specific);
        } catch (ActivityNotFoundException e) {
            try {
                context.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException ignored) {
                // nothing to open: the message in the app explains what to enable
            }
        }
    }

    private void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }
}
