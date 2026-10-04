# Eleições 2026 — apuração presidencial em tempo real

Dashboard aberto da apuração para Presidente com mapa interativo do Brasil por UF, alimentado
exclusivamente pelos arquivos oficiais de divulgação do TSE (`resultados.tse.jus.br`).

Produção: https://eleicao.infinitytech.net.br

- Resultado nacional (1º, 2º, diferença, demais candidatos, % de seções totalizadas).
- Mapa SVG vetorial (malha oficial do IBGE) com a cor do partido que lidera cada UF no momento:
  PT em vermelho, PL em verde, demais em cinza, UF sem totalização tracejada, empate com aparência própria.
- Contador de UFs (PT + PL + Outros + Empate + Aguardando = 27).
- Clique/toque no estado ou seletor "Ver estado" para ver 1º/2º/3º, votos, diferença, seções e horário.
- Atualização ao vivo via Server-Sent Events; só os estados que mudaram são redesenhados.

## Como os dados do TSE são consumidos

Estrutura descoberta em `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`
(eleição federal 2026, 1º turno = `6257`; 2º turno = `6258`; cargo Presidente = `c0001`).

| Arquivo | Uso |
| --- | --- |
| `ele2026/6257/dados/br/br-e006257-ab.json` | Um único arquivo com o andamento de todas as UFs (data/hora da última totalização e seções totalizadas). |
| `ele2026/6257/dados/<uf>/<uf>-c0001-e006257-u.json` | Resultado presidencial de uma UF (ou `br` para o nacional). |

A cada 3 segundos o backend faz **uma** requisição condicional (`If-None-Match`) ao arquivo `ab`
(a CDN do TSE o publica com `max-age=2`; sem mudança, a resposta é `304` vazia). Só as UFs cuja
linha mudou têm o arquivo de resultado baixado. Se a CDN ainda servir uma versão anterior do
arquivo da UF, o backend tenta de novo nos ciclos seguintes. O resultado nacional também é
revalidado em todo ciclo e, a cada 60 segundos, todos os arquivos passam por uma revalidação de
segurança (também condicional, `304` quando nada mudou). O navegador nunca acessa o TSE: tudo
fica em cache no backend e é distribuído aos clientes por SSE.

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
