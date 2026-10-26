// Integração com o MOCI (Mapa de OCI do CAT Sertão).
// O MOCI publica os pontos cadastrados numa consulta pública do Google Apps Script (a mesma que o mapa dele usa).
// Aqui só lemos: nada é gravado no MOCI.

export const MOCI_URL_PADRAO = 'https://script.google.com/macros/s/AKfycbwQwjmNoPHYD0lOvqaAsOs9wQntZ24p68y9cAGn1yck7cUgmZia_-6aH2yv1dqPvmcIGQ/exec';
export const MOCI_SITE = 'https://aquinogr.github.io/moci-catsertao/';

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const sim = (v) => v === true || ['SIM', 'TRUE', '1', 'X', 'S'].includes(norm(v));
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };

export async function buscarMoci(url = MOCI_URL_PADRAO) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`O MOCI respondeu com erro ${r.status}.`);
  const js = await r.json();
  if (!js || !Array.isArray(js.points)) throw new Error('Resposta do MOCI fora do formato esperado.');
  return js.points;
}

// Converte um ponto do MOCI no formato usado aqui.
export function converterPonto(p, hoje) {
  const lat = num(p.lat), lng = num(p.lng);
  if (lat === null || lng === null) return null;
  const possui = sim(p.possui_avcb);
  const validade = String(p.data_validade_avcb || '').slice(0, 10);
  const temData = /^\d{4}-\d{2}-\d{2}$/.test(validade);
  let situacao = 'sem_documento';
  if (possui && temData) situacao = validade >= hoje ? 'valido' : 'vencido';
  else if (possui) situacao = 'valido';
  const rua = String(p.rua || '').trim();
  const numero = String(p.numero || '').trim();
  const endereco = rua ? `${titulo(rua)}${numero ? `, ${numero}` : ''}` : titulo(String(p.endereco || '').split(' - ')[0]);
  return {
    moci_id: String(p.id || `${lat},${lng}`),
    nome: titulo(String(p.nome || 'Edificação sem nome')),
    endereco,
    bairro: titulo(String(p.bairro || '')),
    cidade: titulo(String(p.cidade || '')),
    lat, lng,
    situacao,
    validade: temData ? validade : null,
    dados: {
      capacidade_litros: num(p.capacidade_litros),
      hidrante_fachada: sim(p.hidrante_fachada),
      hidrante_recalque: sim(p.hidrante_recalque),
      sprinkler: sim(p.possui_sprinkler),
      caldeira: sim(p.possui_caldeira),
      pavimentos: num(p.quantidade_pavimentos),
      area: num(p.area_construida),
      altura: num(p.altura_edificacao),
      cadastrado_em: p.timestamp ? String(p.timestamp).slice(0, 10) : null,
    },
  };
}

export function cidadeAceita(cidade, filtro) {
  const f = norm(filtro);
  if (!f || f === '*' || f === 'TODAS') return true;
  const c = norm(cidade);
  return f.split(/[,;]/).map((x) => x.trim()).filter(Boolean).some((x) => c.includes(x));
}

// Linhas para a ficha do estabelecimento (painel e celular).
export function linhasMoci(e) {
  const d = e?.moci;
  if (!d) return [];
  const sn = (b) => (b ? 'Sim' : 'Não');
  const out = [];
  if (d.validade || d.situacao) out.push(['AVCB (MOCI)', d.situacao === 'valido' ? `Válido${d.validade ? ` até ${br(d.validade)}` : ''}` : d.situacao === 'vencido' ? `Vencido desde ${br(d.validade)}` : 'Não possui']);
  const porte = [d.pavimentos ? `${d.pavimentos} pavimento(s)` : null, d.area ? `${fmtNum(d.area)} m²` : null, d.altura ? `${fmtNum(d.altura)} m de altura` : null].filter(Boolean).join(', ');
  if (porte) out.push(['Edificação', porte]);
  if (d.capacidade_litros) out.push(['Reserva de incêndio', `${fmtNum(d.capacidade_litros)} L`]);
  out.push(['Hidrantes', `fachada: ${sn(d.hidrante_fachada)}, recalque: ${sn(d.hidrante_recalque)}`]);
  out.push(['Sprinklers e caldeira', `sprinklers: ${sn(d.sprinkler)}, caldeira: ${sn(d.caldeira)}`]);
  return out;
}

function titulo(s) {
  const t = s.trim();
  if (!t || t !== t.toUpperCase()) return t;
  const menores = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return t.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && menores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const fmtNum = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

// Semelhança simples entre nomes (palavras em comum), para ligar um ponto do MOCI a um CNPJ já na base.
export function nomesParecidos(a, b) {
  const t = (s) => new Set(norm(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['LTDA', 'EIRELI', 'COMERCIO', 'SERVICOS'].includes(w)));
  const A = t(a), B = t(b);
  if (!A.size || !B.size) return false;
  let comum = 0;
  A.forEach((w) => { if (B.has(w)) comum++; });
  return comum / Math.min(A.size, B.size) >= 0.5;
}
