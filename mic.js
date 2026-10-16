navigator.mediaDevices.getUserMedia({ audio: true })
  .then((s) => { s.getTracks().forEach((t) => t.stop()); document.getElementById("m").textContent = "Micrófono permitido ✔"; setTimeout(() => window.close(), 800); })
  .catch((e) => { document.getElementById("m").textContent = "No se pudo: " + e.message; });
