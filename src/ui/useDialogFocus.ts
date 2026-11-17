import { focusPluginPanel } from "@daily/plugin-sdk";
import { useEffect, useRef } from "react";

export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => ref.current ? focusPluginPanel(ref.current, () => close.current()) : undefined, []);
  return ref;
}
