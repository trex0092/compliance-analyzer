# Cachet status page + cache layer

Public status page for the Hawkeye Sterling compliance suite.

## Components

| Layer | Package | Source | Purpose |
|---|---|---|---|
| Status page | `cachethq/cachet` | https://github.com/cachethq/cachet | User-facing incident + uptime reporting |
| PSR-6 cache | `doctrine/cache` ^2.2 | https://github.com/doctrine/cache | Interop layer for Cachet extensions that need PSR-6 cache pools |
| JS client | `scripts/lib/cachet-client.mjs` | in-tree | How the compliance brain pushes incidents |

## Bringing it up

```bash
cp ops/cachet/.env.cachet.example ops/cachet/.env.cachet
# edit APP_KEY, POSTGRES_PASSWORD, APP_URL

docker compose -f ops/cachet/docker-compose.yml \
  --env-file ops/cachet/.env.cachet \
  up -d
```

Generate the Laravel app key on first boot:

```bash
docker compose -f ops/cachet/docker-compose.yml \
  exec cachet php artisan key:generate --show
```

Install PHP cache extensions (optional, for custom Cachet plugins):

```bash
cd ops/cachet && composer install
```

## Wiring it into the compliance brain

The brain (`scripts/brain.mjs`) automatically pushes unrouted / high-risk
events to Cachet when these environment variables are set:

```
CACHET_BASE_URL=https://status.example.com
CACHET_API_TOKEN=<generated in Cachet UI under Settings → API>
```

When unset, the brain skips Cachet silently — it is an optional surface.

## Security

- `ops/cachet/.env.cachet` is gitignored — never commit it.
- Expose Cachet only behind a reverse proxy with TLS.
- The Docker compose binds the Cachet port to `127.0.0.1` only.
- `doctrine/cache` is transitive through Laravel already; the explicit
  composer.json here pins it so Cachet extensions cannot drift to an
  unsupported major.
