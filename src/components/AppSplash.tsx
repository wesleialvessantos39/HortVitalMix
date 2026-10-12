import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./appSplash.css";

const INTRO_DURATION_MS = 1550;
const EXIT_DURATION_MS = 180;

/** A short, entirely local welcome scene; it never waits for application data. */
export function AppSplash({ brandName = "HortiVitalMix" }: { brandName?: string }) {
  const [phase, setPhase] = useState<"visible" | "leaving" | "finished">("visible");
  const skipButton = useRef<HTMLButtonElement>(null);
  const isLeaving = useRef(false);
  const showing = phase !== "finished";

  useLayoutEffect(() => {
    if (!showing) return;
    const elements = [document.documentElement, document.body];
    const previousOverflow = elements.map((element) => ({ element, overflow: element.style.overflow }));
    elements.forEach((element) => { element.style.overflow = "hidden"; });
    return () => {
      previousOverflow.forEach(({ element, overflow }) => { element.style.overflow = overflow; });
    };
  }, [showing]);

  const dismiss = useCallback(() => {
    if (isLeaving.current) return;
    isLeaving.current = true;
    // Do not leave keyboard focus on an element being faded out or removed.
    if (document.activeElement === skipButton.current) skipButton.current?.blur();
    setPhase("leaving");
  }, []);

  useEffect(() => {
    if (phase === "finished") return;
    if (phase === "leaving") {
      const timer = setTimeout(() => setPhase("finished"), EXIT_DURATION_MS);
      return () => clearTimeout(timer);
    }
    isLeaving.current = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = setTimeout(dismiss, reducedMotion.matches ? 100 : INTRO_DURATION_MS);
    // Keyboard and assistive-technology users can reach the application immediately.
    const skipOnInteraction = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key === "Escape") dismiss();
    };
    const reduceMotion = (event: MediaQueryListEvent) => {
      if (event.matches) dismiss();
    };
    document.addEventListener("keydown", skipOnInteraction, true);
    reducedMotion.addEventListener("change", reduceMotion);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", skipOnInteraction, true);
      reducedMotion.removeEventListener("change", reduceMotion);
    };
  }, [dismiss, phase]);

  if (phase === "finished") return null;

  return (
    <section
      className={`app-splash${phase === "leaving" ? " app-splash--leaving" : ""}`}
      aria-label={`Boas-vindas ao ${brandName}`}
      data-testid="app-splash"
    >
      <div className="app-splash__scene" aria-hidden="true">
        <div className="app-splash__kitchen" />
        <div className="app-splash__light" />
        <ProduceScene />
      </div>

      <div className="app-splash__topline" aria-hidden="true">
        <span className="app-splash__topline-dot" />
        Do sítio para sua mesa
      </div>
      <button
        ref={skipButton}
        className="app-splash__skip"
        type="button"
        onClick={dismiss}
        aria-label="Pular apresentação e entrar no aplicativo"
      >
        Entrar
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m9 5 7 7-7 7M4 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="app-splash__signature">
        <div className="app-splash__brand">
          <span className="app-splash__brandmark" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M35 9c-15 0-24 6-24 17 0 7 7 12 14 8C35 29 37 19 35 9Z" stroke="currentColor" strokeWidth="2.2" />
              <path d="M11 40c2-12 8-21 19-27M18 27l1-8M23 22l8 1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="app-splash__brandname">
            {brandName === "HortiVitalMix" ? <>Horti<span>Vital</span>Mix</> : brandName}
          </span>
        </div>
        <p>Frescor da natureza. Cuidado em cada escolha.</p>
        <div className="app-splash__progress" aria-hidden="true"><span /></div>
      </div>
    </section>
  );
}

function ProduceScene() {
  const atlas = "/splash/produce-atlas.webp";
  return (
    <svg className="app-splash__produce" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
      <g className="app-splash__spread">
        <g className="app-splash__item app-splash__item--basket">
          <ellipse cx="624" cy="743" rx="99" ry="13" fill="#442d1c" opacity=".18" />
          <svg x="520" y="515" width="214" height="290" viewBox="0 0 535 724" overflow="hidden">
            <image href={atlas} width="2172" height="724" />
          </svg>
        </g>
        <g className="app-splash__item app-splash__item--greens">
          <ellipse cx="813" cy="748" rx="88" ry="13" fill="#442d1c" opacity=".15" />
          <svg x="714" y="555" width="193" height="239" viewBox="529 0 585 724" overflow="hidden">
            <image href={atlas} width="2172" height="724" />
          </svg>
        </g>
        <g className="app-splash__item app-splash__item--juice">
          <ellipse cx="954" cy="751" rx="69" ry="11" fill="#442d1c" opacity=".16" />
          <svg x="870" y="527" width="174" height="282" viewBox="1114 0 444 724" overflow="hidden">
            <image href={atlas} width="2172" height="724" />
          </svg>
        </g>
        <g className="app-splash__item app-splash__item--fresh">
          <ellipse cx="783" cy="802" rx="100" ry="12" fill="#442d1c" opacity=".15" />
          <svg x="675" y="600" width="215" height="253" viewBox="1558 0 614 724" overflow="hidden">
            <image href={atlas} width="2172" height="724" />
          </svg>
        </g>
      </g>
    </svg>
  );
}
