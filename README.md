# Fiscaliza Petrolina

Planejamento das vistorias de fiscalização e regularização em Petrolina/PE: distribuição das equipes por setor no mapa, roteiro do dia no celular do vistoriador, check-in por geolocalização e sugestões automáticas de onde fiscalizar.

Site: **https://aquinogr.github.io/fiscaliza-petrolina/**

> Versão de demonstração. Os dados são fictícios e ficam guardados só no aparelho de quem abre o site. Para a equipe usar de verdade, cada um no seu celular, é preciso ligar o banco de dados (veja "Próximo passo").

## O que cada perfil faz

**Oficial (painel com mapa)**
- Escala do dia: escolhe a equipe de cada setor e distribui a fila automaticamente, respeitando prioridade, prazo e o limite de missões por vistoriador.
- Fila: regularizações recebidas no SAC, denúncias, retornos de notificação e eventos, com prazo e antiguidade.
- Sugestões: estabelecimentos da base pública com maior prioridade, com o motivo de cada ponto do escore. Aceitar vira missão; rejeitar ensina o motor.
- Eventos temporários: agenda com contagem regressiva, alerta para evento anunciado sem solicitação e ficha de cada local recorrente (capacidade autorizada, saídas, acesso de viatura, ponto de água, pendências).
- Aprovações: encaixes pedidos em campo e correções de localização.
- Relatório do dia pronto para colar no WhatsApp.
- Ajustes: raio do check-in, missões por dia, prazo do retorno, cotas, pesos do escore, equipe, setores (desenhar no mapa ou importar GeoJSON do QGIS) e backup.

**Vistoriador (celular)**
- Roteiro do dia na ordem de menor deslocamento, com botões para Google Maps e Waze.
- Distância até o ponto em tempo real. O check-in vale dentro do raio (150 m por padrão); fora dele, pede justificativa e permite sugerir a localização correta.
- Resultado da vistoria em lista fechada, documento visto no local, observações e até 4 fotos. Notificação gera retorno automático na fila do oficial.
- "Perto de mim": estabelecimentos prioritários num raio de 700 m para pedir encaixe.
- Funciona sem sinal: o site abre offline e os registros ficam guardados até a conexão voltar.
- A localização é lida só no momento do check-in e enquanto a tela de distância está aberta. Não há rastreamento contínuo.

## Testar agora

1. Abra o site e entre como **oficial**.
2. Numa segunda aba, entre como um **vistoriador**. O que um faz aparece na tela do outro.
3. No celular, para cair direto no perfil de um vistoriador: `https://aquinogr.github.io/fiscaliza-petrolina/?vistoriador=v1` (v1 a v4).
4. Longe de Petrolina? Ligue **Simular GPS** na barra amarela e toque no mapa para escolher sua posição.
5. Para recomeçar: Ajustes > Dados > Restaurar dados de exemplo.

Para instalar no celular: abra o site no Chrome (Android) ou Safari (iPhone) e use "Adicionar à tela inicial".

## Publicar no GitHub Pages (uma vez)

No repositório: **Settings > Pages > Build and deployment > Deploy from a branch**, escolha `main` e `/ (root)` e salve. Em um ou dois minutos o site fica no endereço acima.

## Regularizações do SAC

O site não acessa o sac.bombeiros.pe.gov.br. As regularizações entram quando o oficial cadastra a missão (Fila > Nova missão), informando o número do processo e o prazo. O cadastro procura o estabelecimento na base pelo nome ou CNPJ e marca o ponto no mapa. Com o tempo, o resultado de cada vistoria vai formando a situação documental de cada estabelecimento, alimentada pelo campo.

## Rotina automática da base pública

O arquivo `.github/workflows/atualizar-base.yml` roda todo dia 20 (e pode ser disparado à mão em **Actions > Atualizar base pública > Run workflow**). Ele:

1. baixa os dados abertos de CNPJ da Receita Federal do mês mais recente;
2. guarda só os estabelecimentos **ativos** de Petrolina com atividade de interesse (tabela `data/cnae.json`, a mesma usada pelo site);
3. localiza cada endereço pelo CNEFE do Censo 2022 do IBGE (CEP e número, depois rua e número, por último o centro do CEP);
4. gera o arquivo `estabelecimentos.geojson` como artefato da execução e, se o banco estiver ligado, atualiza a tabela direto.

Enquanto o banco não estiver ligado: baixe o artefato **estabelecimentos-petrolina** na página da execução e importe em **Ajustes > Dados > Importar base pública**.

Proteção de dados: a rotina não guarda telefone, e-mail nem sócios, e não usa a razão social de empresário individual (inclui MEI), que costuma ser o nome da pessoa. O artefato de um repositório público pode ser baixado por qualquer pessoa logada no GitHub; ele contém só dados públicos da Receita.

O GitHub desliga rotinas agendadas de repositórios públicos sem nenhuma atividade por 60 dias. Se isso acontecer, reative em Actions.

As categorias de `data/cnae.json` servem para priorizar sugestões. Não equivalem à classificação de ocupação das normas de segurança contra incêndio.

## Próximo passo: banco de dados (Supabase, gratuito)

Com o banco ligado, cada pessoa entra com o próprio login, o vistoriador vê só as próprias missões e o painel do oficial atualiza em tempo real.

1. Crie uma conta e um projeto em supabase.com.
2. Em **SQL Editor**, rode o arquivo `supabase/schema.sql` (uma vez).
3. Em **Authentication > Users**, crie os usuários e ligue cada um ao seu perfil (exemplo no fim do `schema.sql`).
4. Em **Settings > API**, copie a *Project URL* e a chave *anon public*. Essas duas vão no site.
5. Para a rotina mensal gravar direto no banco: no GitHub, **Settings > Secrets and variables > Actions**, crie `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` (a chave *service_role*, que nunca vai para o site).

## Cuidados

- Nenhum dado operacional fica no repositório. No plano gratuito o GitHub Pages exige repositório público, então só o código é público.
- Ferramenta pessoal usada em serviço: dê ciência à chefia imediata antes de a equipe depender dela.
- Os setores de exemplo são ilustrativos. Substitua pelos setores reais.
- A busca de endereço no cadastro usa o OpenStreetMap e é aproximada. Confira e arraste o marcador.
- Geolocalização de celular pode ser falsificada. O check-in é um registro de apoio, não prova pericial.

## Estrutura

```
index.html, css/, js/          site (sem etapa de compilação)
  js/admin.js                  painel do oficial
  js/field.js                  app do vistoriador
  js/store.js                  dados e regras (modo demonstração: localStorage)
  js/score.js                  motor de sugestões
data/cnae.json                 atividades de interesse e categorias
sw.js, manifest.webmanifest    funcionamento offline e instalação no celular
pipeline/atualizar_base.py     rotina mensal (só biblioteca padrão do Python)
supabase/schema.sql            banco de dados com regras de acesso
```

Mapa: © colaboradores do OpenStreetMap. Biblioteca de mapas: Leaflet. Dados públicos: Receita Federal (CNPJ) e IBGE (CNEFE, Censo 2022).
