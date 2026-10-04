# Eleições 2026 — apuração em tempo real

Dashboard aberto da apuração (Presidente com mapa interativo do Brasil por UF; Governador, Senado,
Deputado Federal e Deputado Estadual de Santa Catarina), alimentado exclusivamente pelos arquivos
oficiais de divulgação do TSE (`resultados.tse.jus.br`).

Produção: https://eleicao.infinitytech.net.br

- Resultado nacional (1º, 2º, diferença, demais candidatos, % de seções totalizadas).
- Mapa SVG vetorial (malha oficial do IBGE) com a cor do partido que lidera cada UF no momento:
  PT em vermelho, PL em verde, demais em cinza, UF sem totalização tracejada, empate com aparência própria.
- Contador de UFs (PT + PL + Outros + Empate + Aguardando = 27).
- Clique/toque no estado ou seletor "Ver estado" para ver 1º/2º/3º, votos, diferença, seções e horário.
- % de apuração própria de cada UF (seções totalizadas / total) no cartão, no tooltip e, no desktop, no mapa.
- Abas Governador, Senado, Federal e Estadual de SC. Nos cargos proporcionais, "Entrando" vem da
  distribuição parcial de vagas por agremiação calculada pelo TSE (`agr.vag`: quociente partidário e
  médias), preenchida pelos mais votados de cada lista — não do ranking geral de votos. Quando o TSE
  publica a situação oficial (`st`/`e`), ela substitui a projeção. Nada é chamado de "eleito" antes disso.
- Atualização ao vivo via Server-Sent Events; só os estados que mudaram são redesenhados.

## Como os dados do TSE são consumidos

Estrutura descoberta em `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`
(eleição federal 2026, 1º turno = `6257`; 2º turno = `6258`; cargo Presidente = `c0001`).

| Arquivo | Uso |
| --- | --- |
| `ele2026/6257/dados/br/br-e006257-ab.json` | Um único arquivo com o andamento de todas as UFs (data/hora da última totalização e seções totalizadas). |
| `ele2026/6257/dados/<uf>/<uf>-c0001-e006257-u.json` | Resultado presidencial de uma UF (ou `br` para o nacional). |
| `ele2026/6259/dados/sc/sc-c0003-e006259-u.json` | Governador SC (eleição estadual `6259`; 2º turno = `6260`). |
| `ele2026/6259/dados/sc/sc-c0005-e006259-u.json` | Senador SC. |
| `ele2026/6259/dados/sc/sc-c0006-e006259-u.json` | Deputado Federal SC (com `qe` e vagas por agremiação). |
| `ele2026/6259/dados/sc/sc-c0007-e006259-u.json` | Deputado Estadual SC. |

A cada 3 segundos o backend verifica quais arquivos podem ter novidade, sempre com requisições
condicionais (`If-None-Match`; sem mudança, a resposta é `304` vazia):

- o arquivo `ab` indica quais UFs tiveram nova totalização; só essas têm o resultado consultado;
- a CDN do TSE mantém cada arquivo em cache por até ~60 s e informa o tempo restante em `max-age`.
  O backend não pergunta antes disso (a CDN não teria nada mais novo) e revalida cada arquivo assim
  que o cache dele expira. Como `ab` e os arquivos das UFs têm ciclos de cache independentes, isso
  evita somar dois atrasos: cada UF chega no máximo um ciclo de CDN depois da publicação do TSE.

Na prática são ~0,5 requisição por segundo, quase todas `304`. O navegador nunca acessa o TSE:
tudo fica em cache no backend e é distribuído aos clientes por SSE no instante em que muda.

Os horários do TSE vêm no fuso local de cada UF (AC = UTC-5; AM, RR, RO, MT, MS = UTC-4) e são
exibidos no horário de Brasília.

A cor de cada UF vem da sigla do partido do candidato (`par.sg` no arquivo do TSE), nunca do nome.
UF sem seção totalizada ou sem votos não é atribuída a ninguém; empate no 1º lugar não escolhe lado.

## Rodando

Requer Node.js 20+ e nenhuma dependência.

```sh
npm start          # http://127.0.0.1:3026
npm test           # testes unitários + pipeline completo contra um TSE simulado
npm run build:map  # regenera public/brasil.svg a partir da API de malhas do IBGE
```

Variáveis: `PORT`, `HOST`, `POLL_MS` (padrão 3000), `TSE_ELECTION` (padrão `6257`; use `6258` no 2º turno),
`TSE_STATE_ELECTION` (padrão `6259`; `6260` no 2º turno), `STATE_UF` (padrão `SC`),
`TSE_CICLO` (padrão `ele2026`), `ELECTION_NAME`, `TSE_BASE`.

API: `GET /api/president` (snapshot), `GET /api/stream` (SSE: `snapshot` ao conectar, depois `update`
apenas com as áreas alteradas), `GET /healthz`.

## Deploy

```sh
git -C /opt/eleicao pull && systemctl restart eleicao
```

Arquivos de referência em `deploy/` (unit do systemd e site do nginx com SSE sem buffer).

## Licença

MIT. Dados: Tribunal Superior Eleitoral. Malha territorial: IBGE.
