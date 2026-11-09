// Asset lookup. Normally a path is just fetched from the server. In the single-file build
// (Knjiga.html) every scan, sound and image is embedded and listed in window.__ASSETS,
// so the page also works when simply double-clicked, without any server.
export const asset = (path) => (globalThis.__ASSETS && globalThis.__ASSETS[path]) || path;
