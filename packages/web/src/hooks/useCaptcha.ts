import { useEffect, useRef, useState, type RefObject } from "react";
import { fetchAutosolvedCaptcha, MAX_AUTOSOLVE_ATTEMPTS } from "../lib/captchaSolve";
import type { Captcha } from "../types";

export function useCaptcha(inputRef: RefObject<HTMLInputElement>, focusSolved = false) {
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaText, setCaptchaText] = useState("");
  const [isSolving, setIsSolving] = useState(false);
  const [isAutoSolved, setIsAutoSolved] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    controller.current?.abort();
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
  }, []);

  const stopSolving = () => {
    controller.current?.abort();
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    setIsSolving(false);
    setIsCaptchaLoading(false);
  };

  const loadCaptcha = async (manual = false) => {
    controller.current?.abort();
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    const ac = new AbortController();
    controller.current = ac;
    setIsSolving(!manual);
    setIsCaptchaLoading(true);
    setCaptcha(null);
    setCaptchaText("");
    setIsAutoSolved(false);
    try {
      const { captcha: image, text, autoSolved } = await fetchAutosolvedCaptcha(MAX_AUTOSOLVE_ATTEMPTS, {
        signal: ac.signal, manual,
        onCaptcha: (image) => {
          if (ac.signal.aborted) return;
          setCaptcha(image);
          setIsCaptchaLoading(false);
        },
      });
      if (ac.signal.aborted) return;
      setCaptcha(image);
      setCaptchaText(text);
      setIsAutoSolved(autoSolved);
      if (!text || focusSolved) {
        focusTimer.current = setTimeout(() => {
          if (!ac.signal.aborted && (!focusSolved || !(document.activeElement instanceof HTMLInputElement))) {
            inputRef.current?.focus();
          }
        }, 60);
      }
    } catch (error) {
      if (!ac.signal.aborted) throw error;
    } finally {
      if (!ac.signal.aborted) {
        setIsCaptchaLoading(false);
        setIsSolving(false);
      }
    }
  };

  return {
    captcha, setCaptcha, captchaText, setCaptchaText,
    isSolving, isAutoSolved, setIsAutoSolved, isCaptchaLoading,
    loadCaptcha, stopSolving,
  };
}
