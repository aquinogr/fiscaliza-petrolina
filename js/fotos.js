// Fotos das vistorias: comprimidas no aparelho e guardadas no IndexedDB.
const DB = 'fiscaliza-fotos';
const STORE = 'fotos';

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, modo);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function comprimir(file, max = 1280, qualidade = 0.7) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const esc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * esc); c.height = Math.round(bmp.height * esc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', qualidade));
}

export async function salvarFoto(file) {
  const blob = await comprimir(file);
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await tx('readwrite', (s) => s.put(blob, id));
  return id;
}

const urls = new Map();
export async function fotoURL(id) {
  if (urls.has(id)) return urls.get(id);
  try {
    const blob = await tx('readonly', (s) => s.get(id));
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.set(id, u);
    return u;
  } catch { return null; }
}

export async function apagarFoto(id) { try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignora */ } }
