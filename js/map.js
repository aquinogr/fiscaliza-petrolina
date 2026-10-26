// Ajudantes do Leaflet. Ícones só recebem valores controlados (números, cores do cadastro validadas, status fixos).
/* global L */

export const PETROLINA = { lat: -9.372, lng: -40.512 };

export function criarMapa(el, { centro = PETROLINA, zoom = 13, zoomControl = true } = {}) {
  const map = L.map(el, { zoomControl, attributionControl: true, tap: true }).setView([centro.lat, centro.lng], zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.attributionControl.setPrefix(false);
  return map;
}

const corOk = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#64748B');
const STATUS_OK = ['pendente', 'no_local', 'concluida', 'nao_realizada'];

export function iconeMissao(n, cor, status = 'pendente', destaque = false) {
  const st = STATUS_OK.includes(status) ? status : 'pendente';
  const num = Number.isFinite(+n) ? +n : '';
  return L.divIcon({
    className: 'pin-wrap',
    html: `<span class="pin pin-${st}${destaque ? ' pin-alerta' : ''}" style="--c:${corOk(cor)}">${num}</span>`,
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14],
  });
}

export function iconeFila(prioridade) {
  const p = ['alta', 'media', 'baixa'].includes(prioridade) ? prioridade : 'media';
  return L.divIcon({ className: 'pin-wrap', html: `<span class="pin-fila pin-fila-${p}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8] });
}

export function iconeSugestao(score, cor) {
  const s = Math.max(0, Math.min(100, Math.round(+score || 0)));
  return L.divIcon({ className: 'pin-wrap', html: `<span class="pin-sug" style="--c:${corOk(cor)}"><b>${s}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
}

export function iconeLocal(alerta = false) {
  return L.divIcon({ className: 'pin-wrap', html: `<span class="pin-local${alerta ? ' pin-local-alerta' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V4h2v1h12l-2 4 2 4H6v8z" fill="currentColor"/></svg></span>`, iconSize: [28, 28], iconAnchor: [8, 26], popupAnchor: [6, -24] });
}

export function iconeBase() {
  return L.divIcon({ className: 'pin-wrap', html: '<span class="pin-base"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 10v11h6v-6h6v6h6V10z" fill="currentColor"/></svg></span>', iconSize: [30, 30], iconAnchor: [15, 15] });
}

export function iconeEu() {
  return L.divIcon({ className: 'pin-wrap', html: '<span class="pin-eu"></span>', iconSize: [20, 20], iconAnchor: [10, 10] });
}

export function iconePonto() {
  return L.divIcon({ className: 'pin-wrap', html: '<span class="pin-ponto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C7.6 2 4 5.5 4 9.9 4 15.6 12 22 12 22s8-6.4 8-12.1C20 5.5 16.4 2 12 2zm0 10.5a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z" fill="currentColor"/></svg></span>', iconSize: [34, 34], iconAnchor: [17, 32] });
}
