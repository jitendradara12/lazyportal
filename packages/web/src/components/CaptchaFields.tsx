import type { RefObject } from "react";
import type { Captcha } from "../types";

export function CaptchaFields({
  id, captcha, text, loading, solving, autoSolved, busy, attempt,
  inputRef, onChange, onRefresh, onManual,
}: {
  id: string;
  captcha: Captcha | null;
  text: string;
  loading: boolean;
  solving: boolean;
  autoSolved: boolean;
  busy: boolean;
  attempt: number;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onRefresh: () => void;
  onManual: () => void;
}) {
  return (
    <div>
      <div className="auth-captcha-group">
        <div className="auth-captcha-media-card">
          <label htmlFor={id} className="auth-field-label">Captcha</label>
          <div className="auth-captcha-media-row">
            {captcha ? (
              <img src={captcha.imageDataUrl} alt="Captcha image" className="auth-captcha-img" />
            ) : (
              <div className="auth-captcha-placeholder">
                {loading ? <span className="auth-captcha-spinner" /> : <span>Captcha unavailable</span>}
              </div>
            )}
            <button
              type="button"
              className={`auth-captcha-refresh ${loading ? "is-loading" : ""}`}
              onClick={onRefresh}
              disabled={busy || loading}
              aria-label="Refresh captcha"
              title="Refresh captcha"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="auth-field-card auth-captcha-input-card">
          <input
            id={id}
            ref={inputRef}
            required
            disabled={busy || !captcha}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            value={text}
            onChange={(e) => onChange(e.target.value.replace(/\s/g, "").toLowerCase().slice(0, 5))}
            placeholder="Enter the 5 characters"
            aria-describedby={`${id}-status`}
            className="auth-input"
          />
        </div>
      </div>
      <div className="auth-captcha-status">
        <span id={`${id}-status`} role="status" aria-live="polite">
          {busy && attempt > 1 ? `Trying another image (${attempt})…`
            : solving ? "Reading the image…"
            : autoSolved ? "Filled automatically. You can edit it."
            : loading ? "Loading captcha…"
            : "Type the characters above."}
        </span>
        {solving && captcha && !busy && (
          <button type="button" className="auth-captcha-manual" onClick={onManual}>Type it myself</button>
        )}
      </div>
    </div>
  );
}
