package com.lazyportal.juet;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.core.content.ContextCompat;

/**
 * Lightweight themed fallback overlay shown ONLY if boot takes longer than the
 * initial system splash window (or during warm-resume recovery). Uses the exact
 * same DayNight surface colour as the system splash and web app so transitions
 * never flicker or show a second competing logo splash.
 */
final class BootOverlay {
    private static final long SLOW_HINT_DELAY_MS = 3_500L;
    private static final long FADE_DURATION_MS = 160L;

    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final FrameLayout root;
    private final ProgressBar spinner;
    private final TextView statusText;
    private final TextView retryButton;

    private Runnable revealSlowHintTask;
    private boolean visible;
    private boolean destroyed;

    BootOverlay(Activity activity, Runnable onRetry) {
        this.activity = activity;

        root = new FrameLayout(activity);
        root.setVisibility(View.GONE);
        root.setClickable(false);
        root.setFocusable(false);

        LinearLayout center = new LinearLayout(activity);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER_HORIZONTAL);

        spinner = new ProgressBar(activity, null, android.R.attr.progressBarStyle);
        spinner.setIndeterminate(true);
        int spinnerSize = dp(30);
        center.addView(spinner, new LinearLayout.LayoutParams(spinnerSize, spinnerSize));

        statusText = new TextView(activity);
        statusText.setText("Connecting…");
        statusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        statusText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusParams.topMargin = dp(14);
        center.addView(statusText, statusParams);

        retryButton = new TextView(activity);
        retryButton.setText("Retry");
        retryButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        retryButton.setTypeface(Typeface.DEFAULT_BOLD);
        retryButton.setGravity(Gravity.CENTER);
        retryButton.setPadding(dp(24), dp(12), dp(24), dp(12));
        retryButton.setMinHeight(dp(44));
        retryButton.setClickable(true);
        retryButton.setFocusable(true);
        retryButton.setVisibility(View.GONE);
        retryButton.setOnClickListener(v -> {
            if (destroyed) return;
            show("Retrying…");
            onRetry.run();
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        retryParams.topMargin = dp(16);
        center.addView(retryButton, retryParams);

        FrameLayout.LayoutParams centerParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        root.addView(center, centerParams);

        applyTheme();
    }

    void attachTo(ViewGroup container) {
        if (destroyed || container == null || root.getParent() != null) return;
        container.addView(
            root,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
    }

    void applyTheme() {
        if (destroyed) return;
        int surface = ContextCompat.getColor(activity, R.color.app_surface);
        int onSurfaceVariant = ContextCompat.getColor(activity, R.color.app_on_surface_variant);
        int accent = ContextCompat.getColor(activity, R.color.app_accent);
        int onAccent = ContextCompat.getColor(activity, R.color.app_on_accent);

        root.setBackgroundColor(surface);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(accent));
        statusText.setTextColor(onSurfaceVariant);
        retryButton.setTextColor(onAccent);

        GradientDrawable pill = new GradientDrawable();
        pill.setShape(GradientDrawable.RECTANGLE);
        pill.setCornerRadius(dp(999));
        pill.setColor(accent);
        GradientDrawable mask = new GradientDrawable();
        mask.setShape(GradientDrawable.RECTANGLE);
        mask.setCornerRadius(dp(999));
        mask.setColor(0xFFFFFFFF);
        int rippleColor = (onAccent & 0x00FFFFFF) | 0x33000000;
        retryButton.setBackground(new RippleDrawable(ColorStateList.valueOf(rippleColor), pill, mask));
    }

    void show(String caption) {
        if (destroyed) return;
        cancelTimers();
        root.animate().cancel();
        visible = true;
        statusText.setText(caption);
        retryButton.animate().cancel();
        retryButton.setVisibility(View.GONE);
        retryButton.setAlpha(0f);
        root.setAlpha(1f);
        root.setClickable(true);
        root.setFocusable(true);
        root.setVisibility(View.VISIBLE);
        scheduleSlowHint();
    }

    void setStatus(String caption) {
        if (destroyed || !visible) return;
        statusText.setText(caption);
    }

    void dismiss() {
        if (destroyed || !visible) return;
        visible = false;
        cancelTimers();
        root.setClickable(false);
        root.setFocusable(false);
        root.animate().cancel();
        root.animate()
            .alpha(0f)
            .setDuration(FADE_DURATION_MS)
            .withEndAction(() -> {
                if (!destroyed && !visible) {
                    root.setVisibility(View.GONE);
                }
            })
            .start();
    }

    boolean isVisible() {
        return visible;
    }

    void destroy() {
        destroyed = true;
        visible = false;
        cancelTimers();
        root.animate().cancel();
        retryButton.animate().cancel();
    }

    private void scheduleSlowHint() {
        cancelTimers();
        revealSlowHintTask = () -> {
            revealSlowHintTask = null;
            if (destroyed || !visible) return;
            statusText.setText("Taking longer than usual…");
            retryButton.setVisibility(View.VISIBLE);
            retryButton.animate().alpha(1f).setDuration(FADE_DURATION_MS).start();
        };
        handler.postDelayed(revealSlowHintTask, SLOW_HINT_DELAY_MS);
    }

    private void cancelTimers() {
        if (revealSlowHintTask != null) {
            handler.removeCallbacks(revealSlowHintTask);
            revealSlowHintTask = null;
        }
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
