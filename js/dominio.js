// Vocabulário e regras de negócio compartilhadas.

// "v2": tipos da Regularização, desativados até a versão 2.0.
export const TIPOS = {
  fiscalizacao: { nome: 'Fiscalização', fila: 'proativa' },
  avcb_vencido: { nome: 'AVCB vencido', fila: 'urgencia' },
  denuncia: { nome: 'Denúncia', fila: 'urgencia' },
  retorno: { nome: 'Retorno de notificação', fila: 'urgencia' },
  evento: { nome: 'Fiscalização de evento', fila: 'urgencia' },
  encaixe: { nome: 'Encaixe', fila: 'proativa' },
  regularizacao: { nome: 'Regularização', fila: 'solicitada', v2: true },
};
export const TIPOS_CADASTRO = Object.entries(TIPOS).filter(([k, t]) => !t.v2 && k !== 'encaixe');

export const FILAS = {
  solicitada: 'Demanda solicitada',
  urgencia: 'Urgência administrativa',
  proativa: 'Proativa',
};

export const STATUS = {
  pendente: 'Pendente',
  no_local: 'No local',
  concluida: 'Concluída',
  nao_realizada: 'Não realizada',
};

export const PRIORIDADES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export const RESULTADOS = [
  ['regular', 'Regular'],
  ['notificado', 'Notificado'],
  ['auto_infracao', 'Auto de infração'],
  ['interditado', 'Interditado'],
  ['fechado', 'Fechado no momento'],
  ['nao_localizado', 'Não localizado'],
  ['acesso_recusado', 'Acesso recusado'],
  ['isento', 'Isento / não se aplica'],
];
export const RESULTADO_NOME = Object.fromEntries(RESULTADOS);
export const RESULTADOS_COM_EXIGENCIA = ['notificado', 'auto_infracao', 'interditado'];
export const RESULTADOS_IMPRODUTIVOS = ['fechado', 'nao_localizado', 'acesso_recusado'];

export const SITUACAO_DOC = [
  ['valido', 'Documento válido'],
  ['vencido', 'Documento vencido'],
  ['em_andamento', 'Processo em andamento'],
  ['sem_documento', 'Sem documento'],
  ['isento', 'Isento / não se aplica'],
  ['desconhecida', 'Não verificado'],
];
export const SITUACAO_NOME = Object.fromEntries(SITUACAO_DOC);

export const MOTIVOS_REJEICAO = [
  ['ja_regular', 'Já está regular'],
  ['isento', 'Isento / não se aplica'],
  ['fechado', 'Estabelecimento encerrado'],
  ['duplicado', 'Duplicado ou endereço errado'],
  ['fora_area', 'Fora da área de atuação'],
  ['depois', 'Agora não (rever depois)'],
];

export const STATUS_EVENTO = [
  ['nao_recebido', 'Sem solicitação'],
  ['recebido', 'Solicitação recebida'],
  ['vistoriado', 'Vistoriado'],
  ['liberado', 'Liberado'],
  ['negado', 'Não liberado'],
];
export const STATUS_EVENTO_NOME = Object.fromEntries(STATUS_EVENTO);

// Atualiza o cadastro do estabelecimento com o que o vistoriador viu em campo.
export function aplicarResultado(estab, saida, data) {
  if (!estab || !saida) return;
  estab.ultima_fiscalizacao = data;
  estab.ultimo_resultado = saida.resultado;
  if (saida.situacao_doc && saida.situacao_doc !== 'desconhecida') {
    estab.situacao_doc = saida.situacao_doc;
    estab.validade_doc = saida.situacao_doc === 'valido' ? (saida.validade || null) : null;
  }
  if (RESULTADOS_COM_EXIGENCIA.includes(saida.resultado)) estab.notificacoes = (estab.notificacoes || 0) + 1;
}

export function formatarCNPJ(c) {
  const d = String(c || '').replace(/\D/g, '');
  if (d.length !== 14) return c || '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
