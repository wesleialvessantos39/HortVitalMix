const prepared = new WeakMap<File, Promise<File>>();

async function decodeImage(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap as CanvasImageSource,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  } catch {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(Error("Não foi possível abrir esta foto."));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      return {
        source: image as CanvasImageSource,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => image.removeAttribute("src"),
      };
    } catch {
      image.removeAttribute("src");
      throw Error(
        "Não foi possível abrir esta foto. Escolha outra imagem JPEG, PNG ou WebP.",
      );
    }
  }
}

export function optimizeImage(file: File): Promise<File> {
  const cached = prepared.get(file);
  if (cached) return cached;
  const task = (async () => {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 15 * 1024 * 1024
    )
      throw Error("Escolha uma foto JPEG, PNG ou WebP de até 15 MB.");
    const image = await decodeImage(file);
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw Error("Não foi possível preparar a foto.");
      let blob: Blob | null = null;
      // Bound dimensions AND transfer size for every future product/store photo.
      // Always redraw the original, preserving quality during adaptive encoding.
      for (const edge of [1280, 960, 720]) {
        const ratio = Math.min(1, edge / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.82, 0.72, 0.62]) {
          blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) =>
                b
                  ? resolve(b)
                  : reject(Error("Não foi possível preparar a foto.")),
              "image/webp",
              quality,
            ),
          );
          if (blob.size <= 240 * 1024) break;
        }
        if (blob && blob.size <= 240 * 1024) break;
      }
      if (!blob) throw Error("Não foi possível preparar a foto.");
      const extension =
        blob.type === "image/webp"
          ? "webp"
          : blob.type === "image/jpeg"
            ? "jpg"
            : "png";
      const result =
        blob.size < file.size || Math.max(image.width, image.height) > 1280
          ? new File(
              [blob],
              file.name.replace(/\.[^.]+$/, "") + "." + extension,
              {
                type: blob.type,
                lastModified: file.lastModified,
              },
            )
          : file;
      if (result.size > 2 * 1024 * 1024)
        throw Error("A foto ficou maior que 2 MB. Escolha uma imagem menor.");
      return result;
    } finally {
      image.dispose();
    }
  })();
  prepared.set(file, task);
  void task.catch(() => prepared.delete(file));
  return task;
}
