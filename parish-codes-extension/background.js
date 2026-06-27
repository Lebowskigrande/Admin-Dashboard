/****************************
 * Parish Codes Extension
 * - Three menu trees: Invoice, Direct Debit, Contribution
 * - Sends AP invoice routing into the finance dashboard
 * - Posts job to dashboard server with Bearer token
 ****************************/

/************* CONFIG *************/
const BUDGET_CODES_URL = "http://localhost:3001/api/sharefile/budget-codes";
const ENVELOPE_NUMBERS_URL = "http://localhost:3001/api/sharefile/envelope-numbers";

// Server endpoints
const ROUTE_EMAIL_URL = "http://localhost:3001/api/sharefile/route-email";
const RESOLVE_MESSAGE_URL = "http://localhost:3001/api/sharefile/resolve-message-id";
const DASHBOARD_HANDOFF_URL = "http://localhost:3001/api/sharefile/dashboard-handoffs";

// Context menu visibility
const MENU_CONTEXTS = ["editable", "selection", "page"];
const GMAIL_URL_PATTERNS = ["https://mail.google.com/*"];
const INVOICE_ROOT_ID = "invoice-root";
const DIRECT_ROOT_ID = "direct-root";
const CONTRIBUTION_ROOT_ID = "contrib-root";

// storage keys
const STORAGE_KEYS = {
  TOKEN: "sharefile_extension_token"
};

/************* LIFECYCLE *************/
chrome.runtime.onInstalled.addListener(() => rebuildMenus());
chrome.runtime.onStartup.addListener(() => rebuildMenus());
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = Number(tab?.id || 0);
  if (!tabId) return;
  if (!isGmailUrl(tab?.url || "")) {
    await showToastInTab(tabId, "Open a Gmail message, then click the extension icon.", false);
    return;
  }
  await openDashboardFinanceRouterForTab(tabId);
});
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== "open-routing-modal") return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs?.[0];
  const tabId = Number(active?.id || 0);
  if (!tabId) return;
  if (!isGmailUrl(active?.url || "")) {
    await showToastInTab(tabId, "Open a Gmail message, then run the routing shortcut.", false);
    return;
  }
  await openDashboardFinanceRouterForTab(tabId);
});

/************* MENUS *************/
async function rebuildMenus() {
  chrome.contextMenus.removeAll(async () => {
    chrome.contextMenus.create({
      id: INVOICE_ROOT_ID,
      title: "Invoice",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: DIRECT_ROOT_ID,
      title: "Direct Debit",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: CONTRIBUTION_ROOT_ID,
      title: "Contribution",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    await Promise.allSettled([
      buildBudgetMenu(INVOICE_ROOT_ID, "invoice"),
      buildBudgetMenu(DIRECT_ROOT_ID, "direct"),
      buildEnvelopeMenu(CONTRIBUTION_ROOT_ID, "contrib")
    ]);
  });
}

async function buildBudgetMenu(rootId, prefix) {
  try {
    const entries = await loadBudgetMenuEntries();
    if (!entries.length) throw new Error("No budget entries parsed");

    const categoryIds = {};
    let categoryIndex = 0;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry || typeof entry !== "object") continue;
      if (entry.type === "catDivider" || !entry.category) continue;

      if (!categoryIds[entry.category]) {
        const categoryId = `${prefix}-budget-cat-${categoryIndex}`;
        categoryIds[entry.category] = categoryId;
        categoryIndex += 1;

        chrome.contextMenus.create({
          id: categoryId,
          parentId: rootId,
          title: entry.category,
          contexts: MENU_CONTEXTS,
          documentUrlPatterns: GMAIL_URL_PATTERNS
        });
      }

      const parentId = categoryIds[entry.category];
      if (entry.type === "codeDivider") continue;

      if (entry.type === "heading") {
        chrome.contextMenus.create({
          id: `${prefix}-budget-head-${categoryIndex}-${i}`,
          parentId,
          title: String(entry.label || "").trim(),
          enabled: false,
          contexts: MENU_CONTEXTS,
          documentUrlPatterns: GMAIL_URL_PATTERNS
        });
        continue;
      }

      if (entry.type !== "item") continue;
      const code = String(entry.code || "").trim();
      if (!code) continue;

      chrome.contextMenus.create({
        id: `${prefix}-budget-code-${i}-${encodeURIComponent(code)}`,
        parentId,
        title: entry.line ? `${code} · ${entry.line}` : code,
        contexts: MENU_CONTEXTS,
        documentUrlPatterns: GMAIL_URL_PATTERNS
      });
    }

    chrome.contextMenus.create({
      id: `${prefix}-budget-bottom-sep`,
      parentId: rootId,
      type: "separator",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: `${prefix}-budget-refresh`,
      parentId: rootId,
      title: "Refresh budget codes",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  } catch (error) {
    console.error("[Parish Codes] Budget menu build failed:", error);

    chrome.contextMenus.create({
      id: `${prefix}-budget-error`,
      parentId: rootId,
      title: "Could not load budget codes (click to retry)",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: `${prefix}-budget-bottom-sep`,
      parentId: rootId,
      type: "separator",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: `${prefix}-budget-refresh`,
      parentId: rootId,
      title: "Refresh budget codes",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  }
}

async function buildEnvelopeMenu(rootId, prefix) {
  try {
    const entries = await loadEnvelopeData();
    if (!entries.length) throw new Error("No envelope entries parsed");

    chrome.contextMenus.create({
      id: `${prefix}-designation-rent`,
      parentId: rootId,
      title: "Rent (no envelope)",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: `${prefix}-designation-sep`,
      parentId: rootId,
      type: "separator",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    const maxDigits = entries.reduce((max, entry) => Math.max(max, String(entry?.number || "").length), 0);
    const letters = Array.from(new Set(entries.map((entry) => String(entry?.letter || "").trim()).filter(Boolean))).sort();
    const letterIds = {};

    for (const letter of letters) {
      const letterId = `${prefix}-env-letter-${letter}`;
      letterIds[letter] = letterId;

      chrome.contextMenus.create({
        id: letterId,
        parentId: rootId,
        title: letter,
        contexts: MENU_CONTEXTS,
        documentUrlPatterns: GMAIL_URL_PATTERNS
      });
    }

    entries.forEach((item, index) => {
      const letter = String(item?.letter || "").trim();
      const number = String(item?.number || "").trim();
      const parentId = letterIds[letter];
      if (!parentId || !number) return;

      chrome.contextMenus.create({
        id: `${prefix}-env-item-${index}-${encodeURIComponent(number)}`,
        parentId,
        title: formatAlignedTitle(number, String(item?.name || "").trim(), maxDigits),
        contexts: MENU_CONTEXTS,
        documentUrlPatterns: GMAIL_URL_PATTERNS
      });
    });

    chrome.contextMenus.create({
      id: `${prefix}-env-bottom-sep`,
      parentId: rootId,
      type: "separator",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: `${prefix}-env-refresh`,
      parentId: rootId,
      title: "Refresh envelope numbers",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  } catch (error) {
    console.error("[Parish Codes] Envelope menu build failed:", error);

    chrome.contextMenus.create({
      id: `${prefix}-env-error`,
      parentId: rootId,
      title: "Could not load envelope numbers (click to retry)",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: `${prefix}-env-bottom-sep`,
      parentId: rootId,
      type: "separator",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });

    chrome.contextMenus.create({
      id: `${prefix}-env-refresh`,
      parentId: rootId,
      title: "Refresh envelope numbers",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  }
}

/************* CLICK HANDLER *************/
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const menuItemId = String(info.menuItemId || "");
  if (menuItemId.endsWith("budget-refresh") || menuItemId.endsWith("budget-error")) {
    await rebuildMenus();
    return;
  }
  if (menuItemId.endsWith("env-refresh") || menuItemId.endsWith("env-error")) {
    await rebuildMenus();
    return;
  }

  const selection = parseClickedCode(menuItemId);
  if (!selection) return;
  if (selection.routeKind === "CONTRIBUTION") {
    await openRoutingModalForTab(tab.id, selection);
    return;
  }
  await openDashboardFinanceRouterForTab(tab.id, selection);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "submitRoutingModal") return;

  (async () => {
    try {
      const tabId = Number(sender?.tab?.id || 0);
      if (!tabId) {
        sendResponse({ ok: false, error: "Could not resolve active Gmail tab." });
        return;
      }

      const modalPayload = normalizeModalPayload(msg.payload || {});
      if (!modalPayload.ok) {
        await showToastInTab(tabId, modalPayload.error, false);
        sendResponse({ ok: false, error: modalPayload.error });
        return;
      }

      const gmailContext = await resolveGmailContextForTab(tabId, sender?.frameId);
      const payload = {
        action: "modal_submit",
        codeType: modalPayload.codeType,
        codeValue: modalPayload.codeValue,
        routeKind: modalPayload.routeKind,
        designation: modalPayload.designation,
        vendor: modalPayload.vendor,
        amount: modalPayload.amount,
        gmail: gmailContext,
        page: { url: sender?.tab?.url || null },
        client: { ts: new Date().toISOString() }
      };

      let result = await postRouteEmail(payload);
      if (!result?.ok && /Missing messageId|Unable to resolve a specific Gmail messageId/i.test(String(result?.error || ""))) {
        const refreshedContext = await resolveGmailContextForTab(tabId, sender?.frameId);
        if (refreshedContext?.messageId || refreshedContext?.threadId) {
          result = await postRouteEmail({
            ...payload,
            gmail: refreshedContext
          });
        }
      }

      const toastText = result?.ok
        ? "Email routed successfully."
        : formatRouteFailureMessage(result);
      await showToastInTab(tabId, toastText, Boolean(result?.ok));
      sendResponse(result?.ok ? { ok: true } : { ok: false, error: toastText });
    } catch (error) {
      const text = String(error?.message || error || "Routing failed");
      const tabId = Number(sender?.tab?.id || 0);
      if (tabId) {
        await showToastInTab(tabId, text, false);
      }
      sendResponse({ ok: false, error: text });
    }
  })();

  return true;
});

async function getGmailContext(tabId, frameId) {
  let result = await sendMessageSafe(tabId, { type: "getGmailContext" }, frameId, { expectResponse: true });
  if (result) return result;

  await ensureContentScriptInjected(tabId);
  result = await sendMessageSafe(tabId, { type: "getGmailContext" }, frameId, { expectResponse: true });
  return result || { ok: false };
}

function isGmailUrl(value) {
  return /^https:\/\/mail\.google\.com\//i.test(String(value || ""));
}

function parseIdsFromGmailUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return { threadId: "", messageId: "" };

  const readQueryValue = (pattern) => {
    const match = raw.match(pattern);
    return match?.[1] ? decodeURIComponentSafe(match[1]) : "";
  };

  const messageId = readQueryValue(/[?&](?:permmsgid|message_id)=([^&#]+)/i);
  const threadIdFromQuery = readQueryValue(/[?&](?:th|thread_id|permthid)=([0-9a-f]{10,})(?:$|[&#])/i);
  const hash = (raw.split("#")[1] || "").trim();
  if (!hash) {
    return {
      threadId: /^[0-9a-f]{10,}$/i.test(threadIdFromQuery) ? threadIdFromQuery : "",
      messageId
    };
  }

  const hashThread = hash.match(/(?:^|[?&/])(?:th|thread_id|permthid)=([0-9a-f]{10,})(?:$|[&#/])/i)?.[1] || "";
  const parts = hash.split("/").filter(Boolean);
  const trailing = parts.at(-1) || "";
  const threadId = /^[0-9a-f]{10,}$/i.test(threadIdFromQuery)
    ? threadIdFromQuery
    : (/^[0-9a-f]{10,}$/i.test(hashThread) ? hashThread : (/^[0-9a-f]{10,}$/i.test(trailing) ? trailing : ""));

  return {
    threadId,
    messageId
  };
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

async function resolveGmailContextForTab(tabId, frameId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const fromMessage = await getGmailContext(tabId, frameId);
  const fromUrl = parseIdsFromGmailUrl(tab?.url || "");
  return {
    ...(fromMessage || {}),
    ok: Boolean(fromMessage?.messageId || fromMessage?.threadId || fromUrl.messageId || fromUrl.threadId),
    href: String(fromMessage?.href || tab?.url || "").trim(),
    threadId: String(fromMessage?.threadId || fromUrl.threadId || "").trim(),
    messageId: String(fromMessage?.messageId || fromUrl.messageId || "").trim(),
    ts: fromMessage?.ts || new Date().toISOString()
  };
}

async function openDashboardFinanceRouterForTab(tabId, initialSelection = null) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const gmailContext = await resolveGmailContextForTab(tabId);
  if (!gmailContext?.messageId && !gmailContext?.threadId) {
    await showToastInTab(tabId, "Open a Gmail message before routing it into Finance.", false);
    return;
  }

  const result = await queueDashboardFinanceHandoff({
    action: "dashboard_handoff",
    codeType: initialSelection?.routeKind === "CONTRIBUTION" ? "envelope" : "budget",
    codeValue: String(initialSelection?.codeValue || "").trim(),
    routeKind: String(initialSelection?.routeKind || "BILL").trim().toUpperCase() || "BILL",
    designation: String(initialSelection?.designation || "").trim(),
    vendor: String(initialSelection?.vendor || "").trim(),
    amount: normalizeAmount(initialSelection?.amount || ""),
    gmail: gmailContext,
    page: { url: tab?.url || "" },
    client: { ts: new Date().toISOString() }
  });

  const toastText = result?.ok
    ? "Queued for the Finance dashboard. The open dashboard can pick it up automatically."
    : formatDashboardHandoffFailureMessage(result);
  await showToastInTab(tabId, toastText, Boolean(result?.ok));
}

async function queueDashboardFinanceHandoff(payload) {
  const token = await getToken();
  if (!token) {
    return { ok: false, error: "missing_token" };
  }

  try {
    const res = await fetch(DASHBOARD_HANDOFF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await safeText(res);
      return { ok: false, status: res.status, error: text };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, data };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function formatDashboardHandoffFailureMessage(result) {
  const status = Number(result?.status || 0) || 0;
  const error = String(result?.error || "");
  if (error === "missing_token") {
    return "Dashboard handoff failed: extension token is missing.";
  }
  if (status === 401 || /Invalid or missing token/i.test(error)) {
    return "Dashboard handoff failed: invalid Bearer token (401).";
  }
  if (/Missing Gmail message context/i.test(error)) {
    return "Dashboard handoff failed: could not read the Gmail message context.";
  }
  if (status >= 500) {
    return "Dashboard handoff failed: server error. Check API logs.";
  }
  if (status >= 400) {
    return `Dashboard handoff failed (${status}).`;
  }
  if (error) {
    return `Dashboard handoff failed: ${error}`;
  }
  return "Dashboard handoff failed.";
}

async function openRoutingModalForTab(tabId, initialSelection = null) {
  await ensureContentScriptInjected(tabId);

  let budgetEntries = [];
  let envelopeEntries = [];
  try {
    [budgetEntries, envelopeEntries] = await Promise.all([
      loadBudgetMenuEntries(),
      loadEnvelopeData()
    ]);
  } catch (error) {
    await showToastInTab(tabId, `Unable to load routing lists: ${String(error?.message || error)}`, false);
    return;
  }

  const opened = await sendMessageSafe(
    tabId,
    {
      type: "openRoutingModal",
      payload: {
        budgetEntries,
        envelopeEntries,
        initialSelection
      }
    },
    undefined,
    { expectResponse: true }
  );

  if (!opened?.ok) {
    await showToastInTab(tabId, "Could not open routing modal in this Gmail tab.", false);
  }
}

function normalizeModalPayload(payload) {
  const routeKind = String(payload?.routeKind || "").trim().toUpperCase();
  const codeValue = String(payload?.codeValue || "").trim();
  const designation = String(payload?.designation || "").trim();
  const vendor = String(payload?.vendor || "").trim();
  const amount = normalizeAmount(payload?.amount || "");
  const normalizedRouteKind = ["BILL", "DB", "EFT", "CHECK", "CONTRIBUTION"].includes(routeKind)
    ? routeKind
    : "BILL";
  const codeType = normalizedRouteKind === "CONTRIBUTION" ? "envelope" : "budget";

  if (normalizedRouteKind === "CONTRIBUTION") {
    if (!codeValue && !designation) {
      return { ok: false, error: "Envelope number or designation is required for AR." };
    }
    if (codeValue && !designation) {
      return { ok: false, error: "Designation is required for AR." };
    }
  } else {
    if (!codeValue) {
      return { ok: false, error: "Budget code is required." };
    }
    if (!vendor) {
      return { ok: false, error: "Vendor is required for AP." };
    }
  }

  return {
    ok: true,
    routeKind: normalizedRouteKind,
    codeType,
    codeValue,
    designation: normalizedRouteKind === "CONTRIBUTION" ? designation : "",
    vendor: normalizedRouteKind === "CONTRIBUTION" ? "" : vendor,
    amount: normalizedRouteKind === "CONTRIBUTION" ? "" : amount
  };
}

function normalizeAmount(value) {
  const raw = String(value || "").replace(/\$/g, "").replace(/,/g, "").trim();
  if (!raw) return "";
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  return parsed.toFixed(2);
}

/************* SERVER CALLS *************/
async function getToken() {
  const obj = await chrome.storage.local.get([STORAGE_KEYS.TOKEN]);
  return obj?.[STORAGE_KEYS.TOKEN] || "";
}

async function postRouteEmail(payload) {
  console.log("[Parish Codes] route-email payload:", payload);
  const token = await getToken();
  if (!token) {
    console.warn("[Parish Codes] No token set. Open extension options and set Bearer token.");
    return { ok: false, error: "missing_token" };
  }

  try {
    const res = await fetch(ROUTE_EMAIL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await safeText(res);
      console.warn("[Parish Codes] route-email failed:", res.status, text);

      const threadId = payload?.gmail?.threadId;
      const messageId = payload?.gmail?.messageId;
      if (!messageId && threadId) {
        const resolved = await resolveMessageId(threadId, token);
        if (resolved?.messageId) {
          const retryPayload = structuredClone(payload);
          retryPayload.gmail.messageId = resolved.messageId;

          const retryRes = await fetch(ROUTE_EMAIL_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(retryPayload)
          });

          if (!retryRes.ok) {
            const retryText = await safeText(retryRes);
            console.warn("[Parish Codes] route-email retry failed:", retryRes.status, retryText);
            return { ok: false, status: retryRes.status, error: retryText };
          }
          return { ok: true, status: retryRes.status };
        }
      }
      return { ok: false, status: res.status, error: text };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[Parish Codes] route-email POST error:", err);
    return { ok: false, error: String(err?.message || err) };
  }
}

function formatRouteFailureMessage(result) {
  const status = Number(result?.status || 0) || 0;
  const error = String(result?.error || "");

  if (error === "missing_token") {
    return "Email routing failed: extension token is missing. Set Bearer token in extension options.";
  }

  if (status === 401 || /Invalid or missing token/i.test(error)) {
    return "Email routing failed: invalid Bearer token (401).";
  }

  if (/Unable to resolve a specific Gmail messageId/i.test(error)) {
    return "Email routing failed: could not read Gmail message id. Open the message and try again.";
  }

  if (/No Gmail tokens configured for ShareFile extension/i.test(error)) {
    return "Email routing failed: no ShareFile Gmail account is connected in Settings.";
  }

  if (/No matching Gmail account found/i.test(error)) {
    return "Email routing failed: connected Gmail account does not match this message.";
  }

  if (status >= 500) {
    return "Email routing failed: server error. Check API logs.";
  }

  if (status >= 400) {
    return `Email routing failed (${status}).`;
  }

  if (error) {
    return `Email routing failed: ${error}`;
  }

  return "Email routing failed. Check extension console.";
}

async function resolveMessageId(threadId, token) {
  try {
    const res = await fetch(RESOLVE_MESSAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ threadId })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}

/************* DATA FETCH: BUDGET *************/
async function loadBudgetMenuEntries() {
  const token = await getToken();
  if (!token) throw new Error("Missing token for budget codes request");

  const res = await fetch(BUDGET_CODES_URL, {
    cache: "no-store",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });
  if (!res.ok) throw new Error(`Budget codes HTTP ${res.status}`);

  const data = await res.json();
  if (!data?.ok || !Array.isArray(data.entries)) {
    throw new Error("Budget codes payload invalid");
  }
  return data.entries;
}

/************* DATA FETCH: ENVELOPES *************/
async function loadEnvelopeData() {
  const token = await getToken();
  if (!token) throw new Error("Missing token for envelope numbers request");

  const res = await fetch(ENVELOPE_NUMBERS_URL, {
    cache: "no-store",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });
  if (!res.ok) throw new Error(`Envelope numbers HTTP ${res.status}`);

  const data = await res.json();
  if (!data?.ok || !Array.isArray(data.entries)) {
    throw new Error("Envelope numbers payload invalid");
  }

  data.entries.sort((a, b) => (String(a.letter).localeCompare(String(b.letter)) || String(a.number).localeCompare(String(b.number))));
  return data.entries;
}

function parseClickedCode(menuItemId) {
  if (typeof menuItemId !== "string") return null;

  if (menuItemId.startsWith("invoice-budget-code-")) {
    const codeValue = decodeMenuToken(menuItemId);
    if (!codeValue) return null;
    return { codeType: "budget", codeValue, routeKind: "BILL", designation: "", vendor: "" };
  }

  if (menuItemId.startsWith("direct-budget-code-")) {
    const codeValue = decodeMenuToken(menuItemId);
    if (!codeValue) return null;
    return { codeType: "budget", codeValue, routeKind: "DB", designation: "", vendor: "" };
  }

  if (menuItemId.startsWith("contrib-env-item-")) {
    const codeValue = decodeMenuToken(menuItemId);
    if (!codeValue) return null;
    return { codeType: "envelope", codeValue, routeKind: "CONTRIBUTION", designation: "", vendor: "" };
  }

  if (menuItemId === "contrib-designation-rent") {
    return { codeType: "envelope", codeValue: "", routeKind: "CONTRIBUTION", designation: "Rent", vendor: "" };
  }

  return null;
}

function decodeMenuToken(menuItemId) {
  const encoded = String(menuItemId || "").split("-").at(-1)?.trim();
  if (!encoded) return "";

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function formatAlignedTitle(number, name, maxDigits) {
  const nbsp = "\u00A0";
  const diff = maxDigits - String(number || "").length;
  const pad = nbsp.repeat(Math.max(0, diff + 2));
  return name ? `${number}${pad}${name}` : number;
}

async function sendMessageSafe(tabId, message, frameId, options = {}) {
  const inFrame = await sendMessageOnce(tabId, message, frameId, options);
  if (inFrame !== null) return inFrame;
  if (typeof frameId !== "number") return null;
  return sendMessageOnce(tabId, message, undefined, options);
}

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
  } catch {
    // ignore
  }
}

async function sendMessageOnce(tabId, message, frameId, options = {}) {
  const expectResponse = Boolean(options.expectResponse);
  return new Promise((resolve) => {
    const callback = (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        const text = String(err.message || "");
        if (text.includes("Receiving end does not exist")) {
          resolve(null);
          return;
        }
        if (!expectResponse && text.includes("message port closed before a response was received")) {
          resolve(true);
          return;
        }
        if (!expectResponse && text.includes("The message port closed before a response was received")) {
          resolve(true);
          return;
        }
        if (!expectResponse && text.includes("A listener indicated an asynchronous response by returning true")) {
          resolve(true);
          return;
        }
        if (!expectResponse) {
          resolve(true);
          return;
        }
        if (expectResponse) {
          console.warn("[Parish Codes] sendMessage failed:", text);
        }
        resolve(null);
        return;
      }
      resolve(response ?? null);
    };

    try {
      if (typeof frameId === "number") {
        chrome.tabs.sendMessage(tabId, message, { frameId }, callback);
      } else {
        chrome.tabs.sendMessage(tabId, message, callback);
      }
    } catch {
      resolve(null);
    }
  });
}

async function showToastInTab(tabId, message, ok) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (msg, success) => {
        const existing = document.getElementById("parish-code-toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.id = "parish-code-toast";
        toast.textContent = String(msg || "");
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
        toast.style.background = success ? "#dcfce7" : "#fee2e2";
        toast.style.border = success ? "1px solid #86efac" : "1px solid #fca5a5";
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
      },
      args: [message, Boolean(ok)]
    });
  } catch {
    // ignore toast failures
  }
}


