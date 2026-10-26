// Empacota dados num link (depois do #), comprimidos. O que vem depois do # não é enviado a servidor nenhum.

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const deB64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export async function codificar(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    try {
      const comp = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
      return `z${b64url(new Uint8Array(comp))}`;
    } catch { /* cai para o formato sem compressão */ }
  }
  return `j${b64url(bytes)}`;
}

export async function decodificar(txt) {
  const tipo = txt[0];
  const bytes = deB64url(txt.slice(1));
  if (tipo === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador é antigo demais para abrir o link. Atualize o Chrome ou o Safari.');
    const t = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    return JSON.parse(t);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function urlBase() { return `${location.origin}${location.pathname}`; }

export async function linkPara(tipo, obj) { return `${urlBase()}#${tipo}=${await codificar(obj)}`; }

export function lerHash() {
  const m = location.hash.match(/^#(rota|retorno)=(.+)$/);
  return m ? { tipo: m[1], valor: m[2] } : null;
}

export function whatsapp(texto, numero = '') {
  const n = String(numero || '').replace(/\D/g, '');
  return `https://wa.me/${n ? (n.length <= 11 ? `55${n}` : n) : ''}?text=${encodeURIComponent(texto)}`;
}
