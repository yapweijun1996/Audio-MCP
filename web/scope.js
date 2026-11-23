// Give installations under different paths their own library on shared hosts.
const base = new URL("./", document.baseURI).pathname;
export const storageKey = (name) => (base === "/" ? name : name + ":" + base);
