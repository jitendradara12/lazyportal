import { useEffect } from "react";

/** Fit auth screens to the visible viewport, including WebViews resized for the IME. */
export function useKeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let fullHeight = window.innerHeight;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        fullHeight = Math.max(fullHeight, window.innerHeight);
        const field = document.activeElement;
        const editing = field instanceof HTMLElement && field.matches("input:not([type=checkbox]), textarea, [contenteditable=true]");
        const height = viewport?.height ?? window.innerHeight;
        const top = viewport?.offsetTop ?? 0;
        const open = editing && (viewport?.scale ?? 1) === 1 && fullHeight - height > 150;
        root.toggleAttribute("data-keyboard-open", open);
        root.style.setProperty("--keyboard-viewport-height", `${height}px`);
        root.style.setProperty("--keyboard-viewport-top", `${top}px`);
        if (open && field instanceof HTMLElement) {
          const target = field.closest<HTMLElement>(".auth-captcha-group") ?? field.closest<HTMLElement>(".auth-field-card") ?? field;
          const bounds = target.getBoundingClientRect();
          const minTop = top + 16;
          const maxBottom = top + height - 16;
          if (bounds.bottom > maxBottom) {
            // Scroll only far enough to lift the bottom above the keyboard, never pushing the top (e.g. Captcha image) off-screen if avoidable.
            const delta = Math.min(bounds.bottom - maxBottom, Math.max(0, bounds.top - minTop));
            if (delta > 0) window.scrollBy({ top: delta, behavior: "instant" });
          } else if (bounds.top < minTop) {
            window.scrollBy({ top: bounds.top - minTop, behavior: "instant" });
          }
        }
      });
    };
    const rotate = () => { fullHeight = window.innerHeight; update(); };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", rotate);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", rotate);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.removeAttribute("data-keyboard-open");
      root.style.removeProperty("--keyboard-viewport-height");
      root.style.removeProperty("--keyboard-viewport-top");
    };
  }, []);
}
