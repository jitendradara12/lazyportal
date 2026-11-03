import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/** PDF decoding only; the portal's table format and endpoints belong to core. */
export async function readPdfText(data: Uint8Array) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      // getTextContent() requires ReadableStream async iteration, absent in some WebKit runtimes.
      const reader = (await pdf.getPage(index)).streamTextContent().getReader();
      const items = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          items.push(...value.items);
        }
      } finally {
        reader.releaseLock();
      }
      pages.push(items.filter((item) => "str" in item).map((item) => ({
        text: item.str, x: item.transform[4], y: item.transform[5], width: item.width,
      })));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
