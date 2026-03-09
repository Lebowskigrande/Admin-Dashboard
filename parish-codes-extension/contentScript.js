/**
 * contentScript.js
 * - Inserts chosen code into active editable field (Gmail compose)
 * - Captures right-click context and tries to extract Gmail thread/message identifiers
 */

let lastContext = {
  ok: false,
  ts: null,
  href: null,
  threadId: null,
  messageId: null
};
const ROUTING_MODAL_ID = "parish-routing-modal";
const ROUTING_MODAL_STYLE_ID = "parish-routing-modal-style";
let routingModalState = null;

document.addEventListener(
  "contextmenu",
  (ev) => {
    try {
      lastContext = buildContext(ev);
    } catch {
      // ignore
    }
  },
  true
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "insertText" && msg.text) {
    insertAtCursor(String(msg.text) + " ");
    return;
  }

  if (msg.type === "getGmailContext") {
    const merged = mergeWithUrl(lastContext);
    sendResponse({
      ok: Boolean(merged.threadId || merged.messageId),
      href: merged.href,

      // Preserve raw DOM/web tokens too.
      webThreadToken: merged.threadId || null,
      webMessageDomId: merged.messageId || null,

      // Provide IDs for server usage (often match Gmail API ids).
      threadId: merged.threadId || null,
      messageId: merged.messageId || null,

      ts: merged.ts
    });

    return true;
  }

  if (msg.type === "showToast" && msg.text) {
    showToast(String(msg.text), Boolean(msg.ok));
    return;
  }

  if (msg.type === "openRoutingModal") {
    openRoutingModal(msg.payload || {});
    sendResponse({ ok: true });
    return true;
  }
});

function buildContext(ev) {
  const href = String(location.href || "");
  const { threadId: fromUrl } = parseThreadFromGmailUrl(href);
  const { threadId: fromDomThread, messageId: fromDomMessage } = findIdsInDom(ev.target);

  return {
    ok: Boolean(fromDomMessage || fromDomThread || fromUrl),
    ts: new Date().toISOString(),
    href,
    threadId: fromDomThread || fromUrl || null,
    messageId: fromDomMessage || null
  };
}

function mergeWithUrl(ctx) {
  const href = String(location.href || "");
  const { threadId: fromUrl } = parseThreadFromGmailUrl(href);
  const { threadId: fromDocThread, messageId: fromDocMessage } = findIdsInDocument();

  return {
    ok: Boolean(ctx?.messageId || ctx?.threadId || fromDocMessage || fromDocThread || fromUrl),
    ts: ctx?.ts || new Date().toISOString(),
    href,
    threadId: ctx?.threadId || fromDocThread || fromUrl || null,
    messageId: ctx?.messageId || fromDocMessage || null
  };
}

function parseThreadFromGmailUrl(href) {
  try {
    const hash = (href.split("#")[1] || "").trim();
    if (!hash) return { threadId: null };

    const parts = hash.split("/").filter(Boolean);
    const maybeId = parts.at(-1) || "";
    if (/^[0-9a-f]{10,}$/i.test(maybeId)) return { threadId: maybeId };
    return { threadId: null };
  } catch {
    return { threadId: null };
  }
}

function findIdsInDom(startNode) {
  let el =
    startNode && startNode.nodeType === Node.ELEMENT_NODE
      ? startNode
      : startNode?.parentElement;

  let hops = 0;
  while (el && hops++ < 30) {
    const messageId =
      el.getAttribute?.("data-message-id") ||
      el.getAttribute?.("data-legacy-message-id") ||
      el.getAttribute?.("data-msg-id") ||
      null;

    const threadId =
      el.getAttribute?.("data-thread-id") ||
      el.getAttribute?.("data-legacy-thread-id") ||
      el.getAttribute?.("data-thr-id") ||
      null;

    if (messageId || threadId) return { messageId, threadId };
    el = el.parentElement;
  }
  return { messageId: null, threadId: null };
}

function findIdsInDocument() {
  try {
    const messageEls = document.querySelectorAll(
      "[data-message-id],[data-legacy-message-id],[data-msg-id]"
    );
    const threadEls = document.querySelectorAll(
      "[data-thread-id],[data-legacy-thread-id],[data-thr-id]"
    );

    const lastMessageEl = messageEls.length ? messageEls[messageEls.length - 1] : null;
    const lastThreadEl = threadEls.length ? threadEls[threadEls.length - 1] : null;

    const messageId =
      lastMessageEl?.getAttribute?.("data-message-id") ||
      lastMessageEl?.getAttribute?.("data-legacy-message-id") ||
      lastMessageEl?.getAttribute?.("data-msg-id") ||
      null;

    const threadId =
      lastThreadEl?.getAttribute?.("data-thread-id") ||
      lastThreadEl?.getAttribute?.("data-legacy-thread-id") ||
      lastThreadEl?.getAttribute?.("data-thr-id") ||
      null;

    return { messageId, threadId };
  } catch {
    return { messageId: null, threadId: null };
  }
}

/************* Insertion *************/
function insertAtCursor(text) {
  const active = document.activeElement;

  // Inputs/textareas
  if (
    active &&
    (active.tagName === "TEXTAREA" ||
      (active.tagName === "INPUT" && active.type === "text"))
  ) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const before = active.value.slice(0, start);
    const after = active.value.slice(end);

    active.value = before + text + after;

    const pos = start + text.length;
    active.selectionStart = active.selectionEnd = pos;
    active.focus();
    return;
  }

  // contentEditable (Gmail compose)
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const anchor = sel.anchorNode;
  const root = anchor && getEditableRoot(anchor);
  if (!root) return;

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);

  range.setStartAfter(node);
  range.setEndAfter(node);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getEditableRoot(node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el) {
    if (el.isContentEditable) return el;
    el = el.parentElement;
  }
  return null;
}

function openRoutingModal(payload) {
  ensureRoutingModalStyles();
  closeRoutingModal();

  const budgetEntries = normalizeBudgetEntries(payload?.budgetEntries);
  const envelopeEntries = normalizeEnvelopeEntries(payload?.envelopeEntries);

  const overlay = document.createElement("div");
  overlay.id = ROUTING_MODAL_ID;
  overlay.className = "parish-routing-overlay";

  const modal = document.createElement("div");
  modal.className = "parish-routing-modal";
  overlay.appendChild(modal);

  const header = document.createElement("div");
  header.className = "parish-routing-header";
  header.innerHTML = `
    <h3>Route AP/AR Email</h3>
    <button type="button" class="parish-routing-close" aria-label="Close">&times;</button>
  `;
  modal.appendChild(header);

  const tabRow = document.createElement("div");
  tabRow.className = "parish-routing-tabs";
  tabRow.innerHTML = `
    <button type="button" data-mode="ap" class="parish-routing-tab active">AP</button>
    <button type="button" data-mode="ar" class="parish-routing-tab">AR</button>
  `;
  modal.appendChild(tabRow);

  const body = document.createElement("div");
  body.className = "parish-routing-body";
  modal.appendChild(body);

  const errorEl = document.createElement("div");
  errorEl.className = "parish-routing-error";
  errorEl.setAttribute("aria-live", "polite");
  modal.appendChild(errorEl);

  const footer = document.createElement("div");
  footer.className = "parish-routing-footer";
  footer.innerHTML = `
    <button type="button" class="parish-routing-btn secondary" data-action="cancel">Cancel</button>
    <button type="button" class="parish-routing-btn primary" data-action="route">Route</button>
  `;
  modal.appendChild(footer);

  const apSection = document.createElement("div");
  apSection.className = "parish-routing-section";
  body.appendChild(apSection);

  const apRouteKindId = `${ROUTING_MODAL_ID}-ap-routekind`;
  const apCodeId = `${ROUTING_MODAL_ID}-ap-code`;
  const apVendorId = `${ROUTING_MODAL_ID}-ap-vendor`;
  apSection.innerHTML = `
    <label for="${apRouteKindId}">AP Route Type</label>
    <select id="${apRouteKindId}">
      <option value="BILL">Invoice (BILL)</option>
      <option value="DB">Direct Debit (DB)</option>
    </select>
    <label for="${apCodeId}">Budget Code</label>
    <select id="${apCodeId}"></select>
    <label for="${apVendorId}">Vendor</label>
    <input id="${apVendorId}" type="text" autocomplete="off" placeholder="Required (e.g. SoCalGas)" />
  `;

  const arSection = document.createElement("div");
  arSection.className = "parish-routing-section hidden";
  body.appendChild(arSection);

  const arEnvId = `${ROUTING_MODAL_ID}-ar-envelope`;
  const arDesignationId = `${ROUTING_MODAL_ID}-ar-designation`;
  arSection.innerHTML = `
    <label for="${arEnvId}">Envelope Number</label>
    <select id="${arEnvId}"></select>
    <label for="${arDesignationId}">Designation</label>
    <input id="${arDesignationId}" type="text" autocomplete="off" placeholder="Required (e.g. Rent)" />
  `;

  const apRouteKindSelect = apSection.querySelector(`#${CSS.escape(apRouteKindId)}`);
  const apCodeSelect = apSection.querySelector(`#${CSS.escape(apCodeId)}`);
  const apVendorInput = apSection.querySelector(`#${CSS.escape(apVendorId)}`);
  const arEnvelopeSelect = arSection.querySelector(`#${CSS.escape(arEnvId)}`);
  const arDesignationInput = arSection.querySelector(`#${CSS.escape(arDesignationId)}`);
  const cancelBtn = footer.querySelector('[data-action="cancel"]');
  const routeBtn = footer.querySelector('[data-action="route"]');
  const closeBtn = header.querySelector(".parish-routing-close");
  const tabButtons = Array.from(tabRow.querySelectorAll(".parish-routing-tab"));

  populateSelect(apCodeSelect, budgetEntries, (entry) => ({
    value: entry.code,
    label: entry.line ? `${entry.code} - ${entry.line}` : entry.code
  }));
  populateSelect(arEnvelopeSelect, envelopeEntries, (entry) => ({
    value: entry.number,
    label: entry.name ? `${entry.number} - ${entry.name}` : entry.number
  }));

  const state = {
    overlay,
    mode: "ap",
    busy: false,
    refs: {
      apSection,
      arSection,
      apRouteKindSelect,
      apCodeSelect,
      apVendorInput,
      arEnvelopeSelect,
      arDesignationInput,
      routeBtn,
      cancelBtn,
      closeBtn,
      tabButtons,
      errorEl
    },
    onEsc: null
  };
  routingModalState = state;

  const setMode = (mode) => {
    if (!routingModalState) return;
    state.mode = mode === "ar" ? "ar" : "ap";
    state.refs.apSection.classList.toggle("hidden", state.mode !== "ap");
    state.refs.arSection.classList.toggle("hidden", state.mode !== "ar");
    state.refs.tabButtons.forEach((button) => {
      const active = button.getAttribute("data-mode") === state.mode;
      button.classList.toggle("active", active);
    });
    clearModalError();
    if (state.mode === "ap") {
      state.refs.apVendorInput.focus();
    } else {
      state.refs.arDesignationInput.focus();
    }
  };

  const setBusy = (busy) => {
    if (!routingModalState) return;
    state.busy = Boolean(busy);
    const disabled = state.busy;
    state.refs.apRouteKindSelect.disabled = disabled;
    state.refs.apCodeSelect.disabled = disabled;
    state.refs.apVendorInput.disabled = disabled;
    state.refs.arEnvelopeSelect.disabled = disabled;
    state.refs.arDesignationInput.disabled = disabled;
    state.refs.cancelBtn.disabled = disabled;
    state.refs.closeBtn.disabled = disabled;
    state.refs.tabButtons.forEach((button) => {
      button.disabled = disabled;
    });
    state.refs.routeBtn.disabled = disabled;
    state.refs.routeBtn.textContent = disabled ? "Routing..." : "Route";
  };

  const submitModal = () => {
    const normalized = buildModalSubmission(state);
    if (!normalized.ok) {
      setModalError(normalized.error || "Missing required fields.");
      return;
    }
    setModalError("");
    setBusy(true);

    chrome.runtime.sendMessage(
      {
        type: "submitRoutingModal",
        payload: normalized.payload
      },
      (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          setBusy(false);
          setModalError(String(err.message || "Failed to submit routing request."));
          return;
        }
        if (response?.ok) {
          closeRoutingModal();
          return;
        }
        setBusy(false);
        setModalError(String(response?.error || "Routing failed."));
      }
    );
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay && !state.busy) {
      closeRoutingModal();
    }
  });
  cancelBtn.addEventListener("click", () => {
    if (!state.busy) closeRoutingModal();
  });
  closeBtn.addEventListener("click", () => {
    if (!state.busy) closeRoutingModal();
  });
  routeBtn.addEventListener("click", submitModal);
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (state.busy) return;
      setMode(button.getAttribute("data-mode"));
    });
  });

  modal.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!state.busy) submitModal();
    }
  });

  state.onEsc = (event) => {
    if (event.key === "Escape" && !state.busy) {
      closeRoutingModal();
    }
  };
  document.addEventListener("keydown", state.onEsc, true);

  document.documentElement.appendChild(overlay);
  setMode("ap");
}

function closeRoutingModal() {
  const existing = document.getElementById(ROUTING_MODAL_ID);
  if (existing) existing.remove();
  if (routingModalState?.onEsc) {
    document.removeEventListener("keydown", routingModalState.onEsc, true);
  }
  routingModalState = null;
}

function setModalError(text) {
  const errorEl = routingModalState?.refs?.errorEl;
  if (!errorEl) return;
  errorEl.textContent = String(text || "");
  errorEl.classList.toggle("visible", Boolean(String(text || "").trim()));
}

function clearModalError() {
  setModalError("");
}

function buildModalSubmission(state) {
  if (!state?.refs) return { ok: false, error: "Routing modal is unavailable." };

  if (state.mode === "ar") {
    const codeValue = String(state.refs.arEnvelopeSelect.value || "").trim();
    const designation = String(state.refs.arDesignationInput.value || "").trim();
    if (!codeValue) return { ok: false, error: "Envelope number is required." };
    if (!designation) return { ok: false, error: "Designation is required." };
    return {
      ok: true,
      payload: {
        routeKind: "CONTRIBUTION",
        codeType: "envelope",
        codeValue,
        designation
      }
    };
  }

  const routeKind = String(state.refs.apRouteKindSelect.value || "BILL").trim().toUpperCase() === "DB"
    ? "DB"
    : "BILL";
  const codeValue = String(state.refs.apCodeSelect.value || "").trim();
  const vendor = String(state.refs.apVendorInput.value || "").trim();
  if (!codeValue) return { ok: false, error: "Budget code is required." };
  if (!vendor) return { ok: false, error: "Vendor is required." };
  return {
    ok: true,
    payload: {
      routeKind,
      codeType: "budget",
      codeValue,
      vendor
    }
  };
}

function normalizeBudgetEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  const normalized = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    if (String(row.type || "").toLowerCase() !== "item") continue;
    const code = String(row.code || "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    normalized.push({
      code,
      line: String(row.line || "").trim(),
      category: String(row.category || "").trim()
    });
  }
  normalized.sort((a, b) => a.code.localeCompare(b.code));
  return normalized;
}

function normalizeEnvelopeEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const normalized = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const number = String(row.number || "").trim();
    if (!number) continue;
    normalized.push({
      number,
      letter: String(row.letter || "").trim(),
      name: String(row.name || "").trim()
    });
  }
  normalized.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  return normalized;
}

function populateSelect(selectEl, entries, formatter) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = entries.length ? "Select..." : "No entries available";
  placeholder.disabled = true;
  placeholder.selected = true;
  selectEl.appendChild(placeholder);

  for (const entry of entries) {
    const mapped = formatter(entry);
    const option = document.createElement("option");
    option.value = String(mapped?.value || "").trim();
    option.textContent = String(mapped?.label || option.value);
    if (!option.value) continue;
    selectEl.appendChild(option);
  }
}

function ensureRoutingModalStyles() {
  if (document.getElementById(ROUTING_MODAL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ROUTING_MODAL_STYLE_ID;
  style.textContent = `
    .parish-routing-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(17, 24, 39, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
    }
    .parish-routing-modal {
      width: min(560px, 100%);
      background: #ffffff;
      color: #111827;
      border: 1px solid #d1d5db;
      border-radius: 12px;
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.28);
      padding: 14px;
      font-family: Arial, sans-serif;
    }
    .parish-routing-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .parish-routing-header h3 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
    }
    .parish-routing-close {
      border: none;
      background: transparent;
      color: #6b7280;
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      padding: 0 6px;
    }
    .parish-routing-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
    }
    .parish-routing-tab {
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      color: #1f2937;
      border-radius: 8px;
      padding: 8px 10px;
      cursor: pointer;
      font-weight: 600;
    }
    .parish-routing-tab.active {
      background: #e0f2fe;
      border-color: #38bdf8;
      color: #0c4a6e;
    }
    .parish-routing-body {
      margin-bottom: 10px;
    }
    .parish-routing-section {
      display: grid;
      gap: 6px;
    }
    .parish-routing-section.hidden {
      display: none;
    }
    .parish-routing-section label {
      font-size: 12px;
      color: #4b5563;
      margin-top: 2px;
    }
    .parish-routing-section select,
    .parish-routing-section input {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      box-sizing: border-box;
      color: #111827;
      background: #ffffff;
    }
    .parish-routing-error {
      min-height: 18px;
      font-size: 12px;
      color: #b91c1c;
      margin-bottom: 10px;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .parish-routing-error.visible {
      opacity: 1;
    }
    .parish-routing-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .parish-routing-btn {
      border-radius: 8px;
      border: 1px solid transparent;
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 600;
    }
    .parish-routing-btn.secondary {
      background: #f3f4f6;
      border-color: #d1d5db;
      color: #111827;
    }
    .parish-routing-btn.primary {
      background: #0ea5e9;
      border-color: #0284c7;
      color: #ffffff;
    }
    .parish-routing-btn:disabled,
    .parish-routing-tab:disabled,
    .parish-routing-close:disabled,
    .parish-routing-section select:disabled,
    .parish-routing-section input:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `;
  document.documentElement.appendChild(style);
}

function showToast(message, ok) {
  const existing = document.getElementById("parish-code-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "parish-code-toast";
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.zIndex = "2147483647";
  toast.style.top = "16px";
  toast.style.right = "16px";
  toast.style.padding = "10px 14px";
  toast.style.borderRadius = "8px";
  toast.style.fontSize = "12px";
  toast.style.fontFamily = "Arial, sans-serif";
  toast.style.boxShadow = "0 6px 18px rgba(0,0,0,0.2)";
  toast.style.color = "#111827";
  toast.style.background = ok ? "#dcfce7" : "#fee2e2";
  toast.style.border = ok ? "1px solid #86efac" : "1px solid #fca5a5";
  toast.style.maxWidth = "320px";
  toast.style.pointerEvents = "none";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 150ms ease";

  document.documentElement.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

