#!/usr/bin/env python3
"""
Rotina mensal: monta a base pública de estabelecimentos de Petrolina.

1. Baixa os dados abertos de CNPJ da Receita Federal (mês mais recente).
2. Mantém só os estabelecimentos ATIVOS de Petrolina/PE com atividade (CNAE) de interesse,
   conforme a tabela data/cnae.json (a mesma que o site usa).
3. Localiza cada endereço no mapa usando o CNEFE do Censo 2022 (IBGE):
   primeiro CEP + número, depois rua + número, por último o centro do CEP.
4. Grava um GeoJSON (artefato do GitHub Actions, para importar no painel) e,
   se houver credenciais do Supabase, atualiza a tabela de estabelecimentos.

Proteção de dados: não guarda telefone, e-mail nem sócios. Para empresário individual (inclui MEI),
a razão social costuma ser o nome da pessoa e, por isso, não é usada.

Só usa a biblioteca padrão do Python.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
UA = 'fiscaliza-petrolina/1.0 (+https://github.com/aquinogr/fiscaliza-petrolina)'

RECEITA_BASES = [
    'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/',
    'https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/',
]
CNEFE_RAIZ = 'https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/'

# Layout do arquivo Estabelecimentos (sem cabeçalho, separador ";")
E_BASICO, E_ORDEM, E_DV, E_FANTASIA, E_SITUACAO, E_INICIO, E_CNAE, E_CNAE_SEC = 0, 1, 2, 4, 5, 10, 11, 12
E_TIPO_LOG, E_LOG, E_NUM, E_COMPL, E_BAIRRO, E_CEP, E_UF, E_MUN = 13, 14, 15, 16, 17, 18, 19, 20
# Layout do arquivo Empresas
EMP_BASICO, EMP_RAZAO, EMP_NATUREZA = 0, 1, 2
NATUREZA_EMPRESARIO_INDIVIDUAL = '2135'


def log(msg: str) -> None:
    print(f'[{datetime.now():%H:%M:%S}] {msg}', flush=True)


# ---------------------------------------------------------------- rede
class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            for k, v in attrs:
                if k == 'href' and v:
                    self.hrefs.append(v)


def http_get(url: str, tentativas: int = 4) -> bytes:
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                raise
            log(f'  falhou ({e}); nova tentativa em {5 * (i + 1)}s')
            time.sleep(5 * (i + 1))
    raise RuntimeError('inalcançável')


def listar(url: str) -> list[str]:
    p = _Links()
    p.feed(http_get(url).decode('utf-8', 'replace'))
    return p.hrefs


def baixar(url: str, destino: Path) -> Path:
    if destino.exists() and destino.stat().st_size > 0:
        return destino
    log(f'baixando {url}')
    tmp = destino.with_suffix(destino.suffix + '.part')
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, 'wb') as f:
                while True:
                    bloco = r.read(1 << 20)
                    if not bloco:
                        break
                    f.write(bloco)
            tmp.rename(destino)
            return destino
        except Exception as e:  # noqa: BLE001
            if i == 3:
                raise
            log(f'  falhou ({e}); nova tentativa')
            time.sleep(10 * (i + 1))
    return destino


# ---------------------------------------------------------------- utilidades
def sem_acentos(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn')


TIPOS_VIA = r'^(RUA|R|AVENIDA|AV|TRAVESSA|TV|TRAV|ESTRADA|EST|RODOVIA|ROD|PRACA|PCA|ALAMEDA|AL|LARGO|VIA|BECO|VILA|LOTEAMENTO|LOT|QUADRA|QD|SITIO|FAZENDA|FAZ|NUCLEO|PROJETO|AGROVILA|DISTRITO|POVOADO)\b\.?\s*'
TITULOS = r'^(DOUTOR|DR|DOM|PADRE|PE|PRESIDENTE|PRES|GOVERNADOR|GOV|PREFEITO|PREF|SENADOR|SEN|DEPUTADO|DEP|CORONEL|CEL|CAPITAO|CAP|GENERAL|GAL|SAO|SANTA|SANTO|PROFESSOR|PROF|PROFESSORA|MAJOR|TENENTE|TEN|SARGENTO|MARECHAL|VEREADOR|VER|MONSENHOR|MONS|FREI|IRMA|MINISTRO|MIN)\b\.?\s*'


def norm_rua(tipo: str, nome: str) -> str:
    s = sem_acentos(f'{nome or ""}').upper()
    s = re.sub(r'[^A-Z0-9 ]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    for _ in range(2):
        s = re.sub(TIPOS_VIA, '', s)
        s = re.sub(TITULOS, '', s)
    s = re.sub(r'\b(DE|DA|DO|DAS|DOS|E)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def norm_num(n: str) -> str:
    m = re.match(r'\s*0*(\d+)', str(n or ''))
    return m.group(1) if m else ''


def norm_cep(c: str) -> str:
    d = re.sub(r'\D', '', str(c or ''))
    return d if len(d) == 8 else ''


def limpar_nome(s: str) -> str:
    s = re.sub(r'\b\d{11}\b', '', s or '')  # remove números com cara de CPF
    s = re.sub(r'\s+', ' ', s).strip(' -.')
    return s.title() if s.isupper() else s


# ---------------------------------------------------------------- CNAE
def carregar_cnae(caminho: Path) -> dict:
    js = json.loads(caminho.read_text(encoding='utf-8'))
    return js['cnaes']


# ---------------------------------------------------------------- Receita
def receita_mes(mes: str | None) -> tuple[str, str]:
    erros = []
    for base in RECEITA_BASES:
        try:
            meses = sorted({h.strip('/') for h in listar(base) if re.fullmatch(r'\d{4}-\d{2}/?', h.strip('./'))})
            if not meses:
                raise RuntimeError('nenhuma pasta AAAA-MM encontrada')
            escolhido = mes if mes else meses[-1]
            if escolhido not in meses:
                raise RuntimeError(f'mês {escolhido} não publicado (disponíveis até {meses[-1]})')
            return base, escolhido
        except Exception as e:  # noqa: BLE001
            erros.append(f'{base}: {e}')
    raise RuntimeError('Receita Federal indisponível. ' + ' | '.join(erros))


def ler_csv_zip(caminho: Path):
    with zipfile.ZipFile(caminho) as z:
        for nome in z.namelist():
            with z.open(nome) as f:
                texto = io.TextIOWrapper(f, encoding='latin-1', newline='')
                yield from csv.reader(texto, delimiter=';', quotechar='"')


def codigo_municipio_receita(arquivo: Path, nome: str) -> str:
    alvo = sem_acentos(nome).upper()
    for row in ler_csv_zip(arquivo):
        if len(row) >= 2 and sem_acentos(row[1]).upper().strip() == alvo:
            return row[0].strip()
    raise RuntimeError(f'Município {nome} não encontrado na tabela da Receita.')


def filtrar_estabelecimentos(arquivos: list[Path], uf: str, cod_mun: str, cnaes: dict) -> list[dict]:
    saida = []
    lidas = 0
    for arq in arquivos:
        log(f'lendo {arq.name}')
        for row in ler_csv_zip(arq):
            lidas += 1
            if len(row) < 21 or row[E_UF] != uf or row[E_MUN] != cod_mun or row[E_SITUACAO] != '02':
                continue
            principal = row[E_CNAE].strip()
            secundarias = [c.strip() for c in row[E_CNAE_SEC].split(',') if c.strip()]
            interesse = principal if principal in cnaes else next((c for c in secundarias if c in cnaes), None)
            if not interesse:
                continue
            ini = row[E_INICIO].strip()
            saida.append({
                'basico': row[E_BASICO], 'cnpj': f'{row[E_BASICO]}{row[E_ORDEM]}{row[E_DV]}',
                'fantasia': row[E_FANTASIA].strip(), 'cnae': interesse, 'cnae_principal': principal,
                'tipo_log': row[E_TIPO_LOG].strip(), 'logradouro': row[E_LOG].strip(), 'numero': row[E_NUM].strip(),
                'complemento': row[E_COMPL].strip(), 'bairro': row[E_BAIRRO].strip(), 'cep': norm_cep(row[E_CEP]),
                'abertura': f'{ini[:4]}-{ini[4:6]}-{ini[6:8]}' if re.fullmatch(r'\d{8}', ini) else None,
            })
    log(f'{lidas:,} linhas lidas; {len(saida):,} estabelecimentos de interesse'.replace(',', '.'))
    return saida


def nomes_empresas(arquivos: list[Path], basicos: set[str]) -> dict[str, tuple[str, str]]:
    out = {}
    for arq in arquivos:
        log(f'lendo {arq.name}')
        for row in ler_csv_zip(arq):
            if len(row) > 2 and row[EMP_BASICO] in basicos:
                out[row[EMP_BASICO]] = (row[EMP_RAZAO].strip(), row[EMP_NATUREZA].strip())
    return out


# ---------------------------------------------------------------- CNEFE (IBGE)
def achar_cnefe(cod_ibge: str, uf_cod: str, profundidade: int = 5) -> str:
    """Procura no FTP do IBGE o arquivo de coordenadas do município (ou, na falta, do estado)."""
    fila = [(CNEFE_RAIZ, 0)]
    vistos = set()
    estadual = None
    while fila:
        url, prof = fila.pop(0)
        if url in vistos or prof > profundidade:
            continue
        vistos.add(url)
        try:
            hrefs = listar(url)
        except Exception:  # noqa: BLE001
            continue
        for h in hrefs:
            if h.startswith(('?', '/', '..', 'http')) or h in ('./',):
                continue
            alvo = url + h
            if h.lower().endswith('.zip'):
                if cod_ibge in h:
                    return alvo
                if re.match(rf'^{uf_cod}(_|\.|[A-Z])', h) or re.search(r'(^|_)PE(_|\.)', h):
                    estadual = estadual or alvo
            elif h.endswith('/'):
                prioridade = any(k in h.lower() for k in ('coord', 'munic', uf_cod, 'pe/'))
                if prioridade or prof < 2:
                    fila.insert(0, (alvo, prof + 1)) if prioridade else fila.append((alvo, prof + 1))
    if estadual:
        return estadual
    raise RuntimeError('Arquivo do CNEFE não encontrado no FTP do IBGE. Informe a URL em CNEFE_URL.')


def ler_cnefe(caminho: Path, cod_ibge: str):
    with zipfile.ZipFile(caminho) as z:
        nomes = [n for n in z.namelist() if n.lower().endswith(('.csv', '.txt'))]
        for nome in nomes:
            bruto = z.read(nome)
            try:
                texto = bruto.decode('utf-8')
            except UnicodeDecodeError:
                texto = bruto.decode('latin-1')
            amostra = texto[:2000]
            sep = ';' if amostra.count(';') >= amostra.count(',') else ','
            leitor = csv.DictReader(io.StringIO(texto), delimiter=sep)
            for row in leitor:
                r = {k.strip().upper(): (v or '').strip() for k, v in row.items() if k}
                if r.get('COD_MUNICIPIO') and r['COD_MUNICIPIO'][:7] != cod_ibge:
                    continue
                yield r


def indexar_cnefe(linhas) -> dict:
    por_cep_num, por_rua_num, por_cep = {}, {}, defaultdict(lambda: [0.0, 0.0, 0])
    n = 0
    for r in linhas:
        try:
            lat = float(r.get('LATITUDE', '').replace(',', '.'))
            lng = float(r.get('LONGITUDE', '').replace(',', '.'))
        except ValueError:
            continue
        n += 1
        cep = norm_cep(r.get('CEP'))
        num = norm_num(r.get('NUM_ENDERECO'))
        rua = norm_rua(r.get('NOM_TIPO_SEGLOGR', ''), f"{r.get('NOM_TITULO_SEGLOGR', '')} {r.get('NOM_SEGLOGR', '')}")
        if cep and num:
            por_cep_num.setdefault((cep, num), (lat, lng))
        if rua and num:
            por_rua_num.setdefault((rua, num), (lat, lng))
        if cep:
            acc = por_cep[cep]
            acc[0] += lat; acc[1] += lng; acc[2] += 1
    centro_cep = {c: (a[0] / a[2], a[1] / a[2]) for c, a in por_cep.items() if a[2]}
    log(f'CNEFE: {n:,} endereços com coordenada'.replace(',', '.'))
    return {'cep_num': por_cep_num, 'rua_num': por_rua_num, 'cep': centro_cep}


def geocodificar(e: dict, idx: dict):
    num = norm_num(e['numero'])
    if e['cep'] and num and (e['cep'], num) in idx['cep_num']:
        return idx['cep_num'][(e['cep'], num)], 'endereco'
    rua = norm_rua(e['tipo_log'], e['logradouro'])
    if rua and num and (rua, num) in idx['rua_num']:
        return idx['rua_num'][(rua, num)], 'endereco'
    if e['cep'] and e['cep'] in idx['cep']:
        return idx['cep'][e['cep']], 'cep'
    return None, None


# ---------------------------------------------------------------- Supabase
def supabase_upsert(feats: list[dict], url: str, chave: str, rodada: str) -> None:
    cab = {'apikey': chave, 'Authorization': f'Bearer {chave}', 'Content-Type': 'application/json',
           'Prefer': 'resolution=merge-duplicates,return=minimal', 'User-Agent': UA}
    linhas = []
    for f in feats:
        p = f['properties']
        linhas.append({'cnpj': p['cnpj'], 'nome': p['nome'], 'cnae': p['cnae'], 'cnae_principal': p['cnae_principal'],
                       'endereco': p['endereco'], 'bairro': p['bairro'], 'cep': p['cep'], 'abertura': p['abertura'],
                       'lat_receita': f['geometry']['coordinates'][1], 'lng_receita': f['geometry']['coordinates'][0],
                       'geo_precisao': p['geo_precisao'], 'origem': 'receita', 'ativo': True, 'atualizado_receita': rodada})
    for i in range(0, len(linhas), 500):
        corpo = json.dumps(linhas[i:i + 500]).encode()
        req = urllib.request.Request(f'{url}/rest/v1/estabelecimentos?on_conflict=cnpj', data=corpo, headers=cab, method='POST')
        urllib.request.urlopen(req, timeout=120).read()
        log(f'Supabase: {min(i + 500, len(linhas))}/{len(linhas)}')
    # quem saiu da lista (baixado, mudou de cidade ou de atividade) fica inativo
    req = urllib.request.Request(f'{url}/rest/v1/estabelecimentos?origem=eq.receita&atualizado_receita=lt.{rodada}',
                                 data=json.dumps({'ativo': False}).encode(), headers=cab, method='PATCH')
    urllib.request.urlopen(req, timeout=120).read()


# ---------------------------------------------------------------- principal
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--municipio', default=os.getenv('MUNICIPIO', 'PETROLINA'))
    ap.add_argument('--uf', default=os.getenv('UF', 'PE'))
    ap.add_argument('--ibge', default=os.getenv('COD_IBGE', '2611101'))
    ap.add_argument('--mes', default=os.getenv('MES') or None, help='AAAA-MM da Receita; vazio = mais recente')
    ap.add_argument('--cnefe-url', default=os.getenv('CNEFE_URL') or None)
    ap.add_argument('--pasta', default=os.getenv('PASTA_DOWNLOADS', str(RAIZ / '.downloads')))
    ap.add_argument('--local', help='Pasta com arquivos já baixados (Municipios.zip, Estabelecimentos*.zip, Empresas*.zip, cnefe*.zip). Não usa a internet.')
    ap.add_argument('--pular-empresas', action='store_true', help='Não baixa Empresas*.zip (usa só o nome fantasia).')
    ap.add_argument('--saida', default='estabelecimentos.geojson')
    ap.add_argument('--cnae', default=str(RAIZ / 'data' / 'cnae.json'))
    a = ap.parse_args()

    cnaes = carregar_cnae(Path(a.cnae))
    log(f'{len(cnaes)} atividades de interesse em {a.cnae}')
    pasta = Path(a.local or a.pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    rodada = date.today().isoformat()
    resumo = {'municipio': a.municipio, 'rodada': rodada}

    # ---- Receita
    if a.local:
        mun_zip = next(pasta.glob('Municipios*.zip'))
        estab_zips = sorted(pasta.glob('Estabelecimentos*.zip'))
        emp_zips = sorted(pasta.glob('Empresas*.zip'))
        resumo['mes_receita'] = 'local'
    else:
        base, mes = receita_mes(a.mes)
        resumo['mes_receita'] = mes
        log(f'Receita: {base}{mes}/')
        arquivos = [h for h in listar(f'{base}{mes}/') if h.lower().endswith('.zip')]
        def pegar(prefixo):
            return [baixar(f'{base}{mes}/{h}', pasta / h) for h in sorted(set(arquivos)) if h.lower().startswith(prefixo.lower())]
        mun_zip = pegar('Municipios')[0]
        estab_zips = pegar('Estabelecimentos')
        emp_zips = [] if a.pular_empresas else pegar('Empresas')

    cod_mun = codigo_municipio_receita(mun_zip, a.municipio)
    log(f'código da Receita para {a.municipio}: {cod_mun}')
    estabs = filtrar_estabelecimentos(estab_zips, a.uf, cod_mun, cnaes)
    nomes = nomes_empresas(emp_zips, {e['basico'] for e in estabs}) if emp_zips else {}

    # ---- CNEFE
    if a.local:
        cnefe_zip = next(pasta.glob('*[Cc][Nn][Ee][Ff][Ee]*.zip'), None) or next(p for p in pasta.glob('*.zip') if a.ibge in p.name)
    else:
        url = a.cnefe_url or achar_cnefe(a.ibge, a.ibge[:2])
        log(f'CNEFE: {url}')
        cnefe_zip = baixar(url, pasta / ('cnefe_' + url.rsplit('/', 1)[-1]))
    idx = indexar_cnefe(ler_cnefe(cnefe_zip, a.ibge))

    # ---- montagem
    feats, sem_ponto, por_precisao = [], 0, defaultdict(int)
    for e in estabs:
        ponto, precisao = geocodificar(e, idx)
        if not ponto:
            sem_ponto += 1
            continue
        razao, natureza = nomes.get(e['basico'], ('', ''))
        if e['fantasia']:
            nome = e['fantasia']
        elif razao and natureza != NATUREZA_EMPRESARIO_INDIVIDUAL:
            nome = razao
        else:
            nome = f"{cnaes[e['cnae']]['desc']} (sem nome fantasia)"
        por_precisao[precisao] += 1
        endereco = ' '.join(x for x in [e['tipo_log'].title(), e['logradouro'].title()] if x)
        if e['numero']:
            endereco += f", {e['numero']}"
        feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(ponto[1], 6), round(ponto[0], 6)]},
                      'properties': {'cnpj': e['cnpj'], 'nome': limpar_nome(nome), 'cnae': e['cnae'], 'cnae_principal': e['cnae_principal'],
                                     'endereco': endereco, 'bairro': e['bairro'].title(), 'cep': e['cep'], 'abertura': e['abertura'],
                                     'geo_precisao': precisao}})

    gj = {'type': 'FeatureCollection', 'metadata': {**resumo, 'fonte': 'Receita Federal (CNPJ) + IBGE (CNEFE 2022)', 'gerado_em': datetime.now().isoformat(timespec='seconds')}, 'features': feats}
    Path(a.saida).write_text(json.dumps(gj, ensure_ascii=False), encoding='utf-8')
    resumo.update({'estabelecimentos_interesse': len(estabs), 'localizados': len(feats), 'sem_localizacao': sem_ponto,
                   'por_endereco': por_precisao['endereco'], 'por_cep': por_precisao['cep']})
    log(json.dumps(resumo, ensure_ascii=False))

    if os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_SERVICE_KEY'):
        supabase_upsert(feats, os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SERVICE_KEY'], rodada)
        resumo['supabase'] = 'atualizado'
    else:
        log('Supabase não configurado: só o arquivo GeoJSON foi gerado.')

    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
            f.write('## Base pública de Petrolina\n\n| Item | Valor |\n|---|---|\n')
            for k, v in resumo.items():
                f.write(f'| {k} | {v} |\n')
            f.write('\nBaixe o artefato **estabelecimentos-petrolina** e importe no painel em Ajustes > Dados, '
                    'ou ligue o Supabase para a atualização ir direto ao site.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
