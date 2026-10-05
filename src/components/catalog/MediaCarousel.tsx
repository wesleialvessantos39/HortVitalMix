import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Pause, Play } from "lucide-react";
import "./mediaCarousel.css";
import { MediaImage } from "./MediaImage";

export type MediaSlide = {
  id: string;
  imageUrl: string | null;
  alt: string;
  href?: string;
  caption?: ReactNode;
};
export function MediaCarousel({
  slides,
  label,
  onNavigate,
  priority = false,
  className = "",
  onEnd,
}: {
  slides: MediaSlide[];
  label: string;
  onNavigate?: (path: string) => void;
  priority?: boolean;
  className?: string;
  onEnd?: () => Promise<void>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null),
    [paused, setPaused] = useState(false),
    [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false),
    [visible, setVisible] = useState(priority),
    [hidden, setHidden] = useState(document.visibilityState === "hidden"),
    [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [failed, setFailed] = useState<Set<string>>(new Set()),
    [boundary, setBoundary] = useState(false);
  const root = useRef<HTMLElement | null>(null),
    gesture = useRef<{ x: number; y: number } | null>(null),
    pending = useRef(false);
  const index = Math.max(
    0,
    slides.findIndex((slide) => slide.id === activeId),
  );
  const slide = slides[index],
    next = slides[(index + 1) % slides.length];
  const signature = slides.map((item) => item.id).join("|");
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches),
      visibility = () => setHidden(document.visibilityState === "hidden");
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function advance(direction: number) {
    if (pending.current || slides.length < 1) return;
    if (direction === 1 && index === slides.length - 1 && onEnd) {
      pending.current = true;
      setBoundary(true);
      try {
        await onEnd();
        setActiveId(null);
      } finally {
        pending.current = false;
        setBoundary(false);
      }
    } else
      setActiveId(
        slides[(index + direction + slides.length) % slides.length]?.id ?? null,
      );
  }
  useEffect(() => {
    if (
      paused ||
      hovered ||
      focused ||
      hidden ||
      reduced ||
      !visible ||
      boundary ||
      (slides.length < 2 && !onEnd)
    )
      return;
    const timer = setTimeout(() => {
      void advance(1).catch(() => {});
    }, 6000);
    return () => clearTimeout(timer);
  }, [
    activeId,
    index,
    signature,
    paused,
    hovered,
    focused,
    hidden,
    reduced,
    visible,
    boundary,
    onEnd,
  ]);
  if (!slide) return null;
  const content = (
    <>
      {slide.imageUrl && !failed.has(slide.imageUrl) ? (
        <MediaImage
          src={slide.imageUrl}
          alt={slide.alt}
          loading={visible || priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority || visible ? "high" : "auto"}
          priority={priority || visible}
          onError={() =>
            setFailed((previous) => new Set(previous).add(slide.imageUrl!))
          }
        />
      ) : (
        <span className="hvm-carousel-fallback">
          <ImageOff size={32} aria-hidden="true" />
          <span>
            {slide.imageUrl ? "Foto indisponível" : "Foto não cadastrada"}
          </span>
        </span>
      )}
      {slide.caption && (
        <div className="hvm-carousel-caption">{slide.caption}</div>
      )}
    </>
  );
  return (
    <section
      ref={root}
      className={`hvm-carousel ${className}`}
      role="region"
      aria-roledescription="carrossel"
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
      onTouchStart={(event) => {
        const t = event.touches[0];
        gesture.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(event) => {
        const start = gesture.current;
        gesture.current = null;
        const end = event.changedTouches[0];
        if (
          start &&
          Math.abs(end.clientX - start.x) > 40 &&
          Math.abs(end.clientX - start.x) > Math.abs(end.clientY - start.y)
        )
          void advance(end.clientX < start.x ? 1 : -1).catch(() => {});
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          void advance(event.key === "ArrowRight" ? 1 : -1).catch(() => {});
        }
      }}
    >
      {slide.href ? (
        <a
          className="hvm-carousel-surface"
          href={slide.href}
          aria-label={slide.alt}
          onClick={(event) => {
            if (
              onNavigate &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              onNavigate(slide.href!);
            }
          }}
        >
          {content}
        </a>
      ) : (
        <div className="hvm-carousel-surface">{content}</div>
      )}
      {visible && next?.imageUrl && next.imageUrl !== slide.imageUrl && (
        <MediaImage
          className="hvm-carousel-preload"
          src={next.imageUrl}
          alt=""
          aria-hidden="true"
          loading="eager"
          fetchPriority="low"
        />
      )}
      {(slides.length > 1 || onEnd) && (
        <div className="hvm-carousel-controls">
          <button
            type="button"
            aria-label={paused ? "Iniciar slides" : "Pausar slides"}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            type="button"
            aria-label="Foto anterior"
            disabled={boundary}
            onClick={() => void advance(-1).catch(() => {})}
          >
            <ChevronLeft size={18} />
          </button>
          <span aria-label={`Foto ${index + 1} de ${slides.length}`}>
            {index + 1}/{slides.length}
          </span>
          <button
            type="button"
            aria-label="Próxima foto"
            disabled={boundary}
            onClick={() => void advance(1).catch(() => {})}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </section>
  );
}
