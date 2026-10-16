// Documento oculto: (1) graba la pestaña actual vía tabCapture, (2) entrega el archivo temporal (PC / Drive) y lo borra.
import { SIZES, prepare, fail } from "./recorder-core.js";

let blobUrl = "";
const send = (m) => chrome.runtime.sendMessage(m).catch(() => {});
const root = () => navigator.storage.getDirectory();

async function startTab({ streamId, prefs }) {
  try {
    const [w, h] = SIZES[prefs.res];
    const src = (extra) => ({ mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, ...extra } });
    const display = await navigator.mediaDevices.getUserMedia({
      audio: prefs.sys ? src({}) : false,
      video: src({ maxWidth: w, maxHeight: h, maxFrameRate: 30 }),
    });
    await prepare({ display, prefs, monitor: true });
  } catch (e) { fail(e.message); }
}

async function makeUrl(name) {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  const file = await (await (await root()).getFileHandle(name)).getFile(); // Blob respaldado por disco, no copia a memoria
  blobUrl = URL.createObjectURL(file);
  return blobUrl;
}

async function upload({ token, name, driveName }) {
  try {
    const file = await (await (await root()).getFileHandle(name)).getFile();
    const init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "X-Upload-Content-Type": file.type || "video/mp4", "X-Upload-Content-Length": file.size },
      body: JSON.stringify({ name: driveName || name }),
    });
    if (!init.ok) throw new Error("Drive: " + (await init.text()));
    const loc = init.headers.get("Location");
    const CH = 8 * 1024 * 1024; // múltiplo de 256 KB
    for (let off = 0; off < file.size; off += CH) {
      const end = Math.min(off + CH, file.size);
      const r = await fetch(loc, { method: "PUT", headers: { "Content-Range": `bytes ${off}-${end - 1}/${file.size}` }, body: file.slice(off, end) });
      if (r.status !== 308 && !r.ok) throw new Error("Drive: " + (await r.text()));
      send({ type: "upload-progress", pct: Math.round((end / file.size) * 100) });
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function remove(name) {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ""; }
  try { await (await root()).removeEntry(name); } catch {}
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.target !== "offscreen") return;
  switch (m.type) {
    case "rec-start-tab": startTab(m); break;
    case "make-url": makeUrl(m.name).then(reply); return true;
    case "upload": upload(m).then(reply); return true;
    case "delete": remove(m.name).then(() => reply(true)); return true;
  }
});
