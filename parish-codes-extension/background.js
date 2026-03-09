/****************************
 * Parish Codes Extension
 * - Three menu trees: Invoice, Direct Debit, Contribution
 * - Inserts selected code into active Gmail field
 * - Posts job to dashboard server with Bearer token
 ****************************/

/************* CONFIG *************/
// Google Sheets (GViz JSON endpoint) — reuse your current IDs/sheets.
// If your old extensions already have these, paste them here.

const BUDGET_CODES_URL = "http://localhost:3001/api/sharefile/budget-codes";
const ENVELOPE_NUMBERS_URL = "http://localhost:3001/api/sharefile/envelope-numbers";


const BUDGET_SHEET_ID = "1ZhVcRYTabu61CnZxa2dJWMoRoOMI9f1svxGattHNxlU";
const BUDGET_SHEET_NAME = "Sheet1";

const ENV_SHEET_ID = "1SpJ0DE08kc8yKJvaeaegGsexT7mVdhjFA715wasnYd0";
const ENV_SHEET_NAME = "Sheet1";

// Server endpoints
const ROUTE_EMAIL_URL = "http://localhost:3001/api/sharefile/route-email";
const RESOLVE_MESSAGE_URL = "http://localhost:3001/api/sharefile/resolve-message-id";

// Context menu visibility
const MENU_CONTEXTS = ["editable", "selection", "page"];
const GMAIL_URL_PATTERNS = ["https://mail.google.com/*"];
const CONTEXT_MENU_OPEN_MODAL_ID = "open-routing-modal";

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
  await openRoutingModalForTab(tabId);
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
  await openRoutingModalForTab(tabId);
});

/************* MENUS *************/
async function rebuildMenus() {
  chrome.contextMenus.removeAll(async () => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_OPEN_MODAL_ID,
      title: "Open AP/AR Router",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  });
}

async function buildBudgetMenu(rootId, prefix) {
  try {
    const entries = await loadBudgetMenuEntries();

    if (!entries.length) throw new Error("No budget entries parsed");

    // Build categories as submenus
    const categoryIds = {};
    let categoryIndex = 0;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];

      if (e.type === "catDivider") continue;

      if (!e.category) continue;

      if (!categoryIds[e.category]) {
        const catId = `${prefix}-budget-cat-${categoryIndex++}`;
        categoryIds[e.category] = catId;

        chrome.contextMenus.create({
          id: catId,
          parentId: rootId,
          title: e.category,
          contexts: MENU_CONTEXTS,
          documentUrlPatterns: GMAIL_URL_PATTERNS
        });
      }

      const parentId = categoryIds[e.category];

      if (e.type === "codeDivider") continue;

      if (e.type === "heading") {
        chrome.contextMenus.create({
          id: `${prefix}-budget-head-${e.category}-${i}`,
          parentId,
          title: e.label,
          enabled: false,
          contexts: MENU_CONTEXTS,
          documentUrlPatterns: GMAIL_URL_PATTERNS
        });
        continue;
      }

      if (e.type === "item") {
        const code = String(e.code || "").trim();
        const encodedCode = encodeURIComponent(code);
        const id = `${prefix}-budget-code-${e.category}-${i}-${encodedCode}`;
        const title = e.line ? `${code} · ${e.line}` : code;

        chrome.contextMenus.create({
          id,
          parentId,
          title,
          contexts: MENU_CONTEXTS,
          documentUrlPatterns: GMAIL_URL_PATTERNS
        });
      }
    }

    // Footer items
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
      title: "↻ Refresh budget codes",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  } catch (err) {
    console.error("[Parish Codes] Budget menu build failed:", err);

    chrome.contextMenus.create({
      id: `${prefix}-budget-error`,
      parentId: rootId,
      title: "⚠ Could not load budget codes (click to retry)",
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
      title: "↻ Refresh budget codes",
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

    const maxDigits = entries.reduce((max, e) => Math.max(max, e.number.length), 0);

    const letters = Array.from(new Set(entries.map(e => e.letter).filter(Boolean))).sort();
    const letterIds = {};

    for (const letter of letters) {
      const lid = `${prefix}-env-letter-${letter}`;
      letterIds[letter] = lid;

      chrome.contextMenus.create({
        id: lid,
        parentId: rootId,
        title: letter,
        contexts: MENU_CONTEXTS,
        documentUrlPatterns: GMAIL_URL_PATTERNS
      });
    }

    entries.forEach((item, idx) => {
      const parentId = letterIds[item.letter];
      if (!parentId) return;

      const title = formatAlignedTitle(item.number, item.name, maxDigits);
      const id = `${prefix}-env-item-${item.letter}-${idx}-${item.number}`;

      chrome.contextMenus.create({
        id,
        parentId,
        title,
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
      title: "↻ Refresh envelope numbers",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  } catch (err) {
    console.error("[Parish Codes] Envelope menu build failed:", err);

    chrome.contextMenus.create({
      id: `${prefix}-env-error`,
      parentId: rootId,
      title: "⚠ Could not load envelope numbers (click to retry)",
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
      title: "↻ Refresh envelope numbers",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: GMAIL_URL_PATTERNS
    });
  }
}

/************* CLICK HANDLER *************/
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (String(info.menuItemId || "") !== CONTEXT_MENU_OPEN_MODAL_ID) return;
  await openRoutingModalForTab(tab.id);
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

      const gmailContext = await getGmailContext(tabId, sender?.frameId);
      const payload = {
        action: "modal_submit",
        codeType: modalPayload.codeType,
        codeValue: modalPayload.codeValue,
        routeKind: modalPayload.routeKind,
        designation: modalPayload.designation,
        vendor: modalPayload.vendor,
        gmail: gmailContext,
        page: { url: sender?.tab?.url || null },
        client: { ts: new Date().toISOString() }
      };

      let result = await postRouteEmail(payload);
      if (!result?.ok && /Missing messageId|Unable to resolve a specific Gmail messageId/i.test(String(result?.error || ""))) {
        const refreshedContext = await getGmailContext(tabId, sender?.frameId);
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

function parseClickedCode(menuItemId) {
  if (typeof menuItemId !== "string") return null;

  if (menuItemId.startsWith("invoice-budget-code-")) {
    const codeValue = decodeCodeFromMenuId(menuItemId);
    if (!codeValue) return null;
    return { codeType: "budget", codeValue, routeKind: "BILL" };
  }

  if (menuItemId.startsWith("direct-budget-code-")) {
    const codeValue = decodeCodeFromMenuId(menuItemId);
    if (!codeValue) return null;
    return { codeType: "budget", codeValue, routeKind: "DB" };
  }

  if (menuItemId.startsWith("contrib-env-item-")) {
    const codeValue = menuItemId.split("-").at(-1)?.trim();
    if (!codeValue) return null;
    return { codeType: "envelope", codeValue, routeKind: "CONTRIBUTION", designation: "", insertText: codeValue };
  }

  if (menuItemId === "contrib-designation-rent") {
    return { codeType: "envelope", codeValue: "", routeKind: "CONTRIBUTION", designation: "Rent", insertText: "Rent" };
  }

  return null;
}

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

async function openRoutingModalForTab(tabId) {
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
        envelopeEntries
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
  const normalizedRouteKind = routeKind === "DB"
    ? "DB"
    : routeKind === "CONTRIBUTION"
      ? "CONTRIBUTION"
      : "BILL";
  const codeType = normalizedRouteKind === "CONTRIBUTION" ? "envelope" : "budget";

  if (!codeValue) {
    return { ok: false, error: normalizedRouteKind === "CONTRIBUTION" ? "Envelope is required." : "Budget code is required." };
  }
  if (normalizedRouteKind === "CONTRIBUTION" && !designation) {
    return { ok: false, error: "Designation is required for AR." };
  }
  if (normalizedRouteKind !== "CONTRIBUTION" && !vendor) {
    return { ok: false, error: "Vendor is required for AP." };
  }

  return {
    ok: true,
    routeKind: normalizedRouteKind,
    codeType,
    codeValue,
    designation: normalizedRouteKind === "CONTRIBUTION" ? designation : "",
    vendor: normalizedRouteKind === "CONTRIBUTION" ? "" : vendor
  };
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

    // If server needs a messageId and we only have threadId, optionally resolve then retry.
    if (!res.ok) {
      const text = await safeText(res);
      console.warn("[Parish Codes] route-email failed:", res.status, text);

      // Optional fallback: if we got a threadId but not messageId, try resolve endpoint and retry once.
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

/************* DATA FETCH: BUDGET (GViz) *************/
function budgetGvizUrl() {
  return `https://docs.google.com/spreadsheets/d/${BUDGET_SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(BUDGET_SHEET_NAME)}&tqx=out:json`;
}

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


function isBudgetHeaderRow(cat, code, line) {
  const a = (cat || "").toLowerCase();
  const b = (code || "").toLowerCase();
  const c = (line || "").toLowerCase();
  return (
    (a === "category" || a === "budget category") &&
    (b === "code" || b === "budget code") &&
    (c === "line" || c === "description" || c === "budget line")
  );
}

/************* DATA FETCH: ENVELOPES (GViz) *************/
function envGvizUrl() {
  return `https://docs.google.com/spreadsheets/d/${ENV_SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(ENV_SHEET_NAME)}&tqx=out:json`;
}

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

  // Optional: sort defensively
  data.entries.sort((a, b) => (String(a.letter).localeCompare(String(b.letter)) || String(a.number).localeCompare(String(b.number))));
  return data.entries;
}

function getLastName(name) {
  if (!name) return "";
  let n = String(name).trim();
  if (n.includes("/")) n = n.split("/")[0].trim();
  if (n.includes(",")) return n.split(",")[0].trim();

  const parts = n.split(/\s+/);
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

  while (parts.length > 1) {
    const last = parts.at(-1).replace(/\./g, "").toLowerCase();
    if (suffixes.has(last)) parts.pop();
    else break;
  }
  return parts.at(-1) || "";
}

function formatAlignedTitle(number, name, maxDigits) {
  const nbsp = "\u00A0";
  const diff = maxDigits - number.length;
  const pad = nbsp.repeat(Math.max(0, diff + 2));
  return name ? `${number}${pad}${name}` : number;
}

function decodeCodeFromMenuId(menuItemId) {
  const encoded = String(menuItemId || "").split("-").at(-1)?.trim();
  if (!encoded) return "";

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
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
