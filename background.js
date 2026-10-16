// Service worker: coordina popup, grabadores (ventana de captura / offscreen), insignia del ícono, barra flotante,
// y la entrega del archivo (PC / Drive).
const BASE = { status: "idle", startedAt: 0, pausedMs: 0, pauseAt: 0, error: "", file: null, deliver: { status: "idle", msg: "", pct: 0 } };

async function getState() {
  const { state } = await chrome.storage.session.get("state");
  if (state) return state;
  const { file } = await chrome.storage.local.get("file"); // la grabación pendiente sobrevive reinicios
  return { ...structuredClone(BASE), file: file || null };
}
async function setState(patch) {
  const s = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ state: s });
  if ("file" in patch) await chrome.storage.local.set({ file: patch.file });
  return s;
}
const setDeliver = (status, msg = "", pct = 0) => setState({ deliver: { status, msg, pct } });
const getCapture = async () => (await chrome.storage.session.get("capture")).capture;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA", "BLOBS"],
    justification: "Grabar la pestaña y entregar el archivo mientras el popup esta cerrado",
  });
}
async function closeOffscreenIfIdle() {
  const s = await getState();
  if (s.status === "idle" && s.deliver.status !== "working" && (await chrome.offscreen.hasDocument())) await chrome.offscreen.closeDocument();
}
const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: "offscreen", ...msg });
const toRecorder = (msg) => chrome.runtime.sendMessage({ target: "recorder", ...msg }).catch(() => {});

// ---- Insignia del ícono (cuenta regresiva y contador) ----
const badge = (text, color = "#E53935") => {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
};
function badgeTime(ms) {
  const s = Math.floor(ms / 1000), p = (n) => String(n).padStart(2, "0");
  return s < 3600 ? `${p(Math.floor(s / 60))}:${p(s % 60)}` : `${Math.floor(s / 3600)}h${p(Math.floor((s % 3600) / 60))}`;
}

// ---- Barra flotante dentro de la página (se serializa e inyecta en la pestaña) ----
function barMain() {
  if (window.__frBar) return;
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%)";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    .b{display:flex;align-items:center;gap:10px;background:#14161a;color:#fff;font:600 14px system-ui,sans-serif;padding:8px 12px;border-radius:999px;box-shadow:0 6px 24px #0008;cursor:grab;user-select:none}
    .d{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:p 1.2s infinite}.p .d{animation:none;background:#8b93a1}
    @keyframes p{50%{opacity:.25}} .t{font-variant-numeric:tabular-nums;min-width:52px}
    button{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#2c313a}
    button:hover{background:#3b4250} .s{background:#ef4444}.s:hover{background:#dc2626}
  </style><div class="b" id="b"><span class="d"></span><span class="t" id="t">00:00</span>
    <button id="pp" title="Pausa / Reanudar">⏸</button><button class="s" id="st" title="Detener">⏹</button></div>`;
  document.documentElement.appendChild(host);
  window.__frBar = host;
  const $ = (id) => root.getElementById(id), b = $("b");
  $("pp").onclick = () => chrome.runtime.sendMessage({ type: "toggle-pause" });
  $("st").onclick = () => chrome.runtime.sendMessage({ type: "stop" });
  let drag = null;
  b.onmousedown = (e) => { if (e.target.tagName === "BUTTON") return; const r = host.getBoundingClientRect(); drag = [e.clientX - r.left, e.clientY - r.top]; };
  addEventListener("mousemove", (e) => { if (drag) host.style.cssText += `;left:${e.clientX - drag[0]}px;top:${e.clientY - drag[1]}px;bottom:auto;transform:none`; });
  addEventListener("mouseup", () => (drag = null));
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === "bar-remove") { host.remove(); window.__frBar = null; }
    if (m.type === "bar-tick") {
      const s = Math.floor(m.ms / 1000), p = (n) => String(n).padStart(2, "0");
      $("t").textContent = (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + p(Math.floor((s % 3600) / 60)) + ":" + p(s % 60);
      b.classList.toggle("p", !!m.paused); $("pp").textContent = m.paused ? "▶" : "⏸";
    }
  });
}
const injectBar = (tabId) => chrome.scripting.executeScript({ target: { tabId }, func: barMain }).catch(() => {});
const removeBar = async () => { const c = await getCapture(); if (c?.tabId) chrome.tabs.sendMessage(c.tabId, { type: "bar-remove" }).catch(() => {}); };

chrome.tabs.onUpdated.addListener(async (id, info) => {
  if (info.status !== "complete") return;
  const s = await getState(), c = await getCapture();
  if ((s.status === "recording" || s.status === "paused") && c?.tabId === id && c.prefs.bar) injectBar(id);
});

// ---- Inicio de grabación ----
async function startScreen(prefs, tabId) {
  await setState({ ...structuredClone(BASE), status: "starting" });
  await chrome.storage.session.set({ capture: { winId: 0, tabId, prefs } }); // la ventana lee las prefs al abrir
  const win = await chrome.windows.create({ url: "capture.html", type: "popup", width: 640, height: 560, focused: true });
  await chrome.storage.session.set({ capture: { winId: win.id, tabId, prefs } });
}

async function startTab(prefs, tabId, streamId) {
  await setState({ ...structuredClone(BASE), status: "starting" });
  await chrome.storage.session.set({ capture: { winId: 0, tabId, prefs } });
  await ensureOffscreen();
  await toOffscreen({ type: "rec-start-tab", streamId, prefs });
}

// El grabador ya tiene el stream: minimizar la ventana, cuenta regresiva en el ícono y arrancar
async function onReady() {
  const c = await getCapture();
  if (!c) return;
  if (c.winId) try { await chrome.windows.update(c.winId, { state: "minimized" }); } catch {}
  if (c.prefs.cd) for (let n = 3; n > 0; n--) { badge(String(n), "#F59E0B"); await sleep(1000); }
  badge("");
  await toRecorder({ type: "rec-go" });
}

// Cierra la ventana de captura (primero se borra 'winId' para que onRemoved no lo tome como error)
async function closeCaptureWindow() {
  const c = await getCapture();
  if (!c) return;
  await chrome.storage.session.set({ capture: { ...c, winId: 0 } });
  if (c.winId) try { await chrome.windows.remove(c.winId); } catch {}
}

chrome.windows.onRemoved.addListener(async (id) => {
  const c = await getCapture();
  if (!c || !c.winId || c.winId !== id) return;
  await chrome.storage.session.set({ capture: { ...c, winId: 0 } });
  const s = await getState();
  if (s.status === "idle") return;
  chrome.power.releaseKeepAwake(); badge(""); removeBar();
  await setState({ status: "idle", error: s.status === "starting" ? "Captura cancelada." : "Se cerró la ventana de grabación; la grabación se interrumpió." });
});

// Al terminar, reabre el panel para guardar (si Chrome no lo permite, lo abre como ventanita)
async function showResult() {
  try { await chrome.action.openPopup(); }
  catch { chrome.windows.create({ url: "popup.html", type: "popup", width: 400, height: 700, focused: true }); }
}

// ---- Pausa / reanudar ----
async function doPause() {
  await toRecorder({ type: "rec-pause" });
  await setState({ status: "paused", pauseAt: Date.now() });
}
async function doResume() {
  const s = await getState();
  await toRecorder({ type: "rec-resume" });
  await setState({ status: "recording", pausedMs: s.pausedMs + (Date.now() - s.pauseAt), pauseAt: 0 });
}

// ---- Google Drive ----
async function getToken(interactive) {
  const { driveToken } = await chrome.storage.session.get("driveToken");
  if (driveToken && driveToken.exp > Date.now() + 60000) return driveToken.value;
  const { clientId } = await chrome.storage.local.get("clientId");
  if (!clientId) throw new Error("Falta el Client ID de Drive (sección Google Drive).");
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: clientId, response_type: "token", redirect_uri: chrome.identity.getRedirectURL(),
    scope: "https://www.googleapis.com/auth/drive.file",
  });
  let res;
  try { res = await chrome.identity.launchWebAuthFlow({ url, interactive: false }); }
  catch (e) { if (!interactive) throw e; res = await chrome.identity.launchWebAuthFlow({ url, interactive: true }); }
  const p = new URLSearchParams(new URL(res).hash.slice(1));
  await chrome.storage.session.set({ driveToken: { value: p.get("access_token"), exp: Date.now() + (+p.get("expires_in") || 3000) * 1000 } });
  return p.get("access_token");
}

async function testDrive() {
  const token = await getToken(true);
  const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).user.emailAddress;
}

// ---- Entrega: PC y/o Drive, luego liberar el temporal ----
function waitDownload(id) {
  return new Promise((resolve, reject) => {
    const h = (d) => {
      if (d.id !== id || !d.state) return;
      if (d.state.current === "complete") { chrome.downloads.onChanged.removeListener(h); resolve(); }
      else if (d.state.current === "interrupted") { chrome.downloads.onChanged.removeListener(h); reject(new Error("Guardado cancelado.")); }
    };
    chrome.downloads.onChanged.addListener(h);
  });
}

async function deliver({ local, drive, free, outName }) {
  const { file } = await getState();
  if (!file || (!local && !drive)) return;
  try {
    await ensureOffscreen();
    if (local) {
      await setDeliver("working", "Elegí dónde guardar en tu PC…");
      const url = await toOffscreen({ type: "make-url", name: file.name });
      const id = await chrome.downloads.download({ url, filename: outName || file.name, saveAs: true });
      await waitDownload(id);
    }
    if (drive) {
      await setDeliver("working", "Conectando con Drive…");
      const token = await getToken(true);
      const r = await toOffscreen({ type: "upload", token, name: file.name, driveName: outName || file.name });
      if (!r.ok) throw new Error(r.error);
    }
    if (free) {
      await toOffscreen({ type: "delete", name: file.name });
      await setState({ file: null });
    }
    await setDeliver("done", free ? "Listo ✔ Espacio temporal liberado." : "Listo ✔");
  } catch (e) {
    await setDeliver("error", e.message);
  }
  await closeOffscreenIfIdle();
}

async function discard() {
  const { file } = await getState();
  if (file) { await ensureOffscreen(); await toOffscreen({ type: "delete", name: file.name }); }
  await setState({ file: null, deliver: { status: "idle", msg: "", pct: 0 } });
  await closeOffscreenIfIdle();
}

// ---- Mensajes ----
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.target) return;
  (async () => {
    switch (m.type) {
      case "start": m.prefs.src === "tab" ? await startTab(m.prefs, m.tabId, m.streamId) : await startScreen(m.prefs, m.tabId); break;
      case "stop": await toRecorder({ type: "rec-stop" }); await setState({ status: "saving" }); badge(""); break;
      case "pause": await doPause(); break;
      case "resume": await doResume(); break;
      case "toggle-pause": (await getState()).status === "paused" ? await doResume() : await doPause(); break;
      case "deliver": deliver(m); break;
      case "discard": await discard(); break;
      case "test-drive": try { reply({ ok: true, email: await testDrive() }); } catch (e) { reply({ ok: false, error: e.message }); } return;

      // eventos desde el grabador
      case "rec-ready": await onReady(); break;
      case "rec-started": {
        await setState({ status: "recording", startedAt: Date.now(), error: "" });
        chrome.power.requestKeepAwake("display");
        const c = await getCapture();
        if (c?.prefs.bar && c.tabId) injectBar(c.tabId);
        break;
      }
      case "tick": {
        badge(m.paused ? "II" : badgeTime(m.ms), m.paused ? "#6B7280" : "#E53935");
        const c = await getCapture();
        if (c?.tabId) chrome.tabs.sendMessage(c.tabId, { type: "bar-tick", ms: m.ms, paused: m.paused }).catch(() => {});
        break;
      }
      case "rec-error":
        chrome.power.releaseKeepAwake(); badge(""); await removeBar(); await closeCaptureWindow();
        await setState({ status: "idle", error: m.error }); await closeOffscreenIfIdle();
        break;
      case "rec-done": {
        chrome.power.releaseKeepAwake(); badge(""); await removeBar(); await closeCaptureWindow();
        const s = await getState();
        const dur = Math.max(0, Math.round((Date.now() - s.startedAt - s.pausedMs) / 1000));
        await setState({ status: "idle", file: { name: m.name, size: m.size, dur }, deliver: { status: "idle", msg: "", pct: 0 } });
        await closeOffscreenIfIdle();
        await showResult();
        break;
      }
      case "upload-progress": await setDeliver("working", `Subiendo a Drive… ${m.pct}%`, m.pct); break;
    }
    reply({ ok: true });
  })();
  return true;
});

chrome.runtime.onStartup.addListener(() => { chrome.storage.session.remove("state"); badge(""); });
