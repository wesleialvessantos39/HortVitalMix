import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

type PdfTextItem = { str?: string; transform?: number[] };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  render: (o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel?: () => void };
};
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy?: () => void;
};

function linesFromItems(items: PdfTextItem[]) {
  const rows: Array<{ y: number; parts: Array<{ x: number; str: string }> }> =
    [];
  for (const item of items) {
    const str = item.str ?? "";
    if (!str.trim()) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    let row = rows.find((entry) => Math.abs(entry.y - y) < 3);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) =>
      row.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.str)
        .join(" "),
    )
    .join("\n");
}

export function DocumentPreview({
  url,
  mime,
  onText,
}: {
  url: string;
  mime: string;
  onText?: (text: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const doc = useRef<PdfDoc | null>(null);
  const image = mime.startsWith("image/");
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    if (!url || image) return;
    let cancel = false;
    setFailed(false);
    setPage(1);
    setTotal(0);
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error("PREVIEW_FAILED");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loaded = (await pdfjs.getDocument({
          data,
          isEvalSupported: false,
          standardFontDataUrl: "/assets/pdf-fonts/",
          useSystemFonts: true,
          disableAutoFetch: true,
          disableStream: true,
        } as Parameters<typeof pdfjs.getDocument>[0]).promise) as unknown as PdfDoc;
        if (cancel) {
          loaded.destroy?.();
          return;
        }
        doc.current = loaded;
        const parts: string[] = [];
        const pages = Math.min(loaded.numPages, 8);
        for (let index = 1; index <= pages; index++) {
          const pdfPage = await loaded.getPage(index);
          const content = await pdfPage.getTextContent();
          parts.push(linesFromItems(content.items));
        }
        if (cancel) return;
        setTotal(loaded.numPages);
        setReady((value) => value + 1);
        onText?.(parts.join("\n"));
      } catch {
        if (!cancel) setFailed(true);
      }
    })();

    return () => {
      cancel = true;
      doc.current?.destroy?.();
      doc.current = null;
    };
  }, [url, image]);

  useEffect(() => {
    if (image || !ready || !doc.current || !canvas.current) return;
    let cancel = false;
    let task: { promise: Promise<void>; cancel?: () => void } | null = null;
    void (async () => {
      try {
        const pdfPage = await doc.current?.getPage(page);
        const target = canvas.current;
        if (!pdfPage || !target || cancel) return;
        const box = target.parentElement?.getBoundingClientRect();
        const natural = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(((box?.width || 320) - 16) / natural.width, 1.35);
        const viewport = pdfPage.getViewport({ scale: Math.max(scale, 0.2) });
        target.width = Math.max(1, Math.floor(viewport.width));
        target.height = Math.max(1, Math.floor(viewport.height));
        const context = target.getContext("2d");
        if (!context || cancel) return;
        task = pdfPage.render({ canvasContext: context, viewport });
        await task.promise;
      } catch {
        if (!cancel) setFailed(true);
      }
    })();
    return () => {
      cancel = true;
      task?.cancel?.();
    };
  }, [page, ready, image]);

  if (image)
    return (
      <div className="document-viewer">
        <img alt="Documento enviado" src={url} />
      </div>
    );
  }

  return (
    <div className="document-view">
      <div className="document-viewer">
        <canvas
          ref={canvas}
          className="document-page"
          role="img"
          aria-label="Página do documento"
        />
        {failed && (
          <p>Não consegui abrir este PDF. Envie de novo o arquivo baixado do SICAR.</p>
        )}
      </div>
      {total > 1 && (
        <div className="document-pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            Anterior
          </button>
          <span>
            {page}/{total}
          </span>
          <button
            type="button"
            disabled={page >= total}
            onClick={() => setPage((n) => n + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
