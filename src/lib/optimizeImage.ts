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
      const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw Error("Não foi possível preparar a foto.");
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(Error("Não foi possível preparar a foto.")),
          "image/webp",
          0.82,
        ),
      );
      const result =
        blob.size < file.size || ratio < 1
          ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
              type: blob.type,
              lastModified: file.lastModified,
            })
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
