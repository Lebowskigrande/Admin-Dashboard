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

