const KEY = "sharefile_extension_token";

const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");

document.getElementById("save").addEventListener("click", async () => {
  const token = tokenEl.value.trim();
  await chrome.storage.local.set({ [KEY]: token });
  statusEl.textContent = token ? "Saved." : "Saved (empty).";
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove([KEY]);
  tokenEl.value = "";
  statusEl.textContent = "Cleared.";
});

(async () => {
  const obj = await chrome.storage.local.get([KEY]);
  tokenEl.value = obj?.[KEY] || "";
})();
