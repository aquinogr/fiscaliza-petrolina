// Cálculos geográficos simples, sem dependências.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function dist(a, b) {
  if (!a || !b) return NaN;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ring: [[lat, lng], ...]
export function pointInPolygon(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = (yi > pt.lat) !== (yj > pt.lat) && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function setorDe(pt, setores) {
  if (!pt) return null;
  return setores.find((s) => s.poligono && s.poligono.length > 2 && pointInPolygon(pt, s.poligono)) || null;
}

export function centroide(ring) {
  let lat = 0, lng = 0;
  ring.forEach(([a, b]) => { lat += a; lng += b; });
  return { lat: lat / ring.length, lng: lng / ring.length };
}

// Contorno envolvente (Convex Hull — Monotone Chain) de um conjunto de pontos { lat, lng }.
export function convexHull(pontos) {
  const pts = (pontos || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lat, p.lng])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// Polígono limpo do bairro (descarta pontos fora da área urbana do bairro e aplica folga visual).
export function poligonoBairro(pontos) {
  const validos = (pontos || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!validos.length) return null;
  let grupo = validos;
  if (validos.length >= 6) {
    const lats = validos.map((p) => p.lat).sort((a, b) => a - b);
    const lngs = validos.map((p) => p.lng).sort((a, b) => a - b);
    const med = { lat: lats[Math.floor(lats.length / 2)], lng: lngs[Math.floor(lngs.length / 2)] };
    const ds = validos.map((p) => dist(med, p)).sort((a, b) => a - b);
    const lim = Math.max(450, ds[Math.floor(ds.length * 0.75)] * 2.4);
    const filtrados = validos.filter((p) => dist(med, p) <= lim);
    if (filtrados.length >= 3) grupo = filtrados;
  }
  const hull = convexHull(grupo);
  if (hull.length < 3) {
    const c = centroide(grupo.map((p) => [p.lat, p.lng]));
    return { tipo: 'circulo', centro: c, raio: 190 };
  }
  const c = centroide(hull);
  const expandido = hull.map(([lat, lng]) => {
    const dLat = lat - c.lat, dLng = lng - c.lng;
    const len = Math.hypot(dLat, dLng) || 1;
    const pad = 0.00065; // ~70 m de margem visual
    return [lat + (dLat / len) * pad, lng + (dLng / len) * pad];
  });
  return { tipo: 'poligono', anel: expandido, centro: c };
}

// Ordena paradas: vizinho mais próximo a partir do ponto de partida + melhoria 2-opt.
export function ordenarRota(inicio, paradas) {
  if (paradas.length < 2) return paradas.slice();
  const rest = paradas.slice();
  const rota = [];
  let atual = inicio || rest[0];
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((p, i) => { const d = dist(atual, p); if (d < bd) { bd = d; bi = i; } });
    atual = rest.splice(bi, 1)[0];
    rota.push(atual);
  }
  const custo = (r) => r.reduce((acc, p, i) => acc + dist(i === 0 ? (inicio || p) : r[i - 1], p), 0);
  let melhorou = true, guard = 0;
  while (melhorou && guard++ < 50) {
    melhorou = false;
    for (let i = 0; i < rota.length - 1; i++) {
      for (let k = i + 1; k < rota.length; k++) {
        const nova = rota.slice(0, i).concat(rota.slice(i, k + 1).reverse(), rota.slice(k + 1));
        if (custo(nova) + 1 < custo(rota)) { rota.splice(0, rota.length, ...nova); melhorou = true; }
      }
    }
  }
  return rota;
}

export function extensaoRota(inicio, paradas) {
  let total = 0, prev = inicio;
  for (const p of paradas) { if (prev) total += dist(prev, p); prev = p; }
  return total;
}

// Geocodificação com Nominatim (OpenStreetMap). Uso leve, uma busca por clique.
const VIEWBOX = '-40.80,-9.10,-40.30,-9.50';
export async function geocodificar(texto) {
  const q = /petrolina/i.test(texto) ? texto : `${texto}, Petrolina, PE`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=br&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
  if (!r.ok) throw new Error('Busca de endereço indisponível agora.');
  const js = await r.json();
  return js.map((x) => ({ lat: +x.lat, lng: +x.lon, nome: x.display_name }));
}

export function linkMaps(p) { return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`; }
export function linkWaze(p) { return `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`; }
