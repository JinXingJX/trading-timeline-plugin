import { useEffect, useRef } from "react";

export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    // The dialog renders inside the view's shadow root, which has its own focused element.
    const scope = (ref.current?.getRootNode() ?? document) as Document | ShadowRoot;
    const previousFocus = scope.activeElement instanceof HTMLElement ? scope.activeElement : null;
    const handleKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && scope.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && scope.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    scope.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      scope.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return ref;
}
