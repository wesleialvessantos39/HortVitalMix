import { useEffect, useRef, useState } from "react";

export function DocumentPreview({
  url,
  mime,
}: {
  url: string;
  mime: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
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
        host.current.replaceChildren();
        const total = Math.min(doc.numPages, 8);
        for (let index = 1; index <= total; index++) {
          const page = await doc.getPage(index);
          if (cancel || !host.current) return;
          const width = Math.max(host.current.clientWidth || 320, 280);
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: Math.min(2, width / natural.width),
          });
          const canvas = document.createElement("canvas");
          canvas.className = "document-page";
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Página ${index} do documento`);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("PREVIEW_FAILED");
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
  }, [url, image]);
  if (image)
    return (
      <img
        className="document-page"
        alt="Documento original enviado"
        src={url}
      />
    );
  return (
    <div className="document-pages" ref={host}>
      {failed && (
        <p>
          Não consegui desenhar este PDF aqui. Abra o arquivo em tela cheia
          pelo botão verde.
        </p>
      )}
    </div>
  );
}
