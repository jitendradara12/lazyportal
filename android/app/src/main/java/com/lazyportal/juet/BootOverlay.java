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
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.core.content.ContextCompat;

/**
 * Lightweight themed boot overlay displayed over the WebView until the web app
 * mounts (or offline.html commits). Prevents staring at an empty grey WebView
 * surface while waiting for the remote bundle on slow campus networks.
 */
final class BootOverlay {
    private static final long SPINNER_REVEAL_DELAY_MS = 350L;
    private static final long SLOW_HINT_DELAY_MS = 4_500L;
    private static final long FADE_DURATION_MS = 160L;

    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final FrameLayout root;
    private final LinearLayout progressGroup;
    private final ProgressBar spinner;
    private final TextView statusText;
    private final TextView retryButton;

    private Runnable revealSpinnerTask;
    private Runnable revealSlowHintTask;
    private boolean visible = true;
    private boolean destroyed;

    BootOverlay(Activity activity, Runnable onRetry) {
        this.activity = activity;

        root = new FrameLayout(activity);
        root.setClickable(true);
        root.setFocusable(true);

        LinearLayout center = new LinearLayout(activity);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER_HORIZONTAL);

        ImageView icon = new ImageView(activity);
        icon.setImageResource(R.mipmap.ic_launcher_round);
        icon.setContentDescription(activity.getString(R.string.app_name));
        int iconSize = dp(72);
        center.addView(icon, new LinearLayout.LayoutParams(iconSize, iconSize));

        progressGroup = new LinearLayout(activity);
        progressGroup.setOrientation(LinearLayout.VERTICAL);
        progressGroup.setGravity(Gravity.CENTER_HORIZONTAL);
        progressGroup.setAlpha(0f);
        progressGroup.setVisibility(View.INVISIBLE);
        LinearLayout.LayoutParams progressGroupParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        progressGroupParams.topMargin = dp(24);

        spinner = new ProgressBar(activity, null, android.R.attr.progressBarStyle);
        spinner.setIndeterminate(true);
        int spinnerSize = dp(28);
        progressGroup.addView(spinner, new LinearLayout.LayoutParams(spinnerSize, spinnerSize));

        statusText = new TextView(activity);
        statusText.setText("Connecting…");
        statusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        statusText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusParams.topMargin = dp(12);
        progressGroup.addView(statusText, statusParams);

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
            resetProgressState("Retrying…");
            onRetry.run();
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        retryParams.topMargin = dp(16);
        progressGroup.addView(retryButton, retryParams);

        center.addView(progressGroup, progressGroupParams);

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
        scheduleProgressReveal();
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

    void showForRecovery(String caption) {
        if (destroyed) return;
        cancelTimers();
        root.animate().cancel();
        visible = true;
        root.setAlpha(1f);
        root.setClickable(true);
        root.setVisibility(View.VISIBLE);
        resetProgressState(caption);
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
        progressGroup.animate().cancel();
        retryButton.animate().cancel();
    }

    private void resetProgressState(String caption) {
        cancelTimers();
        statusText.setText(caption);
        retryButton.animate().cancel();
        retryButton.setVisibility(View.GONE);
        retryButton.setAlpha(0f);
        progressGroup.animate().cancel();
        progressGroup.setVisibility(View.VISIBLE);
        progressGroup.setAlpha(1f);
        scheduleSlowHint();
    }

    private void scheduleProgressReveal() {
        cancelTimers();
        revealSpinnerTask = () -> {
            revealSpinnerTask = null;
            if (destroyed || !visible) return;
            progressGroup.setVisibility(View.VISIBLE);
            progressGroup.animate().alpha(1f).setDuration(FADE_DURATION_MS).start();
        };
        handler.postDelayed(revealSpinnerTask, SPINNER_REVEAL_DELAY_MS);
        scheduleSlowHint();
    }

    private void scheduleSlowHint() {
        if (revealSlowHintTask != null) {
            handler.removeCallbacks(revealSlowHintTask);
        }
        revealSlowHintTask = () -> {
            revealSlowHintTask = null;
            if (destroyed || !visible) return;
            progressGroup.setVisibility(View.VISIBLE);
            progressGroup.setAlpha(1f);
            statusText.setText("Taking longer than usual…");
            retryButton.setVisibility(View.VISIBLE);
            retryButton.animate().alpha(1f).setDuration(FADE_DURATION_MS).start();
        };
        handler.postDelayed(revealSlowHintTask, SLOW_HINT_DELAY_MS);
    }

    private void cancelTimers() {
        if (revealSpinnerTask != null) {
            handler.removeCallbacks(revealSpinnerTask);
            revealSpinnerTask = null;
        }
        if (revealSlowHintTask != null) {
            handler.removeCallbacks(revealSlowHintTask);
            revealSlowHintTask = null;
        }
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
