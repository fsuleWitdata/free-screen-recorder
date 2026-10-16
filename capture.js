// Ventana de captura de pantalla/ventana. Igual que la extensión original: la misma página abre el selector
// (sin necesidad de clic) y consume el streamId. Si ese método falla, ofrece getDisplayMedia con un botón.
import { SIZES, prepare, fail } from "./recorder-core.js";

const $ = (id) => document.getElementById(id);

async function viaStreamId(id, canAudio, prefs) {
  const [w, h] = SIZES[prefs.res];
  const src = (extra) => ({ mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: id, ...extra } });
  return navigator.mediaDevices.getUserMedia({
    audio: canAudio && prefs.sys ? src({}) : false,
    video: src({ maxWidth: w, maxHeight: h, maxFrameRate: 30 }),
  });
}

function viaDisplayMedia(prefs) {
  const [w, h] = SIZES[prefs.res];
  return navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } },
    audio: prefs.sys ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
  });
}

(async () => {
  const { capture } = await chrome.storage.session.get("capture");
  if (!capture) { $("m").textContent = "Abrí esta ventana desde el panel de la extensión."; return; }
  const prefs = capture.prefs;

  const showFallback = (why) => {
    $("m").textContent = why + " Probá el método alternativo:";
    $("go").hidden = false;
    $("go").onclick = async () => {
      $("go").hidden = true;
      try { await prepare({ display: await viaDisplayMedia(prefs), prefs, monitor: false }); }
      catch (err) { fail(err.name === "NotAllowedError" ? "Captura cancelada." : err.message); }
    };
  };
  if (!chrome.desktopCapture) return showFallback("Falta el permiso de captura de escritorio.");

  chrome.desktopCapture.chooseDesktopMedia(["screen", "window", "audio"], async (id, opts) => {
    if (!id) return fail("Captura cancelada.");
    try {
      await prepare({ display: await viaStreamId(id, !!(opts && opts.canRequestAudioTrack), prefs), prefs, monitor: false });
      $("m").textContent = "Grabando… esta ventana se minimiza sola.";
    } catch (e) {
      showFallback("El método principal falló (" + e.message + ").");
    }
  });
})();

