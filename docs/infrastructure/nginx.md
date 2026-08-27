# nginx Configuration

## Overview

BrandBlitz uses the official `nginx:1.25-alpine` image. In production the config is
generated from a template so that shell variables (e.g. `${DOMAIN}`) are substituted
at container start rather than baked in at build time.

Response compression is handled in the API process with Express middleware, so
this nginx config intentionally does not add a second gzip or brotli layer. That
keeps `Vary: Accept-Encoding` correct without double-compressing JSON payloads.

## How envsubst works

The official nginx image automatically processes any `*.template` file mounted under
`/etc/nginx/templates/` and writes the rendered output to `/etc/nginx/conf.d/` before
nginx starts. No custom entrypoint is needed.

```
nginx/templates/nginx.prod.conf.template
        │  (mounted as /etc/nginx/templates/default.conf.template)
        │
        ▼  container start → envsubst runs automatically
/etc/nginx/conf.d/default.conf   (rendered, with ${DOMAIN} resolved)
```

## Required environment variable

| Variable | Example | Description |
|----------|---------|-------------|
| `DOMAIN` | `brandblitz.io` | The public domain — substituted into `server_name` and TLS cert paths |

Set it in your deploy environment or `.env` file. The prod compose passes it through:

```yaml
# docker-compose.prod.yml
nginx:
  environment:
    DOMAIN: ${DOMAIN}
```

## Local dev

Dev uses `nginx/nginx.dev.conf` directly (no variable substitution needed) via
`docker-compose.yml`. The template is prod-only.

### Local TLS certs (optional)

If you need HTTPS in local dev (e.g. for testing secure cookies or WebAuthn):

```bash
bash scripts/generate-nginx-dev-certs.sh
```

This creates `nginx/certs/server.crt` and `nginx/certs/server.key` (self-signed,
valid 365 days). The script follows the same pattern as `scripts/generate-minio-certs.sh`.

To enable TLS, uncomment the HTTPS server block in `nginx/nginx.dev.conf` and
ensure the certs directory is volume-mounted in `docker-compose.yml`:

```yaml
# docker-compose.yml — nginx service volumes
- ./nginx/certs:/etc/nginx/certs:ro
```

## Updating the config

Edit `nginx/templates/nginx.prod.conf.template`. Do **not** edit `nginx/nginx.prod.conf`
(kept only for reference; it is no longer mounted in prod).

## CI check

`gitleaks.yml` fails the build if `${DOMAIN}` appears without the template file path,
ensuring the old non-substituted conf is never re-mounted accidentally.
