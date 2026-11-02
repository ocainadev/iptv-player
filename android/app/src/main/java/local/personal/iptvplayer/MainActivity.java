package local.personal.iptvplayer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate.
        registerPlugin(TvModePlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(ExternalLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
