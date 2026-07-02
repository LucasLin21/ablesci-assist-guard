const OPENALEX_ENDPOINT = "https://api.openalex.org/works";

function normalizeDoi(doi) {
  return (doi || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

async function findOpenAccessCandidate(request) {
  const doi = normalizeDoi(request.doi);
  const params = new URLSearchParams({
    "per-page": "3"
  });

  if (doi) {
    params.set("filter", `doi:${doi}`);
  } else if (request.title) {
    params.set("search", request.title);
  } else {
    return { ok: false, reason: "No title or DOI available." };
  }

  const response = await fetch(`${OPENALEX_ENDPOINT}?${params.toString()}`, {
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    return { ok: false, reason: `OpenAlex returned ${response.status}.` };
  }

  const data = await response.json();
  const work = Array.isArray(data.results) ? data.results[0] : null;
  if (!work) {
    return { ok: true, found: false, reason: "No OpenAlex match found." };
  }

  const bestLocation = work.best_oa_location || null;
  const primaryLocation = work.primary_location || null;
  const pdfUrl = bestLocation?.pdf_url || null;
  const landingUrl =
    bestLocation?.landing_page_url ||
    primaryLocation?.landing_page_url ||
    work.doi ||
    null;

  return {
    ok: true,
    found: Boolean(work),
    title: work.title || request.title || "",
    doi: work.doi || doi || "",
    isOpenAccess: Boolean(work.open_access?.is_oa),
    oaStatus: work.open_access?.oa_status || "",
    pdfUrl,
    landingUrl,
    source: bestLocation?.source?.display_name || primaryLocation?.source?.display_name || "",
    license: bestLocation?.license || ""
  };
}

async function openUrls(urls) {
  const opened = [];
  for (const url of urls.filter(Boolean)) {
    const tab = await chrome.tabs.create({ url, active: false });
    opened.push({ id: tab.id, url });
  }
  return opened;
}

async function openActiveUrl(url) {
  const tab = await chrome.tabs.create({ url, active: true });
  return { id: tab.id, url };
}

function isPdfDownload(item) {
  return item &&
    item.state === "complete" &&
    item.filename &&
    /\.pdf$/i.test(item.filename);
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
    const startedAt = item.startTime ? Date.parse(item.startTime) : 0;
    const endedAt = item.endTime ? Date.parse(item.endTime) : startedAt;
    return Math.max(startedAt, endedAt) >= sinceMs;
  });
  if (!latest) {
    return { ok: false, reason: "No completed PDF download found in Chrome history." };
  }
  return {
    ok: true,
    id: latest.id,
    filename: latest.filename,
    url: latest.finalUrl || latest.url || "",
    startTime: latest.startTime || "",
    fileSize: latest.fileSize || 0
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "CHECK_OPEN_ACCESS") {
      sendResponse(await findOpenAccessCandidate(message.request || {}));
      return;
    }

    if (message?.type === "FIND_LATEST_PDF_DOWNLOAD") {
      sendResponse(await findLatestPdfDownload(message.options || {}));
      return;
    }

    if (message?.type === "OPEN_SEARCH_TABS") {
      sendResponse({ ok: true, opened: await openUrls(message.urls || []) });
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
