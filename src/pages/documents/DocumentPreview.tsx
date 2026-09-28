import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export function DocumentPreview({
  url,
  mime,
}: {
  url: string;
  mime: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const image = mime.startsWith("image/");

  useEffect(() => {
    if (!url || image) return;
    let cancel = false;
    setFailed(false);

    void (async () => {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error("PREVIEW_FAILED");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const doc = await pdfjs.getDocument({
          data,
          disableWorker: true,
          isEvalSupported: false,
          verbosity: 0,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;

        if (cancel || !host.current) return;
        setPageCount(doc.numPages);
        host.current.replaceChildren();

        const total = Math.min(doc.numPages, 8);
        const containerWidth = host.current.clientWidth || 480;
        const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

        for (let index = 1; index <= total; index++) {
          const page = await doc.getPage(index);
          if (cancel || !host.current) return;

          const natural = page.getViewport({ scale: 1 });
          const baseScale = Math.max(containerWidth - 24, 280) / natural.width;
          const targetScale = Math.min(Math.max(baseScale * zoom, 0.5), 3);
          const viewport = page.getViewport({ scale: targetScale });

          const canvas = document.createElement("canvas");
          canvas.className = "document-page";
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Página ${index} de ${doc.numPages} do documento`);

          const context = canvas.getContext("2d");
          if (!context) throw new Error("PREVIEW_FAILED");
          context.scale(dpr, dpr);

          await page.render({ canvasContext: context, viewport }).promise;
          host.current.appendChild(canvas);
        }
      } catch {
        if (!cancel) setFailed(true);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [url, image, zoom]);

  if (image) {
    return (
      <div className="document-preview-wrapper">
        <div className="document-preview-toolbar">
          <span className="document-page-counter">Imagem do documento</span>
          <div className="document-zoom-controls">
            <button
              type="button"
              className="document-zoom-btn"
              aria-label="Diminuir zoom"
              disabled={zoom <= 0.6}
              onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))}
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              className="document-zoom-btn document-zoom-reset"
              aria-label="Redefinir zoom"
              onClick={() => setZoom(1)}
            >
              <RotateCcw size={13} />
              <span>{Math.round(zoom * 100)}%</span>
            </button>
            <button
              type="button"
              className="document-zoom-btn"
              aria-label="Aumentar zoom"
              disabled={zoom >= 2}
              onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))}
            >
              <ZoomIn size={15} />
            </button>
          </div>
        </div>
        <div className="document-image-scroll-box">
          <img
            className="document-page document-page-image"
            alt="Documento original enviado"
            src={url}
            style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="document-preview-wrapper">
      <div className="document-preview-toolbar">
        <span className="document-page-counter">
          {pageCount > 0 ? `${pageCount} ${pageCount === 1 ? "página" : "páginas"}` : "Carregando páginas…"}
        </span>
        <div className="document-zoom-controls">
          <button
            type="button"
            className="document-zoom-btn"
            aria-label="Diminuir zoom"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))}
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            className="document-zoom-btn document-zoom-reset"
            aria-label="Redefinir zoom"
            onClick={() => setZoom(1)}
          >
            <RotateCcw size={13} />
            <span>{Math.round(zoom * 100)}%</span>
          </button>
          <button
            type="button"
            className="document-zoom-btn"
            aria-label="Aumentar zoom"
            disabled={zoom >= 2.5}
            onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.2) * 10) / 10))}
          >
            <ZoomIn size={15} />
          </button>
        </div>
      </div>

      <div className="document-pages" ref={host}>
        {failed && (
          <p className="document-preview-failed-note">
            Não consegui desenhar este PDF aqui. Abra o arquivo em tela cheia
            pelo botão verde.
          </p>
        )}
      </div>
    </div>
  );
}
