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
          const bounds = field.getBoundingClientRect();
          if (bounds.top < top + 16 || bounds.bottom > top + height - 16) {
            field.scrollIntoView({ block: "start", behavior: "instant" });
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
