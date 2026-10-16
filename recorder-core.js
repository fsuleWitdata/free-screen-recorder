// Núcleo de grabación compartido por la ventana de captura (pantalla) y el documento offscreen (pestaña).
// Mezcla el audio en una sola pista (sincronizada con el video) y escribe a un archivo temporal en disco (OPFS).
export const SIZES = { 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] };
const BASE_BPS = { 720: 5e6, 1080: 10e6, 2160: 30e6 };

let rec, writable, fileHandle, stream, ctx, chain = Promise.resolve(), fileName = "";
let started = false, tickTimer, recMs = 0, lastTs = 0;

const send = (m) => chrome.runtime.sendMessage(m).catch(() => {});

function pickMime(kind) {
  const list = kind === "mp4"
    ? ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return list.find((m) => MediaRecorder.isTypeSupported(m));
}

export function fail(message) { cleanup(); send({ type: "rec-error", error: message }); }

function cleanup() {
  clearInterval(tickTimer);
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  stream = ctx = null;
}

// display: MediaStream con el video (y quizá audio del sistema/pestaña). monitor: reenviar ese audio a los parlantes (modo pestaña).
export async function prepare({ display, prefs, monitor }) {
  try {
    let kind = prefs.fmt, mime = pickMime(kind);
    if (!mime) { kind = "webm"; mime = pickMime("webm"); }
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    fileName = `grabacion-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${kind}`;
    fileHandle = await (await navigator.storage.getDirectory()).getFileHandle(fileName, { create: true });
    writable = await fileHandle.createWritable();

    // Todo el audio en un único track a 48 kHz => mismo muxer que el video, siempre sincronizado
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
    await ctx.resume().catch(() => {});
    const dest = ctx.createMediaStreamDestination();
    let hasAudio = false;
    if (display.getAudioTracks().length) {
      const s = ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks()));
      s.connect(dest);
      if (monitor) s.connect(ctx.destination); // al capturar una pestaña Chrome la silencia: la devolvemos a los parlantes
      hasAudio = true;
    }
    if (prefs.mic) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: prefs.micId ? { exact: prefs.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const g = ctx.createGain(); g.gain.value = 1.2;
      ctx.createMediaStreamSource(mic).connect(g); g.connect(dest); hasAudio = true;
    }
    stream = new MediaStream([...display.getVideoTracks(), ...(hasAudio ? dest.stream.getAudioTracks() : [])]);

    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BASE_BPS[prefs.res] * +prefs.q, audioBitsPerSecond: 192000 });
    chain = Promise.resolve();
    rec.ondataavailable = (e) => { if (e.data.size) chain = chain.then(() => writable.write(e.data)); };
    rec.onstop = async () => {
      started = false;
      try { await chain; await writable.close(); } catch (e) { return fail(e.message); }
      cleanup();
      send({ type: "rec-done", name: fileName, size: (await fileHandle.getFile()).size });
    };
    display.getVideoTracks()[0].onended = () => rec && rec.state !== "inactive" && rec.stop();
    send({ type: "rec-ready" }); // el service worker hace la cuenta regresiva y responde rec-go
  } catch (e) { fail(e.message); }
}

function go() {
  if (!rec || started) return;
  started = true; recMs = 0; lastTs = performance.now();
  rec.start(5000); // vuelca a disco cada 5 s
  tickTimer = setInterval(() => {
    const n = performance.now();
    if (rec.state === "recording") recMs += n - lastTs;
    lastTs = n;
    send({ type: "tick", ms: recMs, paused: rec.state === "paused" });
  }, 1000);
  send({ type: "rec-started" });
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== "recorder" || !rec) return;
  if (m.type === "rec-go") go();
  else if (m.type === "rec-stop") rec.state !== "inactive" && rec.stop();
  else if (m.type === "rec-pause") rec.state === "recording" && rec.pause();
  else if (m.type === "rec-resume") rec.state === "paused" && rec.resume();
});
