import { useEffect, useRef } from "react";

/** Progressive presentation only: no content is hidden while waiting for an API. */
export function useLandingMotion() {
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = pageRef.current;
    if (!root || typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let stopMotion = () => {};

    function configureMotion() {
      stopMotion();
      if (!root) return;
      root.dataset.motion = preference.matches ? "reduced" : "enabled";
      if (preference.matches) return;

      const active = new Map<Animation, Element>();
      const seen = new WeakSet<Element>();
      const hero = root.querySelector<HTMLElement>(".landing-hero-visual");
      let observer: IntersectionObserver | undefined;
      let heroVisible = false;
      let pointerFrame = 0;
      let disposed = false;
      let pointerX = 0;
      let pointerY = 0;

      function resetPointer() {
        cancelAnimationFrame(pointerFrame);
        pointerFrame = 0;
        hero?.style.removeProperty("--hero-pointer-x");
        hero?.style.removeProperty("--hero-pointer-y");
      }
      function cancelAnimations() {
        for (const animation of active.keys()) animation.cancel();
        active.clear();
      }
      function syncVisibility() {
        if (!root) return;
        root.dataset.heroInView = String(heroVisible && !document.hidden);
        if (document.hidden) cancelAnimations();
        if (document.hidden || !heroVisible) resetPointer();
      }
      function reveal(element: HTMLElement) {
        if (seen.has(element)) return;
        seen.add(element);
        if (document.hidden || element.contains(document.activeElement) || typeof element.animate !== "function") return;
        const direction = element.dataset.reveal;
        const start = direction === "left" ? "translate3d(-22px,0,0)"
          : direction === "right" ? "translate3d(22px,0,0)"
          : "translate3d(0,22px,0)";
        try {
          const animation = element.animate([
            { opacity: 0, transform: start },
            { opacity: 1, transform: "translate3d(0,0,0)" },
          ], {
            duration: 660,
            delay: Math.min(240, Math.max(0, Number(element.dataset.revealDelay) || 0)),
            easing: "cubic-bezier(.2,.7,.2,1)",
            fill: "backwards",
          });
          active.set(animation, element);
          const done = () => active.delete(animation);
          animation.addEventListener("finish", done, { once: true });
          animation.addEventListener("cancel", done, { once: true });
        } catch {
          // A browser that declines animation still renders the ordinary page.
        }
      }
      function onPointerMove(event: PointerEvent) {
        if (!hero || !heroVisible || document.hidden || !finePointer.matches || event.pointerType === "touch") return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (pointerFrame) return;
        pointerFrame = requestAnimationFrame(() => {
          pointerFrame = 0;
          if (disposed) return;
          const bounds = hero.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          const x = Math.max(-1, Math.min(1, (pointerX - bounds.left) / bounds.width * 2 - 1));
          const y = Math.max(-1, Math.min(1, (pointerY - bounds.top) / bounds.height * 2 - 1));
          hero.style.setProperty("--hero-pointer-x", x.toFixed(3));
          hero.style.setProperty("--hero-pointer-y", y.toFixed(3));
        });
      }
      function onFocus(event: FocusEvent) {
        if (!(event.target instanceof Node)) return;
        for (const [animation, element] of active) {
          if (element.contains(event.target)) animation.cancel();
        }
      }
      function onPointerCapabilityChange() {
        if (!finePointer.matches) resetPointer();
      }

      if (typeof window.IntersectionObserver === "function") {
        try {
          observer = new IntersectionObserver(entries => {
            if (disposed) return;
            for (const entry of entries) {
              if (entry.target === hero) {
                heroVisible = entry.isIntersecting;
                syncVisibility();
              }
              if (entry.isIntersecting && entry.target instanceof HTMLElement && entry.target.hasAttribute("data-reveal")) {
                reveal(entry.target);
                if (entry.target !== hero) observer?.unobserve(entry.target);
              }
            }
          }, { threshold: 0.08 });
          root.querySelectorAll<HTMLElement>("[data-reveal]").forEach(element => observer?.observe(element));
          if (hero) observer.observe(hero);
        } catch {
          observer?.disconnect();
          observer = undefined;
          cancelAnimations();
          heroVisible = false;
          syncVisibility();
        }
      }
      hero?.addEventListener("pointermove", onPointerMove, { passive: true });
      hero?.addEventListener("pointerleave", resetPointer);
      hero?.addEventListener("pointercancel", resetPointer);
      root.addEventListener("focusin", onFocus);
      document.addEventListener("visibilitychange", syncVisibility);
      finePointer.addEventListener("change", onPointerCapabilityChange);
      stopMotion = () => {
        disposed = true;
        observer?.disconnect();
        cancelAnimations();
        resetPointer();
        hero?.removeEventListener("pointermove", onPointerMove);
        hero?.removeEventListener("pointerleave", resetPointer);
        hero?.removeEventListener("pointercancel", resetPointer);
        root.removeEventListener("focusin", onFocus);
        document.removeEventListener("visibilitychange", syncVisibility);
        finePointer.removeEventListener("change", onPointerCapabilityChange);
        delete root.dataset.heroInView;
      };
    }
    configureMotion();
    preference.addEventListener("change", configureMotion);
    return () => {
      preference.removeEventListener("change", configureMotion);
      stopMotion();
      delete root.dataset.motion;
    };
  }, []);

  return pageRef;
}
