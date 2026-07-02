const AAG = {
  queue: [],
  selected: null,
  panel: null,
  flow: null,
  latestPdf: null
};

const FLOW_KEY = "assistFlowState";
const ELSEVIER_WAITING_URL = "https://www.ablesci.com/assist/index?status=waiting&publisher=elsevier";
const PDF_WATCH_TIMEOUT_MS = 180000;

const CN = {
  title: "\u6807\u9898",
  doi: "DOI",
  assistButton: "\u6211\u8981\u5e94\u52a9",
  waiting: "\u6c42\u52a9\u4e2d",
  upload: "\u4e0a\u4f20",
  browseFile: "\u6d4f\u89c8\u6587\u4ef6",
  dragFile: "\u62d6\u62fd\u6587\u4ef6",
  alreadyUploaded: "\u5df2\u7ecf\u6709\u4eba\u4e0a\u4f20",
  waitUpload: "\u7b49\u5f85\u5e94\u52a9\u8005\u4e0a\u4f20"
};

function textOf(element) {
  return (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
}

function controlText(element) {
  return [
    textOf(element),
    element?.getAttribute?.("aria-label") || "",
    element?.getAttribute?.("title") || "",
    element?.getAttribute?.("data-title") || ""
  ].join(" ").replace(/\s+/g, " ").trim();
}

function isVisible(element) {
  if (!element || element.closest(".aag-panel")) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function normalizeDoi(doi) {
  return (doi || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

function extractDoi(text) {
  const match = (text || "").match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match ? match[0] : "";
}

function isAbleSci() {
  return /(^|\.)ablesci\.com$/i.test(location.hostname);
}

function isScienceDirect() {
  return /(^|\.)sciencedirect\.com$/i.test(location.hostname);
}

function isScienceDirectPdfAsset() {
  return /(^|\.)pdf\.sciencedirectassets\.com$/i.test(location.hostname) && /\.pdf(\?|#|$)/i.test(location.href);
}

function isAbleSciDetailPage() {
  return isAbleSci() && /\/assist\/detail/i.test(location.pathname);
}

function isElsevierWaitingPage() {
  const params = new URLSearchParams(location.search);
  return isAbleSci() &&
    /\/assist\/index/i.test(location.pathname) &&
    params.get("status") === "waiting" &&
    params.get("publisher") === "elsevier";
}

function freshElsevierWaitingUrl() {
  const url = new URL(ELSEVIER_WAITING_URL);
  url.searchParams.set("_aag", String(Date.now()));
  return url.toString();
}

function getCandidateLinks(root) {
  return Array.from(root.querySelectorAll("a[href]"))
    .filter((link) => !link.closest(".aag-panel"))
    .map((link) => ({
      text: textOf(link),
      href: link.href
    }))
    .filter((link) => link.text || link.href);
}

function getLabeledValue(label) {
  const candidates = Array.from(document.querySelectorAll("tr, .layui-form-item, .layui-row, .row, dl, p, div"))
    .filter((node) => !node.closest(".aag-panel"))
    .map((node) => textOf(node))
    .filter((text) => text && text.includes(label));

  for (const text of candidates) {
    const cleaned = text.replace(label, "").replace(/^[:\uff1a\s]+/, "").trim();
    if (cleaned && cleaned.length <= 320) return cleaned;
  }
  return "";
}

function extractFromDetailPage() {
  const bodyText = textOf(document.body);
  const links = getCandidateLinks(document.body);
  const doi = normalizeDoi(
    getLabeledValue(CN.doi) ||
      extractDoi(bodyText) ||
      extractDoi(links.map((link) => `${link.text} ${link.href}`).join(" "))
  );

  const titleSelectors = [
    "h1",
    ".assist-title",
    ".detail-title",
    ".layui-card-header",
    ".article-title",
    "[class*='title']"
  ];

  let title = getLabeledValue(CN.title);
  if (title && title.includes(CN.doi)) title = "";
  for (const selector of titleSelectors) {
    if (title) break;
    for (const node of document.querySelectorAll(selector)) {
      const value = textOf(node);
      if (value && value.length > 8 && value.length < 280 && !/AbleSci|Assist Guard|Chrome|Google/.test(value)) {
        title = value;
        break;
      }
    }
  }

  if (!title) {
    const lines = bodyText.split(/\n|(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
    title = lines.find((line) =>
      line.length >= 12 &&
      line.length <= 260 &&
      !line.includes(CN.assistButton) &&
      !line.includes(CN.upload) &&
      !/AbleSci|Assist Guard/.test(line)
    ) || document.title.replace(/[-_].*$/, "").trim();
  }

  const canonicalLink = links.find((link) =>
    /doi\.org|sciencedirect|springer|wiley|tandfonline|nature|acs\.org|ieee|oup|cambridge|sagepub|mdpi|frontiers/i.test(link.href)
  )?.href || (doi ? `https://doi.org/${doi}` : "");

  return {
    title,
    doi,
    link: canonicalLink,
    pageUrl: location.href,
    capturedAt: new Date().toISOString()
  };
}

function extractFromListPage() {
  const items = [];
  const seen = new Set();
  const buttons = findAssistButtons();

  for (const [index, button] of buttons.entries()) {
    const container = getRequestContainer(button);
    const text = textOf(container);
    const titleLink = getTitleLink(container);
    const title = textOf(titleLink) || text.replace(CN.assistButton, "").slice(0, 220);
    const pageUrl = titleLink?.href || button.href || "";
    const key = pageUrl || title;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title,
      doi: normalizeDoi(extractDoi(text)),
      pageUrl,
      assistIndex: index + 1,
      capturedAt: new Date().toISOString()
    });
  }

  return items.slice(0, 30);
}

function findAssistButtons() {
  return Array.from(document.querySelectorAll("a, button"))
    .filter((el) => isVisible(el) && textOf(el) === CN.assistButton);
}

function getRequestContainer(element) {
  return element.closest("li, tr, .layui-card, .assist-item, .list-item, .media, .layui-row") ||
    element.parentElement ||
    element;
}

function getTitleLink(container) {
  return Array.from(container.querySelectorAll("a[href]"))
    .filter((link) => isVisible(link))
    .find((link) => {
      const text = textOf(link);
      return text.length > 8 &&
        text !== CN.assistButton &&
        !/download|file|message|favorite|report/i.test(link.href) &&
        !/GooglePDF|DOI|Scholar/.test(text);
    }) || null;
}

function buildAssistEntry(button, index) {
  const container = getRequestContainer(button);
  const titleLink = getTitleLink(container);
  return {
    element: button,
    title: textOf(titleLink) || textOf(container).slice(0, 220),
    url: titleLink?.href || button.href || "",
    rowText: textOf(container).slice(0, 500),
    index
  };
}

function findFirstWaitingAssist() {
  const button = findAssistButtons()[0];
  return button ? buildAssistEntry(button, 1) : null;
}

function findLastWaitingAssist() {
  const buttons = findAssistButtons();
  const button = buttons[buttons.length - 1];
  return button ? buildAssistEntry(button, buttons.length) : null;
}

function findLikelyUploadControl() {
  const controls = Array.from(document.querySelectorAll("input[type='file'], button, a, .layui-upload-drag, [class*='upload']"))
    .filter((el) => !el.closest(".aag-panel") && isVisible(el));
  return controls.find((el) => {
    const text = textOf(el);
    return el.matches?.("input[type='file']") ||
      text.includes(CN.browseFile) ||
      text.includes(CN.dragFile) ||
      text.includes(CN.upload);
  }) || null;
}

function findViewPdfControl() {
  const controls = Array.from(document.querySelectorAll("a[href], button, [role='button']"))
    .filter((el) => !el.closest(".aag-panel") && isVisible(el))
    .map((el) => ({ el, text: controlText(el), href: el.href || "" }));
  return controls.find((item) => /\bview\s*pdf\b/i.test(item.text)) ||
    controls.find((item) => /\bdownload\s*pdf\b/i.test(item.text)) ||
    controls.find((item) => /\.pdf(\?|#|$)/i.test(item.href)) ||
    controls.find((item) => /\bpdf\b/i.test(item.text)) ||
    null;
}

function findExactViewPdfControl() {
  const controls = Array.from(document.querySelectorAll("a[href], button, [role='button']"))
    .filter((el) => !el.closest(".aag-panel") && isVisible(el))
    .map((el) => ({ el, text: controlText(el), href: el.href || "" }));
  return controls.find((item) => /\bview\s*pdf\b/i.test(item.text)) || null;
}

function hasInstitutionAccessHint() {
  return /through your institution|institutional access|access through your institution|sign in through your institution|get access/i.test(textOf(document.body));
}

function searchUrls(request) {
  const title = request.title || "";
  const doi = normalizeDoi(request.doi);
  const encodedTitle = encodeURIComponent(title);
  return [
    doi ? `https://doi.org/${encodeURIComponent(doi)}` : "",
    title ? `https://scholar.google.com/scholar?q=${encodedTitle}` : "",
    title ? `https://www.google.com/search?q=${encodedTitle}+filetype%3Apdf` : ""
  ].filter(Boolean);
}

function publisherUrls(request) {
  const urls = [];
  if (request.link) urls.push(request.link);
  if (request.doi) urls.push(`https://doi.org/${encodeURIComponent(normalizeDoi(request.doi))}`);
  return Array.from(new Set(urls.filter(Boolean)));
}

function message(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    // Fall through to the legacy path below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.documentElement.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_) {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
}

async function saveFlowState(flow) {
  AAG.flow = flow || null;
  await chrome.storage.local.set({ [FLOW_KEY]: AAG.flow });
}

async function loadFlowState() {
  const data = await chrome.storage.local.get({ [FLOW_KEY]: null });
  AAG.flow = data[FLOW_KEY] || null;
  return AAG.flow;
}

async function clearFlowState() {
  AAG.flow = null;
  await chrome.storage.local.remove(FLOW_KEY);
}

async function takeAssistEntry(entry) {
  if (!entry?.element) {
    setStatus("\u672a\u627e\u5230\u53ef\u70b9\u51fb\u7684\u201c\u6211\u8981\u5e94\u52a9\u201d\u6309\u94ae\u3002", "warn");
    return false;
  }

  await saveFlowState({
    mode: "after-claim-open-publisher",
    sourceUrl: location.href,
    claimedTitle: entry.title || "",
    claimedUrl: entry.url || "",
    startedAt: new Date().toISOString()
  });
  setStatus(`\u6b63\u5728\u63a5\u5355\uff1a${entry.title || entry.url || "\u5f53\u524d\u6c42\u52a9"}`, "good");
  entry.element.click();
  return true;
}

async function takeLastVisibleAssist() {
  const last = findLastWaitingAssist();
  if (!last) {
    setStatus("\u6ca1\u6709\u627e\u5230\u53ef\u89c1\u7684\u201c\u6211\u8981\u5e94\u52a9\u201d\u6309\u94ae\u3002\u8bf7\u5148\u6253\u5f00\u6c42\u52a9\u4e2d\u5217\u8868\u3002", "warn");
    return false;
  }
  return takeAssistEntry(last);
}

async function takeQueuedAssist(item) {
  const buttons = findAssistButtons();
  const byIndex = Number.isInteger(item?.assistIndex) ? buttons[item.assistIndex - 1] : null;
  const byUrl = item?.pageUrl ? buttons.find((button) => {
    const container = getRequestContainer(button);
    const titleLink = getTitleLink(container);
    return titleLink?.href === item.pageUrl || button.href === item.pageUrl;
  }) : null;
  const button = byIndex || byUrl;
  if (!button) {
    setStatus("\u672a\u627e\u5230\u8fd9\u6761\u626b\u63cf\u8bb0\u5f55\u5bf9\u5e94\u7684\u201c\u6211\u8981\u5e94\u52a9\u201d\u6309\u94ae\u3002\u8bf7\u91cd\u65b0\u626b\u63cf\u5217\u8868\u540e\u518d\u8bd5\u3002", "warn");
    return false;
  }
  const entry = buildAssistEntry(button, item.assistIndex || buttons.indexOf(button) + 1);
  entry.title = item.title || entry.title;
  entry.url = item.pageUrl || entry.url;
  return takeAssistEntry(entry);
}

async function takeLastVisibleAssistWhenReady({ attempts = 8, delayMs = 700 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (findLastWaitingAssist()) {
      if (attempt === 1) {
        setStatus("\u5217\u8868\u5df2\u5237\u65b0\uff0c\u6b63\u5728\u7a0d\u7b49\u9875\u9762\u7a33\u5b9a\u540e\u63a5\u5355...");
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      return takeLastVisibleAssist();
    }
    if (attempt < attempts) {
      setStatus(`\u6b63\u5728\u7b49\u5f85 Elsevier \u6c42\u52a9\u5217\u8868\u52a0\u8f7d\uff08${attempt}/${attempts}\uff09...`);
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }
  setStatus("\u5df2\u8fdb\u5165 Elsevier \u6c42\u52a9\u4e2d\uff0c\u4f46\u6682\u65f6\u6ca1\u627e\u5230\u53ef\u89c1\u7684\u201c\u6211\u8981\u5e94\u52a9\u201d\u6309\u94ae\u3002\u8bf7\u5237\u65b0\u6216\u624b\u52a8\u70b9\u201c\u63a5\u672c\u9875\u6700\u540e\u4e00\u6761\u6c42\u52a9\u201d\u3002", "warn");
  return false;
}

function createPanel() {
  if (AAG.panel) return AAG.panel;

  const panel = document.createElement("div");
  panel.className = "aag-panel";
  panel.innerHTML = `
    <div class="aag-header">
      <div class="aag-title">AbleSci Assist Guard</div>
      <button class="aag-button" data-aag="toggle">\u6536\u8d77</button>
    </div>
    <div class="aag-body">
      <div class="aag-note">
        \u534a\u81ea\u52a8\u6a21\u5f0f\uff1a\u81ea\u52a8\u63a5\u672c\u9875\u6700\u540e\u4e00\u6761\u3001\u6293\u53d6\u8be6\u60c5\u3001\u6253\u5f00 DOI/\u51fa\u7248\u5546\uff1b\u4e0b\u8f7d\u3001\u4e0a\u4f20\u548c\u6700\u7ec8\u63d0\u4ea4\u9700\u8981\u4f60\u624b\u52a8\u786e\u8ba4\u3002
      </div>
      <div class="aag-row">
        <button class="aag-button primary" data-aag="go-elsevier">Elsevier\u6c42\u52a9\u4e2d</button>
        <button class="aag-button danger" data-aag="take-last">\u63a5\u672c\u9875\u6700\u540e\u4e00\u6761\u6c42\u52a9</button>
        <button class="aag-button primary" data-aag="continue-flow">\u7ee7\u7eed\u5f53\u524d\u6d41\u7a0b</button>
      </div>
      <div class="aag-row">
        <button class="aag-button" data-aag="capture-detail">\u6293\u53d6\u5f53\u524d\u6c42\u52a9</button>
        <button class="aag-button" data-aag="scan-list">\u626b\u63cf\u5217\u8868</button>
        <button class="aag-button primary" data-aag="latest-pdf">\u9501\u5b9a\u5e76\u590d\u5236\u6700\u8fd1PDF</button>
        <button class="aag-button warning" data-aag="clear">\u6e05\u7a7a\u9762\u677f</button>
      </div>
      <div id="aag-current"></div>
      <div id="aag-status" class="aag-status">\u51c6\u5907\u5c31\u7eea\u3002</div>
      <div id="aag-list"></div>
    </div>
  `;
  document.documentElement.appendChild(panel);
  AAG.panel = panel;
  panel.addEventListener("click", handlePanelClick);
  return panel;
}

function setStatus(text, kind = "") {
  const el = document.getElementById("aag-status");
  if (!el) return;
  el.textContent = text;
  el.className = `aag-status ${kind}`.trim();
}

function renderCurrent(request) {
  AAG.selected = request;
  const el = document.getElementById("aag-current");
  if (!el) return;
  if (!request) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="aag-card">
      <div class="aag-card-title">${escapeHtml(request.title || "\u672a\u8bc6\u522b\u6807\u9898")}</div>
      <div class="aag-meta">DOI: ${escapeHtml(request.doi || "\u672a\u8bc6\u522b")}</div>
      <div class="aag-meta">\u9875\u9762: ${escapeHtml(request.pageUrl || location.href)}</div>
      <div class="aag-row" style="margin-top:8px">
        <button class="aag-button primary" data-aag="open-publisher">\u6253\u5f00DOI/\u51fa\u7248\u5546</button>
        <button class="aag-button" data-aag="open-search">\u6253\u5f00\u68c0\u7d22\u9875</button>
        <button class="aag-button" data-aag="check-oa">\u67e5\u5f00\u653e\u83b7\u53d6</button>
        <button class="aag-button primary" data-aag="latest-pdf">\u9501\u5b9a\u5e76\u590d\u5236\u6700\u8fd1PDF</button>
        <button class="aag-button" data-aag="copy-note">\u590d\u5236\u8bf4\u660e</button>
      </div>
      <div id="aag-oa"></div>
    </div>
  `;
}

function renderQueue(queue) {
  const el = document.getElementById("aag-list");
  if (!el) return;
  if (!queue.length) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = queue.map((item, index) => `
    <div class="aag-card">
      <div class="aag-card-title">${index + 1}. ${escapeHtml(item.title || "\u672a\u8bc6\u522b\u6807\u9898")}</div>
      <div class="aag-meta">DOI: ${escapeHtml(item.doi || "\u672a\u8bc6\u522b")}</div>
      <div class="aag-row" style="margin-top:8px">
        <button class="aag-button primary" data-aag="open-queued" data-index="${index}">\u6253\u5f00\u6c42\u52a9</button>
        <button class="aag-button" data-aag="select" data-index="${index}">\u9009\u62e9</button>
      </div>
    </div>
  `).join("");
}

async function handlePanelClick(event) {
  const button = event.target.closest("[data-aag]");
  if (!button) return;
  const action = button.dataset.aag;

  if (action === "toggle") {
    document.querySelector(".aag-body")?.classList.toggle("aag-hidden");
    button.textContent = button.textContent === "\u6536\u8d77" ? "\u5c55\u5f00" : "\u6536\u8d77";
    return;
  }

  if (action === "go-elsevier") {
    await saveFlowState({
      mode: "auto-take-last-on-elsevier-list",
      sourceUrl: location.href,
      startedAt: new Date().toISOString()
    });
    setStatus("\u5df2\u542f\u52a8 Elsevier \u4e00\u952e\u6d41\u7a0b\uff1a\u5148\u5237\u65b0\u6c42\u52a9\u5217\u8868\uff0c\u518d\u81ea\u52a8\u63a5\u672c\u9875\u6700\u540e\u4e00\u6761\u3002", "good");
    location.href = freshElsevierWaitingUrl();
    return;
  }

  if (action === "take-last") {
    await takeLastVisibleAssist();
    return;
  }

  if (action === "continue-flow") {
    await continueCurrentFlow();
    return;
  }

  if (action === "capture-detail") {
    const request = extractFromDetailPage();
    renderCurrent(request);
    setStatus("\u5df2\u6293\u53d6\u5f53\u524d\u9875\u9762\u4fe1\u606f\u3002", "good");
    return;
  }

  if (action === "scan-list") {
    AAG.queue = extractFromListPage();
    renderQueue(AAG.queue);
    setStatus(`\u5df2\u626b\u63cf ${AAG.queue.length} \u6761\u53ef\u89c1\u6c42\u52a9\u3002`, AAG.queue.length ? "good" : "warn");
    return;
  }

  if (action === "select") {
    const index = Number(button.dataset.index);
    renderCurrent(AAG.queue[index]);
    setStatus("\u5df2\u9009\u62e9\u961f\u5217\u6761\u76ee\u3002");
    return;
  }

  if (action === "open-queued") {
    const index = Number(button.dataset.index);
    const item = AAG.queue[index];
    if (!item) return setStatus("\u672a\u627e\u5230\u8fd9\u6761\u626b\u63cf\u8bb0\u5f55\u3002", "warn");
    renderCurrent(item);
    await takeQueuedAssist(item);
    return;
  }

  if (action === "open-publisher") {
    if (!AAG.selected) return setStatus("\u8bf7\u5148\u6293\u53d6\u6216\u9009\u62e9\u4e00\u6761\u6c42\u52a9\u3002", "warn");
    const urls = publisherUrls(AAG.selected);
    if (!urls.length) return setStatus("\u672a\u8bc6\u522b\u5230 DOI \u6216\u51fa\u7248\u5546\u94fe\u63a5\u3002", "warn");
    await saveFlowState({
      mode: "publisher-opened",
      request: AAG.selected,
      returnUrl: AAG.selected.pageUrl || location.href,
      updatedAt: new Date().toISOString()
    });
    await message("OPEN_ACTIVE_TAB", { url: urls[0] });
    setStatus("\u5df2\u6253\u5f00 DOI/\u51fa\u7248\u5546\u5165\u53e3\u3002\u5230\u51fa\u7248\u5546\u9875\u540e\u63d2\u4ef6\u4f1a\u5c1d\u8bd5\u5b9a\u4f4d View PDF\u3002", "good");
    return;
  }

  if (action === "open-search") {
    if (!AAG.selected) return setStatus("\u8bf7\u5148\u6293\u53d6\u6216\u9009\u62e9\u4e00\u6761\u6c42\u52a9\u3002", "warn");
    const result = await message("OPEN_SEARCH_TABS", { urls: searchUrls(AAG.selected) });
    setStatus(result.ok ? `\u5df2\u6253\u5f00 ${result.opened.length} \u4e2a\u68c0\u7d22\u6807\u7b7e\u9875\u3002` : `\u6253\u5f00\u5931\u8d25\uff1a${result.reason}`, result.ok ? "good" : "warn");
    return;
  }

  if (action === "check-oa") {
    if (!AAG.selected) return setStatus("\u8bf7\u5148\u6293\u53d6\u6216\u9009\u62e9\u4e00\u6761\u6c42\u52a9\u3002", "warn");
    setStatus("\u6b63\u5728\u68c0\u67e5 OpenAlex \u5f00\u653e\u83b7\u53d6\u5019\u9009...");
    const result = await message("CHECK_OPEN_ACCESS", { request: AAG.selected });
    renderOpenAccess(result);
    setStatus(result.ok ? "\u5f00\u653e\u83b7\u53d6\u68c0\u67e5\u5b8c\u6210\u3002" : `\u68c0\u67e5\u5931\u8d25\uff1a${result.reason}`, result.ok ? "good" : "warn");
    return;
  }

  if (action === "latest-pdf") {
    await lockLatestPdf();
    return;
  }

  if (action === "copy-note") {
    if (!AAG.selected) return setStatus("\u8bf7\u5148\u6293\u53d6\u6216\u9009\u62e9\u4e00\u6761\u6c42\u52a9\u3002", "warn");
    const note = [
      `\u6807\u9898\uff1a${AAG.selected.title || ""}`,
      `DOI: ${AAG.selected.doi || ""}`,
      `\u6c42\u52a9\u9875\uff1a${AAG.selected.pageUrl || location.href}`,
      "\u72b6\u6001\uff1a\u5df2\u751f\u6210\u68c0\u7d22\u5165\u53e3\u3002\u4e0b\u8f7d\u3001\u4e0a\u4f20\u548c\u6700\u7ec8\u63d0\u4ea4\u9700\u8981\u624b\u52a8\u786e\u8ba4\u3002"
    ].join("\n");
    const copied = await copyTextToClipboard(note);
    setStatus(copied ? "\u5df2\u590d\u5236\u8bf4\u660e\u3002" : "\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u526a\u8d34\u677f\u6743\u9650\u3002", copied ? "good" : "warn");
    return;
  }

  if (action === "clear") {
    AAG.queue = [];
    AAG.selected = null;
    AAG.latestPdf = null;
    await clearFlowState();
    renderCurrent(null);
    renderQueue([]);
    setStatus("\u9762\u677f\u5df2\u6e05\u7a7a\u3002");
  }
}

async function continueCurrentFlow() {
  await loadFlowState();

  if (!isAbleSci()) {
    locatePublisherPdf();
    return;
  }

  if (isAbleSciDetailPage()) {
    if (AAG.flow?.mode === "after-claim-open-publisher") {
      const request = extractFromDetailPage();
      renderCurrent(request);
      const urls = publisherUrls(request);
      if (!urls.length) {
        setStatus("\u5df2\u6293\u53d6\u8be6\u60c5\uff0c\u4f46\u672a\u8bc6\u522b\u5230 DOI \u6216\u51fa\u7248\u5546\u94fe\u63a5\u3002", "warn");
        return;
      }
      await saveFlowState({
        mode: "publisher-opened",
        request,
        returnUrl: request.pageUrl || location.href,
        sourceUrl: AAG.flow.sourceUrl || "",
        updatedAt: new Date().toISOString()
      });
      await message("OPEN_ACTIVE_TAB", { url: urls[0] });
      setStatus("\u5df2\u6293\u53d6\u8be6\u60c5\u5e76\u6253\u5f00 DOI/\u51fa\u7248\u5546\u5165\u53e3\u3002", "good");
      return;
    }

    const upload = findLikelyUploadControl();
    if (upload) {
      upload.scrollIntoView({ behavior: "smooth", block: "center" });
      upload.classList.add("aag-highlight-target");
      setStatus(AAG.latestPdf?.filename ?
        `\u5df2\u9ad8\u4eae\u4e0a\u4f20\u533a\u57df\uff0c\u6700\u8fd1 PDF \u8def\u5f84\u5df2\u590d\u5236\uff1a${AAG.latestPdf.filename}` :
        "\u5df2\u9ad8\u4eae\u4e0a\u4f20\u533a\u57df\u3002\u4f60\u4e0b\u8f7d PDF \u540e\u53ef\u70b9\u201c\u9501\u5b9a\u6700\u8fd1PDF\u201d\u590d\u5236\u8def\u5f84\u3002", "warn");
      return;
    }

    const request = extractFromDetailPage();
    renderCurrent(request);
    setStatus("\u5df2\u6293\u53d6\u5f53\u524d\u6c42\u52a9\u3002\u53ef\u6253\u5f00 DOI/\u51fa\u7248\u5546\u6216\u9501\u5b9a\u6700\u8fd1 PDF\u3002", "good");
    return;
  }

  const last = findLastWaitingAssist();
  if (last) {
    setStatus("\u9875\u9762\u4e0a\u6709\u53ef\u5e94\u52a9\u6c42\u52a9\u3002\u8bf7\u70b9\u201c\u63a5\u672c\u9875\u6700\u540e\u4e00\u6761\u6c42\u52a9\u201d\u786e\u8ba4\u63a5\u5355\u3002", "warn");
    last.element.scrollIntoView({ behavior: "smooth", block: "center" });
    last.element.classList.add("aag-highlight-target");
    return;
  }

  const first = findFirstWaitingAssist();
  if (first) {
    first.element.scrollIntoView({ behavior: "smooth", block: "center" });
    first.element.classList.add("aag-highlight-target");
    setStatus("\u627e\u5230\u53ef\u5e94\u52a9\u6c42\u52a9\uff0c\u4f46\u672a\u80fd\u786e\u8ba4\u6700\u540e\u4e00\u6761\u3002\u8bf7\u5148\u68c0\u67e5\u5217\u8868\u3002", "warn");
    return;
  }

  setStatus("\u672a\u8bc6\u522b\u5230\u4e0b\u4e00\u6b65\u3002\u8bf7\u6253\u5f00\u79d1\u7814\u901a\u6c42\u52a9\u5217\u8868\u6216\u6c42\u52a9\u8be6\u60c5\u9875\u3002", "warn");
}

function locatePublisherPdf() {
  const exactViewPdf = findExactViewPdfControl();
  if (exactViewPdf) {
    exactViewPdf.el.scrollIntoView({ behavior: "smooth", block: "center" });
    exactViewPdf.el.classList.add("aag-highlight-target");
    setStatus("\u5df2\u8bc6\u522b View PDF\uff0c\u6b63\u5728\u81ea\u52a8\u70b9\u51fb\u8fdb\u5165 PDF \u67e5\u770b\u9875\u3002\u4e0b\u8f7d\u8fd8\u662f\u7531\u4f60\u624b\u52a8\u786e\u8ba4\u3002", "good");
    window.setTimeout(() => {
      saveFlowState({
        ...(AAG.flow || {}),
        mode: "pdf-view-opened",
        pdfWatchStartedAt: Date.now(),
        updatedAt: new Date().toISOString()
      }).catch(() => {});
      exactViewPdf.el.click();
    }, 300);
    return;
  }

  const pdf = findViewPdfControl();
  if (pdf) {
    pdf.el.scrollIntoView({ behavior: "smooth", block: "center" });
    pdf.el.classList.add("aag-highlight-target");
    setStatus("\u5df2\u627e\u5230 PDF \u5165\u53e3\u5e76\u9ad8\u4eae\uff0c\u4f46\u4e0d\u662f\u660e\u786e\u7684 View PDF\uff0c\u8bf7\u4f60\u624b\u52a8\u70b9\u51fb\u786e\u8ba4\u3002", "warn");
    return;
  }

  if (hasInstitutionAccessHint()) {
    setStatus("\u672a\u627e\u5230 View PDF\uff0c\u9875\u9762\u51fa\u73b0\u673a\u6784\u767b\u5f55/\u6743\u9650\u63d0\u793a\u3002\u8fd9\u6761\u53ef\u80fd\u6ca1\u6709\u53ef\u7528\u6743\u9650\uff0c\u53ef\u4ee5\u8fd4\u56de\u6362\u4e0b\u4e00\u6761\u3002", "warn");
    return;
  }

  setStatus("\u5f53\u524d\u51fa\u7248\u5546\u9875\u672a\u627e\u5230 View PDF/PDF \u5165\u53e3\u3002\u5982\u679c\u9875\u9762\u8fd8\u5728\u9a8c\u8bc1\uff0c\u5b8c\u6210\u540e\u518d\u70b9\u201c\u7ee7\u7eed\u5f53\u524d\u6d41\u7a0b\u201d\u3002", "warn");
}

async function lockLatestPdf() {
  setStatus("\u6b63\u5728\u67e5\u627e Chrome \u6700\u8fd1\u5b8c\u6210\u7684 PDF \u4e0b\u8f7d...");
  const result = await message("FIND_LATEST_PDF_DOWNLOAD");
  if (!result?.ok) {
    setStatus(`\u672a\u627e\u5230\u6700\u8fd1 PDF\uff1a${result?.reason || "\u672a\u77e5\u539f\u56e0"}`, "warn");
    return;
  }

  AAG.latestPdf = result;
  const copied = await copyTextToClipboard(result.filename);

  const upload = isAbleSciDetailPage() ? findLikelyUploadControl() : null;
  if (upload) {
    upload.scrollIntoView({ behavior: "smooth", block: "center" });
    upload.classList.add("aag-highlight-target");
  }

  const messageText = upload ?
    `\u5df2\u9501\u5b9a\u6700\u8fd1 PDF \u5e76\u9ad8\u4eae\u4e0a\u4f20\u533a\u57df\uff1a${result.filename}\u3002${copied ? "\u8def\u5f84\u5df2\u590d\u5236\uff0c\u70b9\u201c\u6d4f\u89c8\u6587\u4ef6\u201d\u540e\u76f4\u63a5\u7c98\u8d34\u5373\u53ef\u3002" : "\u8def\u5f84\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u526a\u8d34\u677f\u6743\u9650\u3002"}` :
    `\u5df2\u9501\u5b9a\u6700\u8fd1 PDF\uff1a${result.filename}\u3002${copied ? "\u8def\u5f84\u5df2\u590d\u5236\uff0c\u56de\u5230\u4e0a\u4f20\u9875\u540e\u53ef\u76f4\u63a5\u7c98\u8d34\u3002" : "\u8def\u5f84\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u526a\u8d34\u677f\u6743\u9650\u3002"}`;
  setStatus(messageText, copied ? "good" : "warn");
}

async function lockLatestPdfSince(sinceMs) {
  const result = await message("FIND_LATEST_PDF_DOWNLOAD", { options: { sinceMs } });
  if (!result?.ok) return false;

  AAG.latestPdf = result;
  const copied = await copyTextToClipboard(result.filename);
  const statusText = copied ?
    `\u5df2\u68c0\u6d4b\u5230\u65b0\u4e0b\u8f7d PDF \u5e76\u590d\u5236\u8def\u5f84\uff1a${result.filename}\u3002\u53ef\u56de\u5230\u79d1\u7814\u901a\u4e0a\u4f20\u9875\u76f4\u63a5\u7c98\u8d34\u3002` :
    `\u5df2\u68c0\u6d4b\u5230\u65b0\u4e0b\u8f7d PDF\uff1a${result.filename}\uff0c\u4f46\u8def\u5f84\u590d\u5236\u5931\u8d25\u3002`;
  setStatus(statusText, copied ? "good" : "warn");

  await saveFlowState({
    ...(AAG.flow || {}),
    mode: "pdf-downloaded",
    latestPdf: result,
    updatedAt: new Date().toISOString()
  });
  return true;
}

async function watchPdfDownload() {
  await loadFlowState();
  const sinceMs = Number(AAG.flow?.pdfWatchStartedAt || Date.now());
  await saveFlowState({
    ...(AAG.flow || {}),
    mode: "pdf-view-opened",
    pdfWatchStartedAt: sinceMs,
    updatedAt: new Date().toISOString()
  });

  setStatus("\u5df2\u8fdb\u5165 PDF \u67e5\u770b\u9875\u3002\u8bf7\u624b\u52a8\u70b9\u51fb\u53f3\u4e0a\u89d2\u4e0b\u8f7d\u6309\u94ae\uff1b\u63d2\u4ef6\u4f1a\u81ea\u52a8\u68c0\u6d4b\u65b0 PDF \u4e0b\u8f7d\u5e76\u590d\u5236\u8def\u5f84\u3002", "good");

  const startedAt = Date.now();
  const timer = window.setInterval(async () => {
    if (Date.now() - startedAt > PDF_WATCH_TIMEOUT_MS) {
      window.clearInterval(timer);
      setStatus("\u672a\u5728 3 \u5206\u949f\u5185\u68c0\u6d4b\u5230\u65b0 PDF \u4e0b\u8f7d\u3002\u4e0b\u8f7d\u540e\u4e5f\u53ef\u56de\u4e0a\u4f20\u9875\u70b9\u201c\u9501\u5b9a\u5e76\u590d\u5236\u6700\u8fd1PDF\u201d\u3002", "warn");
      return;
    }

    const ok = await lockLatestPdfSince(sinceMs);
    if (ok) window.clearInterval(timer);
  }, 2000);
}

async function autoResumeFlow() {
  await loadFlowState();

  if (isScienceDirectPdfAsset()) {
    await watchPdfDownload();
    return;
  }

  if (AAG.flow?.mode === "auto-take-last-on-elsevier-list" && isElsevierWaitingPage()) {
    await takeLastVisibleAssistWhenReady();
    return;
  }

  if (AAG.flow?.request && isAbleSciDetailPage()) {
    renderCurrent(AAG.flow.request);
  }

  if (AAG.flow?.mode === "after-claim-open-publisher" && isAbleSciDetailPage()) {
    await continueCurrentFlow();
    return;
  }

  if (AAG.flow?.mode === "publisher-opened" && !isAbleSci()) {
    locatePublisherPdf();
  }
}

function renderOpenAccess(result) {
  const el = document.getElementById("aag-oa");
  if (!el) return;
  if (!result?.ok) {
    el.innerHTML = `<div class="aag-status warn">${escapeHtml(result?.reason || "\u68c0\u67e5\u5931\u8d25")}</div>`;
    return;
  }
  if (!result.found) {
    el.innerHTML = `<div class="aag-status warn">${escapeHtml(result.reason || "\u672a\u627e\u5230\u5f00\u653e\u83b7\u53d6\u5019\u9009\u3002")}</div>`;
    return;
  }

  const links = [
    result.landingUrl ? `<a class="aag-button" href="${escapeAttr(result.landingUrl)}" target="_blank" rel="noopener noreferrer">\u6253\u5f00\u6765\u6e90\u9875</a>` : "",
    result.pdfUrl ? `<a class="aag-button primary" href="${escapeAttr(result.pdfUrl)}" target="_blank" rel="noopener noreferrer">\u6253\u5f00OA PDF</a>` : ""
  ].filter(Boolean).join("");

  el.innerHTML = `
    <div class="aag-status ${result.isOpenAccess ? "good" : "warn"}">
      ${result.isOpenAccess ? "\u53d1\u73b0\u5f00\u653e\u83b7\u53d6\u5019\u9009\u3002" : "\u672a\u786e\u8ba4\u5f00\u653e\u83b7\u53d6\u3002"}
      ${result.oaStatus ? `\u72b6\u6001\uff1a${escapeHtml(result.oaStatus)}\u3002 ` : ""}
      ${result.license ? `\u8bb8\u53ef\uff1a${escapeHtml(result.license)}\u3002 ` : ""}
      ${result.source ? `\u6765\u6e90\uff1a${escapeHtml(result.source)}\u3002` : ""}
    </div>
    <div class="aag-row" style="margin-top:8px">${links}</div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

async function boot() {
  createPanel();
  await loadFlowState();
  window.setTimeout(() => {
    autoResumeFlow().catch((error) => {
      setStatus(`\u81ea\u52a8\u7eed\u8dd1\u5931\u8d25\uff1a${error?.message || String(error)}`, "warn");
    });
  }, 800);
}

boot().catch((error) => {
  console.warn("AbleSci Assist Guard failed to start:", error);
});
