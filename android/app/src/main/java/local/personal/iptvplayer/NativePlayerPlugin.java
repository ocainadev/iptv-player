package local.personal.iptvplayer;

import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Format;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import com.getcapacitor.JSArray;
import java.util.Locale;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Plays video with ExoPlayer (Media3): HEVC, AC3, MKV, MPEG-TS and HLS that the
// WebView cannot decode. The PlayerView sits behind the (transparent) WebView, at
// the rectangle the page reports for its player slot, so the page keeps drawing
// the toolbar, spinner and error messages on top of the picture.
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    private static final String USER_AGENT = "IPTVPlayer/1.0 (Linux; Android)";
    private static final int APP_BACKGROUND = Color.parseColor("#0f1115");

    // Read-ahead buffer (ExoPlayer defaults are 50 s max; size cap stays at its default).
    private static final int MIN_BUFFER_MS = 30_000;
    private static final int MAX_BUFFER_MS = 120_000;
    private static final int BUFFER_FOR_PLAYBACK_MS = 2_500;
    private static final int BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 5_000;
    // Auto reconnect when a stream that already played stays in BUFFERING.
    private static final long STALL_RECONNECT_MS = 8_000;
    private static final int MAX_RECONNECTS = 3;
    private static final long STABLE_RESET_MS = 30_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PlayerView view;
    private boolean live;
    // Per player instance (reset in release()).
    private boolean hasPlayed;
    private boolean userSeeking;
    // Per stream (reset in load/handleOnResume/stop).
    private int reconnects;
    private TrackSelectionParameters pendingTrackParams;

    private final Runnable stallReconnect = new Runnable() {
        @Override
        public void run() {
            if (player == null || lastUrl == null) return;
            if (player.getPlaybackState() != Player.STATE_BUFFERING || !player.getPlayWhenReady()) return;
            if (reconnects >= MAX_RECONNECTS) return;
            reconnects++;
            double at = live ? 0 : player.getCurrentPosition() / 1000.0;
            pendingTrackParams = player.getTrackSelectionParameters();
            start(lastUrl, at, true);
            // Let a reconnect that hangs in its first buffering be retried too (counts toward the cap).
            hasPlayed = true;
        }
    };

    private final Runnable stableReset = new Runnable() {
        @Override
        public void run() {
            reconnects = 0;
        }
    };

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            JSObject data = new JSObject();
            data.put("position", player.getCurrentPosition() / 1000.0);
            long duration = player.getDuration();
            data.put("duration", duration == C.TIME_UNSET ? -1 : duration / 1000.0);
            data.put("playing", player.isPlaying());
            notifyListeners("time", data);
            main.postDelayed(this, 500);
        }
    };

    private final Player.Listener listener = new Player.Listener() {
        // The screen must not turn off while the video plays (the user may not touch the phone).
        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            keepScreenOn(isPlaying);
            main.removeCallbacks(stableReset);
            if (isPlaying && reconnects > 0) main.postDelayed(stableReset, STABLE_RESET_MS);
        }

        @Override
        public void onPlaybackStateChanged(int state) {
            main.removeCallbacks(stallReconnect);
            if (state == Player.STATE_READY) {
                hasPlayed = true;
                userSeeking = false;
            } else if (state == Player.STATE_BUFFERING && hasPlayed && !userSeeking
                    && reconnects < MAX_RECONNECTS) {
                main.postDelayed(stallReconnect, STALL_RECONNECT_MS);
            }
            JSObject data = new JSObject();
            data.put("state", state == Player.STATE_BUFFERING ? "buffering" : state == Player.STATE_ENDED ? "ended" : state == Player.STATE_READY ? "ready" : "idle");
            notifyListeners("state", data);
        }

        @Override
        public void onTracksChanged(Tracks tracks) {
            notifyListeners("tracks", describeTracks(tracks));
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            JSObject data = new JSObject();
            data.put("message", error.getErrorCodeName());
            // Network problems are worth a retry; decoder/format problems are not.
            data.put("network", error.errorCode >= 2000 && error.errorCode < 3000);
            notifyListeners("error", data);
        }
    };

    // Audio and subtitle tracks the stream offers. An id is "<group>:<track>" into
    // Tracks.getGroups(), which selectTrack() resolves again.
    private JSObject describeTracks(Tracks tracks) {
        JSArray audio = new JSArray();
        JSArray text = new JSArray();
        for (int g = 0; g < tracks.getGroups().size(); g++) {
            Tracks.Group group = tracks.getGroups().get(g);
            int type = group.getType();
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
            for (int t = 0; t < group.length; t++) {
                if (!group.isTrackSupported(t)) continue;
                Format format = group.getTrackFormat(t);
                String label = format.label;
                if (label == null && format.language != null && !"und".equals(format.language)) {
                    label = new Locale(format.language).getDisplayLanguage(new Locale("pt", "BR"));
                }
                JSObject item = new JSObject();
                item.put("id", g + ":" + t);
                item.put("label", label);
                item.put("selected", group.isTrackSelected(t));
                (type == C.TRACK_TYPE_AUDIO ? audio : text).put(item);
            }
        }
        JSObject data = new JSObject();
        data.put("audio", audio);
        data.put("text", text);
        return data;
    }

    // kind: "audio" | "text"; id: from describeTracks, empty = turn subtitles off.
    @PluginMethod
    public void selectTrack(PluginCall call) {
        String kind = call.getString("kind", "");
        String id = call.getString("id", "");
        ui(() -> {
            if (player == null) return;
            int type = "audio".equals(kind) ? C.TRACK_TYPE_AUDIO : C.TRACK_TYPE_TEXT;
            androidx.media3.common.TrackSelectionParameters.Builder params = player.getTrackSelectionParameters().buildUpon();
            if (id.isEmpty()) {
                params.setTrackTypeDisabled(type, true);
            } else {
                String[] parts = id.split(":");
                Tracks.Group group = player.getCurrentTracks().getGroups().get(Integer.parseInt(parts[0]));
                TrackGroup mediaGroup = group.getMediaTrackGroup();
                params.setTrackTypeDisabled(type, false)
                    .setOverrideForType(new TrackSelectionOverride(mediaGroup, Integer.parseInt(parts[1])));
            }
            player.setTrackSelectionParameters(params.build());
        });
        call.resolve();
    }

    private void ui(Runnable action) {
        getActivity().runOnUiThread(action);
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url required");
            return;
        }
        live = Boolean.TRUE.equals(call.getBoolean("live", false));
        reconnects = 0;
        double startAt = call.getDouble("startAt", 0.0);
        boolean autoPlay = call.getBoolean("autoPlay", true);
        ui(() -> {
            start(url, startAt, autoPlay);
            call.resolve();
        });
    }

    // Builds the player and view and starts the stream. Runs on the UI thread.
    private void start(String url, double startAt, boolean autoPlay) {
        lastUrl = url;
        {
            release();
            ViewGroup parent = (ViewGroup) getBridge().getWebView().getParent();
            parent.setBackgroundColor(APP_BACKGROUND);
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);

            DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000);
            DefaultRenderersFactory renderers = new DefaultRenderersFactory(getContext())
                .setEnableDecoderFallback(true);
            player = new ExoPlayer.Builder(getContext(), renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(getContext()).setDataSourceFactory(http))
                .setLoadControl(new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(MIN_BUFFER_MS, MAX_BUFFER_MS, BUFFER_FOR_PLAYBACK_MS, BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS)
                    .build())
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
                .build();
            player.addListener(listener);
            if (pendingTrackParams != null) {
                player.setTrackSelectionParameters(pendingTrackParams);
                pendingTrackParams = null;
            }

            view = new PlayerView(getContext());
            view.setUseController(false);
            view.setBackgroundColor(Color.BLACK);
            view.setPlayer(player);
            view.setFocusable(false);
            // Index 0 = behind the WebView.
            parent.addView(view, 0, new CoordinatorLayout.LayoutParams(0, 0));
            applyRect();

            player.setMediaItem(MediaItem.fromUri(url), live || startAt <= 0 ? C.TIME_UNSET : (long) (startAt * 1000));
            player.setPlayWhenReady(autoPlay);
            player.prepare();
            main.removeCallbacks(ticker);
            main.post(ticker);
        }
    }

    // The app went to the background: the stream is released so the provider's
    // connection closes, and it is rebuilt at the same spot (paused) on return.
    private String lastUrl;
    private String resumeUrl;
    private double resumeAt;

    @Override
    protected void handleOnPause() {
        if (player == null || lastUrl == null) return;
        resumeUrl = lastUrl;
        resumeAt = live ? 0 : player.getCurrentPosition() / 1000.0;
        release();
    }

    @Override
    protected void handleOnResume() {
        if (resumeUrl == null) return;
        String url = resumeUrl;
        resumeUrl = null;
        reconnects = 0;
        if (player == null) start(url, resumeAt, false);
    }

    // Rectangle in CSS pixels, plus fit mode (contain|cover|fill) and zoom. The page
    // may report it before load() has created the view, so it is remembered.
    private double rx, ry, rw, rh, zoom = 1.0;
    private String fit = "contain";

    @PluginMethod
    public void setRect(PluginCall call) {
        rx = call.getDouble("x", 0.0);
        ry = call.getDouble("y", 0.0);
        rw = call.getDouble("width", 0.0);
        rh = call.getDouble("height", 0.0);
        fit = call.getString("fit", "contain");
        zoom = call.getDouble("zoom", 1.0);
        ui(this::applyRect);
        call.resolve();
    }

    private void applyRect() {
        if (view == null) return;
        float density = getContext().getResources().getDisplayMetrics().density;
        CoordinatorLayout.LayoutParams lp = new CoordinatorLayout.LayoutParams(Math.round((float) (rw * density)), Math.round((float) (rh * density)));
        lp.leftMargin = Math.round((float) (rx * density));
        lp.topMargin = Math.round((float) (ry * density));
        view.setLayoutParams(lp);
        view.setResizeMode("cover".equals(fit) ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            : "fill".equals(fit) ? AspectRatioFrameLayout.RESIZE_MODE_FILL
            : AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setScaleX((float) zoom);
        view.setScaleY((float) zoom);
        view.setVisibility(rw > 0 && rh > 0 ? View.VISIBLE : View.INVISIBLE);
    }

    @PluginMethod
    public void play(PluginCall call) {
        ui(() -> {
            if (player != null) player.play();
        });
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        ui(() -> {
            if (player != null) player.pause();
        });
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        double position = call.getDouble("position", 0.0);
        ui(() -> {
            if (player != null) {
                userSeeking = true;
                player.seekTo((long) (position * 1000));
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        resumeUrl = null;
        lastUrl = null;
        ui(() -> {
            pendingTrackParams = null;
            release();
        });
        call.resolve();
    }

    private void keepScreenOn(boolean on) {
        if (getActivity() == null) return;
        if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void release() {
        keepScreenOn(false);
        main.removeCallbacks(ticker);
        main.removeCallbacks(stallReconnect);
        main.removeCallbacks(stableReset);
        hasPlayed = false;
        userSeeking = false;
        if (player != null) {
            player.removeListener(listener);
            player.release();
            player = null;
        }
        if (view != null) {
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
            view = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        release();
    }
}
