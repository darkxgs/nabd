"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads the page from the server every `seconds` while the tab is visible,
 * and straight away when the tab comes back. New checks then slide into the
 * beat strips without anyone pressing reload.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const go = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      router.refresh();
    };
    const id = window.setInterval(go, seconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 15_000) go();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  return null;
}
