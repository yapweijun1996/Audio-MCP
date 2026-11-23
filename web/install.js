export function setupPWA(isBusy, saveDraft) {
  const $ = (id) => document.getElementById(id);
  const status = (text, ready = false) => {
    $("connection").textContent = text;
    $("connection").dataset.ready = String(ready);
  };
  let prompt,
    applying = false,
    timeout;
  const installed = () =>
    matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("install").hidden = installed();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    prompt = e;
  });
  window.addEventListener("appinstalled", () => {
    $("install").hidden = true;
    prompt = null;
  });
  $("install").onclick = async () => {
    if (prompt) {
      const event = prompt;
      prompt = null;
      try {
        await event.prompt();
        await event.userChoice;
        return;
      } catch {}
    }
    $("installHelp").showModal();
  };
  $("dismiss").onclick = () => $("installHelp").close();
  if (!("serviceWorker" in navigator)) {
    status("Offline setup unavailable");
    return;
  }
  const reset = (text) => {
    applying = false;
    clearTimeout(timeout);
    $("update").disabled = false;
    $("updateText").textContent = text;
  };
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data === "other-tabs")
      reset("Close other studio tabs, then apply the update.");
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (applying) {
      applying = false;
      location.reload();
      return;
    }
    status("Offline ready", true);
  });
  navigator.serviceWorker
    .register("./sw.js", { scope: "./", updateViaCache: "none" })
    .then((reg) => {
      function waiting() {
        if (reg.waiting && navigator.serviceWorker.controller) {
          $("updateNotice").hidden = false;
          reset("An update is ready.");
        }
      }
      function watch(worker) {
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") waiting();
          if (
            worker.state === "redundant" &&
            !navigator.serviceWorker.controller
          )
            status("Offline setup incomplete");
        });
      }
      waiting();
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      if (navigator.serviceWorker.controller) status("Offline ready", true);
      navigator.serviceWorker.ready.then(() => status("Offline ready", true));
      $("update").onclick = () => {
        if (isBusy()) {
          reset("Apply the update after rendering finishes.");
          return;
        }
        if (!reg.waiting) {
          $("updateNotice").hidden = true;
          return;
        }
        applying = true;
        saveDraft();
        $("update").disabled = true;
        $("updateText").textContent = "Updating…";
        timeout = setTimeout(() => reset("Update pending. Try again."), 10000);
        reg.waiting.postMessage("activate-single-tab");
      };
      let last = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && Date.now() - last > 600000) {
          last = Date.now();
          reg.update().catch(() => {});
        }
      });
    })
    .catch(() => status("Offline setup unavailable"));
}
