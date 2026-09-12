# @b2dcom/ad-platform-clients

Cliente HTTP tipado para as APIs de plataformas de anúncio usadas pelo B2DCOM — hoje Meta Graph API (Instagram/Facebook) e GA4 Data API. Extraído de [b2dcom-insight-hub](https://github.com/juniorrrrr/b2dcom-insight-hub) para ser compartilhado entre **B2DCOM Internal** e **Vision Dash** sem duplicar código.

## O que está aqui

Só a camada "token entra, dado tipado sai (ou `GraphApiError` classificável)":

- `graph-fetch.ts` / `graph-error.ts` — HTTP layer + taxonomia de erro da Graph API (token inválido, rate limit, permissão, transiente), com backoff exponencial embutido para `RATE_LIMITED`.
- `instagram-api.ts` / `facebook-api.ts` — chamadas cruas ao Graph API (Instagram Business, Facebook Page), incluindo `graphBatch` (evita N+1).
- `ga4-query-planner.ts` / `ga4-batch-executor.ts` / `ga4-result-merger.ts` — monta múltiplas queries GA4, executa em paralelo com retry próprio, funde os resultados.

Zero dependências externas — só `typescript` como dev dependency.

## O que NÃO está aqui (de propósito)

- Resolução de token a partir de um banco de dados — cada produto (B2DCOM Internal, Vision Dash) tem seu próprio schema de conexões/tenancy e resolve isso do seu jeito.
- Self-healing / refresh de token (`graph-recovery.ts`, `meta-token-refresh.ts` no B2DCOM Internal) — depende do schema de `meta_connections` de cada produto.
- Qualquer coisa de UI/apresentação (`src/providers/*` no B2DCOM Internal).

## Uso

```ts
import { graphFetch, classifyGraphError, graphBatch } from "@b2dcom/ad-platform-clients";
```

## Build

```bash
npm run build     # emite dist/ (js + .d.ts)
npm run typecheck
```

## Instalação num consumidor (sem registry privado)

```bash
bun add github:juniorrrrr/ad-platform-clients
```
