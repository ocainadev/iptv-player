package local.personal.iptvplayer;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Opens the release download in the system browser, which downloads the APK and
// hands it to the package installer. Only links into this project's GitHub repo.
@CapacitorPlugin(name = "ExternalLink")
public class ExternalLinkPlugin extends Plugin {
    private static final String ALLOWED_PREFIX = "https://github.com/ocainadev/iptv-player/";

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith(ALLOWED_PREFIX)) {
            call.reject("link not allowed");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("no app can open this link");
        }
    }
}
