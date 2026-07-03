const FLOW_KEY = "assistFlowState";
const PDF_AUTO_DOWNLOAD_WINDOW_MS = 30 * 60 * 1000;
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const PDF_ASSET_URL_PATTERN = /^https:\/\/pdf\.sciencedirectassets\.com\/.*\.pdf(?:[?#]|$)/i;
const SCIENCEDIRECT_PDF_VIEW_URL_PATTERN = /^https:\/\/www\.sciencedirect\.com\/science\/article\/pii\/[^/?#]+\/pdfft(?:[?#]|$)/i;
const THEJPD_PDF_VIEW_URL_PATTERN = /^https:\/\/(?:www\.)?thejpd\.org\/article\/[^/?#]+\/pdf(?:[?#]|$)/i;
const SPRINGER_PDF_VIEW_URL_PATTERN = /^https:\/\/link\.springer\.com\/(?:content\/pdf\/.+\.pdf|article\/[^/?#]+\/pdf)(?:[?#]|$)/i;
const ACTIVE_PDF_FLOW_MODES = new Set([
  "publisher-opened",
  "pdf-view-opened",
  "pdf-download-starting",
  "pdf-download-started"
]);
const verifiedDownloadsInFlight = new Map();

async function openActiveUrl(url) {
  const tab = await chrome.tabs.create({ url, active: true });
  return { id: tab.id, url };
}

function sanitizeDownloadName(value) {
  return String(value || "science-direct-paper")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, 150) || "science-direct-paper";
}

function pdfBaseNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pid = parsed.searchParams.get("pid") || "";
    if (pid) return decodeURIComponent(pid).replace(/\.pdf$/i, "") || "science-direct-paper";
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "science-direct-paper";
    return decodeURIComponent(last).replace(/\.pdf$/i, "") || "science-direct-paper";
  } catch (_) {
    return "science-direct-paper";
  }
}

function isScienceDirectPdfFileUrl(url) {
  const value = String(url || "");
  return PDF_ASSET_URL_PATTERN.test(value) ||
    SCIENCEDIRECT_PDF_VIEW_URL_PATTERN.test(value) ||
    THEJPD_PDF_VIEW_URL_PATTERN.test(value) ||
    SPRINGER_PDF_VIEW_URL_PATTERN.test(value);
}

function pdfDownloadFileName(value, url) {
  return `${sanitizeDownloadName(value || pdfBaseNameFromUrl(url))}.pdf`;
}

function downloadFileName(item) {
  return String(item?.filename || "").replace(/\\/g, "/").split("/").pop() || "";
}

function downloadUrl(item) {
  return item?.finalUrl || item?.url || "";
}

function downloadUrls(item) {
  return [item?.finalUrl || "", item?.url || ""].filter(Boolean);
}

function downloadSize(item) {
  const value = Number(item?.fileSize || item?.totalBytes || 0);
  return Number.isFinite(value) ? value : 0;
}

function downloadFinishedAtMs(item) {
  const startedAt = item?.startTime ? Date.parse(item.startTime) : 0;
  const endedAt = item?.endTime ? Date.parse(item.endTime) : startedAt;
  return Math.max(startedAt || 0, endedAt || 0);
}

function isHtmlDownload(item) {
  const mime = item?.mime || "";
  const fileName = downloadFileName(item);
  const url = downloadUrl(item);
  return /html|xhtml/i.test(mime) ||
    /\.html?$/i.test(fileName) ||
    /\.html?(?:[?#]|$)/i.test(url);
}

function isPdfDownload(item) {
  const mime = item?.mime || "";
  const fileName = downloadFileName(item);
  const size = downloadSize(item);
  return item &&
    item.state === "complete" &&
    item.filename &&
    item.exists !== false &&
    !isHtmlDownload(item) &&
    (!size || size >= 1024) &&
    (/\.pdf$/i.test(fileName) || /pdf/i.test(mime));
}

function downloadSummary(item) {
  return {
    ok: true,
    id: item.id,
    filename: item.filename,
    url: item.finalUrl || item.url || "",
    startTime: item.startTime || "",
    endTime: item.endTime || "",
    fileSize: item.fileSize || 0,
    exists: item.exists !== false
  };
}

async function getFlowState() {
  const data = await chrome.storage.local.get({ [FLOW_KEY]: null });
  return data[FLOW_KEY] || null;
}

async function saveFlowPatch(patch) {
  const flow = await getFlowState();
  const next = {
    ...(flow || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [FLOW_KEY]: next });
  return next;
}

function flowTimestamp(flow) {
  const values = [
    Number(flow?.pdfWatchStartedAt || 0),
    Number(flow?.autoDownloadStartedAt || 0),
    Date.parse(flow?.updatedAt || ""),
    Date.parse(flow?.startedAt || "")
  ].filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : 0;
}

function isActivePdfFlow(flow) {
  if (!flow || !ACTIVE_PDF_FLOW_MODES.has(flow.mode)) return false;
  const timestamp = flowTimestamp(flow);
  return timestamp && Date.now() - timestamp <= PDF_AUTO_DOWNLOAD_WINDOW_MS;
}

async function findLatestPdfDownload(options = {}) {
  const items = await chrome.downloads.search({
    limit: 50,
    orderBy: ["-startTime"]
  });
  const sinceMs = Number(options.sinceMs || 0);
  const latest = items.find((item) => {
    if (!isPdfDownload(item)) return false;
    if (!sinceMs) return true;
    return downloadFinishedAtMs(item) >= sinceMs;
  });
  if (!latest) {
    return { ok: false, reason: "No completed PDF download found in Chrome history." };
  }
  return downloadSummary(latest);
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error("Chrome offscreen API is not available. Please use a current Chrome version.");
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length) return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["BLOBS"],
      justification: "Create a verified PDF blob URL so downloads can use Chrome's downloads API without a Save As dialog."
    });
  } catch (error) {
    if (!/Only a single offscreen document|already exists/i.test(error?.message || "")) {
      throw error;
    }
  }
}

async function createVerifiedPdfObjectUrl(url) {
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({
    target: "aag-offscreen",
    type: "AAG_CREATE_PDF_OBJECT_URL",
    url
  });
  if (!result?.ok) {
    throw new Error(result?.reason || "Failed to create verified PDF blob.");
  }
  return result;
}

function revokeOffscreenObjectUrl(objectUrl) {
  if (!objectUrl) return;
  chrome.runtime.sendMessage({
    target: "aag-offscreen",
    type: "AAG_REVOKE_OBJECT_URL",
    url: objectUrl
  }).catch(() => {});
}

async function startVerifiedPdfDownload(options = {}) {
  const url = String(options.url || "");
  if (!isScienceDirectPdfFileUrl(url)) {
    return { ok: false, reason: "Current URL is not a supported publisher PDF file URL." };
  }

  if (verifiedDownloadsInFlight.has(url)) {
    return verifiedDownloadsInFlight.get(url);
  }

  const task = startVerifiedPdfDownloadOnce(options)
    .finally(() => {
      setTimeout(() => verifiedDownloadsInFlight.delete(url), 30000);
    });
  verifiedDownloadsInFlight.set(url, task);
  return task;
}

async function startVerifiedPdfDownloadOnce(options = {}) {
  const url = String(options.url || "");
  const flow = await getFlowState();
  const alreadyStarted = flow?.downloadUrl === url &&
    (flow.mode === "pdf-download-starting" || flow.mode === "pdf-download-started") &&
    !flow.verifiedDownloadError &&
    Number(flow?.downloadStartedAt || 0) &&
    Date.now() - Number(flow.downloadStartedAt) < 30000;
  if (alreadyStarted) {
    return { ok: true, id: flow.browserDownloadId || flow.verifiedDownloadId || 0, duplicate: true };
  }

  const sinceMs = Number(options.sinceMs || Date.now());
  const fileName = pdfDownloadFileName(options.fileName, url);
  await saveFlowPatch({
    mode: "pdf-download-starting",
    pdfWatchStartedAt: sinceMs,
    browserDownloadUrl: url,
    downloadUrl: url,
    browserDownloadStartedAt: Date.now(),
    downloadStartedAt: Date.now(),
    downloadSource: "offscreen-verified-blob",
    verifiedDownloadError: "",
    browserDownloadError: ""
  });

  let objectUrl = "";
  try {
    const blob = await createVerifiedPdfObjectUrl(url);
    objectUrl = blob.objectUrl;
    const id = await chrome.downloads.download({
      url: objectUrl,
      filename: fileName,
      conflictAction: "uniquify",
      saveAs: false
    });
    await saveFlowPatch({
      mode: "pdf-download-started",
      pdfWatchStartedAt: sinceMs,
      browserDownloadUrl: url,
      downloadUrl: url,
      browserDownloadStartedAt: Date.now(),
      downloadStartedAt: Date.now(),
      browserDownloadId: id,
      verifiedDownloadId: id,
      verifiedDownloadBytes: blob.bytes || 0,
      downloadSource: "offscreen-verified-blob",
      verifiedDownloadError: "",
      browserDownloadError: ""
    });
    setTimeout(() => revokeOffscreenObjectUrl(objectUrl), 2 * 60 * 1000);
    return { ok: true, id, fileName, bytes: blob.bytes || 0 };
  } catch (error) {
    revokeOffscreenObjectUrl(objectUrl);
    await saveFlowPatch({
      mode: "pdf-view-opened",
      pdfWatchStartedAt: sinceMs,
      browserDownloadUrl: url,
      downloadUrl: url,
      verifiedDownloadError: error?.message || String(error),
      browserDownloadError: error?.message || String(error)
    });
    return { ok: false, reason: error?.message || String(error) };
  }
}

function isFlowDownload(item, flow) {
  const flowDownloadId = Number(flow?.browserDownloadId || 0);
  if (flowDownloadId) return item?.id === flowDownloadId;

  const sinceMs = Number(flow?.pdfWatchStartedAt || 0);
  if (sinceMs && downloadFinishedAtMs(item) < sinceMs) return false;

  const flowUrl = String(flow?.browserDownloadUrl || flow?.downloadUrl || "");
  const matchesFlowUrl = flowUrl && downloadUrls(item).some((itemUrl) => itemUrl === flowUrl || itemUrl.startsWith(flowUrl));
  if (matchesFlowUrl) return true;

  if (isHtmlDownload(item)) return false;

  return Boolean(sinceMs);
}

async function ignoreNonPdfDownload(item, reason) {
  try {
    await chrome.downloads.erase({ id: item.id });
  } catch (_) {
    // History cleanup is best-effort only; the important part is not locking it as a PDF.
  }

  await saveFlowPatch({
    mode: "pdf-view-opened",
    rejectedDownload: {
      id: item.id,
      filename: item.filename || "",
      url: downloadUrl(item),
      mime: item.mime || "",
      fileSize: downloadSize(item),
      reason
    },
    browserDownloadError: reason
  });
}

async function maybeDownloadPdfUrlFromTab(url) {
  if (!isScienceDirectPdfFileUrl(url)) return;

  const flow = await getFlowState();
  const activeFlow = isActivePdfFlow(flow) ? flow : null;
  if (!activeFlow) return;
  if (activeFlow.pdfControlLabel === "Download PDF" || activeFlow.manualPdfDownloadRequired) return;

  const recentSamePdf = flow?.downloadUrl === url &&
    (flow.mode === "pdf-download-starting" || flow.mode === "pdf-download-started" || flow.mode === "pdf-downloaded") &&
    Number(flow?.downloadStartedAt || flow?.updatedAt && Date.parse(flow.updatedAt) || 0) &&
    Date.now() - Number(flow.downloadStartedAt || Date.parse(flow.updatedAt)) < 30000;
  if (recentSamePdf) return;

  const sinceMs = Number(activeFlow?.pdfWatchStartedAt || Date.now());
  await startVerifiedPdfDownload({
    url,
    fileName: activeFlow?.request?.title || pdfBaseNameFromUrl(url),
    sinceMs
  });
}

async function scanOpenPdfTabs() {
  const assetTabs = await chrome.tabs.query({
    url: "https://pdf.sciencedirectassets.com/*"
  });
  const viewTabs = await chrome.tabs.query({
    url: "https://www.sciencedirect.com/science/article/pii/*/pdfft*"
  });
  const theJpdTabs = await chrome.tabs.query({
    url: "https://www.thejpd.org/article/*/pdf*"
  });
  const theJpdRootTabs = await chrome.tabs.query({
    url: "https://thejpd.org/article/*/pdf*"
  });
  const springerPdfTabs = await chrome.tabs.query({
    url: "https://link.springer.com/content/pdf/*"
  });
  const springerArticlePdfTabs = await chrome.tabs.query({
    url: "https://link.springer.com/article/*/pdf*"
  });
  const tabs = [...assetTabs, ...viewTabs, ...theJpdTabs, ...theJpdRootTabs, ...springerPdfTabs, ...springerArticlePdfTabs];
  for (const tab of tabs) {
    await maybeDownloadPdfUrlFromTab(tab.url || "");
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (!url) return;

  maybeDownloadPdfUrlFromTab(url).catch((error) => {
    console.warn("\u4e00\u952e\u5e94\u52a9 PDF tab handoff failed:", error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => {
    scanOpenPdfTabs().catch((error) => {
      console.warn("\u4e00\u952e\u5e94\u52a9 PDF startup scan failed:", error);
    });
  }, 1000);
});

chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => {
    scanOpenPdfTabs().catch((error) => {
      console.warn("\u4e00\u952e\u5e94\u52a9 PDF startup scan failed:", error);
    });
  }, 1000);
});

setTimeout(() => {
  scanOpenPdfTabs().catch((error) => {
    console.warn("\u4e00\u952e\u5e94\u52a9 PDF startup scan failed:", error);
  });
}, 1000);

chrome.downloads.onChanged.addListener((delta) => {
  if (delta?.state?.current !== "complete") return;

  (async () => {
    const flow = await getFlowState();
    if (!isActivePdfFlow(flow)) return;

    const items = await chrome.downloads.search({ id: delta.id });
    const item = items[0];
    if (!item || !isFlowDownload(item, flow)) return;

    const sinceMs = Number(flow.pdfWatchStartedAt || 0);
    if (sinceMs && downloadFinishedAtMs(item) < sinceMs) return;

    if (isHtmlDownload(item)) {
      await ignoreNonPdfDownload(item, "Chrome downloaded an HTML page instead of the PDF; ignored it.");
      return;
    }

    if (!isPdfDownload(item)) {
      await ignoreNonPdfDownload(item, "Chrome completed a download, but it did not look like a PDF; ignored it.");
      return;
    }

    await saveFlowPatch({
      mode: "pdf-downloaded",
      latestPdf: downloadSummary(item),
      autoDownloadError: "",
      browserDownloadError: "",
      viewerDownloadError: ""
    });
  })().catch((error) => {
    console.warn("\u4e00\u952e\u5e94\u52a9 download-state sync failed:", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "aag-offscreen") return false;

  (async () => {
    if (message?.type === "FIND_LATEST_PDF_DOWNLOAD") {
      sendResponse(await findLatestPdfDownload(message.options || {}));
      return;
    }

    if (message?.type === "DOWNLOAD_CURRENT_PDF") {
      sendResponse(await startVerifiedPdfDownload(message.options || {}));
      return;
    }

    if (message?.type === "OPEN_ACTIVE_TAB") {
      sendResponse({ ok: true, opened: await openActiveUrl(message.url) });
      return;
    }

    sendResponse({ ok: false, reason: "Unknown message type." });
  })().catch((error) => {
    sendResponse({ ok: false, reason: error?.message || String(error) });
  });
  return true;
});
