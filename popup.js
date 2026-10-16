const $ = (id) => document.getElementById(id);
const DEFAULTS = { src: "screen", cd: true, bar: true, res: "1080", fmt: "mp4", q: "0.6", sys: true, mic: true, micId: "", dLocal: true, dDrive: false, free: true };
let prefs = { ...DEFAULTS };
let state = { status: "idle", file: null, deliver: { status: "idle" } };
let micStream, micRaf;

const say = (t, cls = "") => { $("msg").textContent = t; $("msg").className = "note " + cls; };
const hms = (s) => [s / 3600, (s / 60) % 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, "0")).join(":");
const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB");
const save = () => chrome.storage.local.set({ prefs });

// ---- Preferencias ----
function paintPrefs() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(prefs[seg.dataset.k]))));
  for (const k of ["sys", "mic", "cd", "bar", "dLocal", "dDrive", "free"]) $(k).checked = prefs[k];
  $("micbox").hidden = !prefs.mic;
}
document.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  prefs[seg.dataset.k] = b.dataset.v; paintPrefs(); save();
}));
for (const k of ["sys", "cd", "bar", "dLocal", "dDrive", "free"]) $(k).onchange = () => { prefs[k] = $(k).checked; save(); };
$("mic").onchange = () => { prefs.mic = $("mic").checked; paintPrefs(); save(); prefs.mic ? startMeter() : stopMeter(); };
$("micsel").onchange = () => { prefs.micId = $("micsel").value; save(); startMeter(); };

// ---- Micrófono + medidor de nivel ----
async function loadMics() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
  $("micsel").innerHTML = '<option value="">Micrófono predeterminado</option>' +
    devs.map((d) => `<option value="${d.deviceId}">${d.label || "Micrófono"}</option>`).join("");
  $("micsel").value = prefs.micId;
}
function stopMeter() { cancelAnimationFrame(micRaf); micStream?.getTracks().forEach((t) => t.stop()); micStream = null; $("lvl").style.width = "0"; }
async function startMeter() {
  stopMeter();
  if (!prefs.mic || state.status !== "idle" || state.file) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.micId ? { exact: prefs.micId } : undefined } });
    $("allowmic").hidden = true;
    await loadMics();
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(micStream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let mx = 0; for (const v of buf) mx = Math.max(mx, Math.abs(v - 128));
      $("lvl").style.width = Math.min(100, (mx / 128) * 160) + "%";
      micRaf = requestAnimationFrame(loop);
    };
    loop();
  } catch { $("allowmic").hidden = false; }
}
// Si el popup no puede mostrar el pedido de permiso, se pide desde una ventanita que se cierra sola
$("allowmic").onclick = () => chrome.windows.create({ url: chrome.runtime.getURL("mic.html"), type: "popup", width: 420, height: 220 });

// ---- Estado ----
function render() {
  const s = state, idle = s.status === "idle", live = s.status === "recording" || s.status === "paused";
  const pending = idle && !!s.file;
  $("setup").hidden = !idle || pending;
  $("live").hidden = !live;
  $("live").classList.toggle("paused", s.status === "paused");
  $("start").hidden = !idle || pending;
  $("start").disabled = s.status === "starting";
  $("pause").textContent = s.status === "paused" ? "Reanudar" : "Pausa";
  $("done").hidden = !pending;
  $("drv").hidden = live;

  if (pending) {
    const dot = s.file.name.lastIndexOf(".");
    $("fext").textContent = s.file.name.slice(dot);
    if ($("fname").dataset.for !== s.file.name) { $("fname").value = s.file.name.slice(0, dot); $("fname").dataset.for = s.file.name; }
    $("finfo").textContent = `${hms(s.file.dur)} · ${mb(s.file.size)} · guardada temporalmente en el disco`;
  }
  const d = s.deliver || { status: "idle" };
  const working = d.status === "working";
  $("deliver").disabled = working || !(prefs.dLocal || prefs.dDrive);
  $("discard").disabled = working;
  $("bar").hidden = !(working && d.pct);
  $("barfill").style.width = (d.pct || 0) + "%";

  if (s.status === "saving") say("Guardando archivo…");
  else if (s.status === "starting") say("Elegí qué compartir en el diálogo de Chrome…");
  else if (s.error && idle) say(s.error, "err");
  else if (live) say(s.status === "paused" ? "En pausa" : "Grabando. Podés cerrar este panel: sigue grabando.");
  else if (d.msg) say(d.msg, d.status === "error" ? "err" : d.status === "done" ? "okc" : "");
  else say(pending ? "Elegí destino y tocá Guardar. Mientras tanto la grabación está a salvo en el disco." : "");
}
setInterval(() => {
  if (state.status === "recording") $("timer").textContent = hms((Date.now() - state.startedAt - state.pausedMs) / 1000);
  else if (state.status === "paused") $("timer").textContent = hms((state.pauseAt - state.startedAt - state.pausedMs) / 1000);
}, 250);

chrome.storage.onChanged.addListener((c, area) => {
  if (area === "session" && c.state) {
    const was = state.status;
    state = c.state.newValue || { status: "idle", file: null, deliver: { status: "idle" } };
    render();
    if (was !== "idle" && state.status === "idle") startMeter();
  }
});

// ---- Acciones ----
$("start").onclick = async () => {
  say("");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const msg = { type: "start", prefs, tabId: tab?.id };
    if (prefs.src === "tab") {
      if (!tab?.id || !/^https?:|^file:/.test(tab.url || "")) return say("Esta pestaña no se puede grabar (páginas de Chrome o vacías). Usá Pantalla / ventana.", "err");
      msg.streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    }
    stopMeter(); // liberar el micrófono para el grabador
    await chrome.runtime.sendMessage(msg);
    window.close();
  } catch (e) { say("No se pudo iniciar: " + e.message, "err"); }
};
$("pause").onclick = () => chrome.runtime.sendMessage({ type: state.status === "paused" ? "resume" : "pause" });
$("stop").onclick = () => chrome.runtime.sendMessage({ type: "stop" });
$("deliver").onclick = async () => {
  const { clientId } = await chrome.storage.local.get("clientId");
  if (prefs.dDrive && !clientId) { $("drv").open = true; return say("Para Drive, primero configurá tu Client ID abajo.", "err"); }
  const ext = state.file.name.slice(state.file.name.lastIndexOf("."));
  // quita caracteres no válidos en Windows y espacios de los extremos
  const base = $("fname").value.replace(/[\\\/:*?"<>|]+/g, "").replace(/^[\s.]+|[\s.]+$/g, "") || state.file.name.slice(0, -ext.length);
  chrome.runtime.sendMessage({ type: "deliver", local: prefs.dLocal, drive: prefs.dDrive, free: prefs.free, outName: base + ext });
};
$("discard").onclick = () => { if (confirm("¿Borrar esta grabación? No se puede deshacer.")) chrome.runtime.sendMessage({ type: "discard" }); };

// ---- Drive: configuración ----
$("redir").textContent = chrome.identity.getRedirectURL();
$("copy").onclick = () => navigator.clipboard.writeText(chrome.identity.getRedirectURL());
$("test").onclick = async () => {
  $("drvmsg").className = "note"; $("drvmsg").textContent = "Conectando…";
  await chrome.storage.local.set({ clientId: $("cid").value.trim() });
  await chrome.storage.session.remove("driveToken");
  const r = await chrome.runtime.sendMessage({ type: "test-drive" });
  $("drvmsg").textContent = r.ok ? "Conectado como " + r.email + " ✔" : "Error: " + r.error;
  $("drvmsg").className = "note " + (r.ok ? "okc" : "err");
};

// ---- Init ----
(async () => {
  const { prefs: p, clientId, file } = await chrome.storage.local.get(["prefs", "clientId", "file"]);
  prefs = { ...DEFAULTS, ...p };
  $("cid").value = clientId || "";
  const { state: s } = await chrome.storage.session.get("state");
  state = s || { status: "idle", file: file || null, deliver: { status: "idle" } };
  paintPrefs(); render();
  await loadMics().catch(() => {});
  startMeter();
})();
