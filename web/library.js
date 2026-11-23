import { storageKey } from "./scope.js";
let connection;
function database() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(storageKey("audio-mcp-studio"), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("takes", { keyPath: "id" });
      db.createObjectStore("files", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(Error("Close other studio tabs to open the library."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
  }).catch((e) => {
    connection = null;
    throw e;
  });
  return connection;
}
async function transaction(stores, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = action(tx);
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () =>
      reject(tx.error || Error("Local storage write interrupted."));
  });
}
export const list = () =>
  transaction(["takes"], "readonly", (tx) => tx.objectStore("takes").getAll());
export const files = (id) =>
  transaction(["files"], "readonly", (tx) => tx.objectStore("files").get(id));
export const save = (meta, blobs) =>
  transaction(["takes", "files"], "readwrite", (tx) => {
    tx.objectStore("takes").add(meta);
    tx.objectStore("files").add({ id: meta.id, ...blobs });
  });
export const remove = (id) =>
  transaction(["takes", "files"], "readwrite", (tx) => {
    tx.objectStore("takes").delete(id);
    tx.objectStore("files").delete(id);
  });
