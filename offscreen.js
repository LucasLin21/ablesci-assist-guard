const OBJECT_URL_TTL_MS = 2 * 60 * 1000;
const objectUrls = new Map();

function rememberObjectUrl(url) {
  const existing = objectUrls.get(url);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => revokeObjectUrl(url), OBJECT_URL_TTL_MS);
  objectUrls.set(url, timer);
}

function revokeObjectUrl(url) {
  const timer = objectUrls.get(url);
  if (timer) clearTimeout(timer);
  objectUrls.delete(url);
  try {
    URL.revokeObjectURL(url);
  } catch (_) {
    // Best-effort cleanup only.
  }
}

async function blobHasPdfHeader(blob) {
  if (!blob || blob.size < 5) return false;
  return await blob.slice(0, 5).text() === "%PDF-";
}

async function createVerifiedPdfObjectUrl(message) {
  const response = await fetch(message.url, {
    credentials: "include",
    cache: "reload",
    headers: {
      "Accept": "application/pdf, application/octet-stream;q=0.9, */*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`PDF request returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const blob = await response.blob();
  if (blob.size < 1024) {
    throw new Error(`PDF response is too small (${blob.size} bytes)`);
  }

  const hasPdfHeader = await blobHasPdfHeader(blob);
  if (!hasPdfHeader || /html/i.test(contentType)) {
    throw new Error("current URL returned HTML or non-PDF content");
  }

  const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
  const objectUrl = URL.createObjectURL(pdfBlob);
  rememberObjectUrl(objectUrl);
  return {
    ok: true,
    objectUrl,
    bytes: blob.size,
    contentType: pdfBlob.type || contentType || "application/pdf"
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "aag-offscreen") return false;

  if (message.type === "AAG_CREATE_PDF_OBJECT_URL") {
    createVerifiedPdfObjectUrl(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }

  if (message.type === "AAG_REVOKE_OBJECT_URL") {
    revokeObjectUrl(message.url);
    sendResponse({ ok: true });
    return false;
  }

  sendResponse({ ok: false, reason: "Unknown offscreen message type." });
  return false;
});
