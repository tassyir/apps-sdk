---
'@tassyir/app': minor
---

`verifyProxyRequest(request, { keys, installationId })` and `verifyProxy({ method, url, headers, body }, …)` check a request the Tassyir app proxy forwards (not live yet: the proxy opens after the marketplace): the Ed25519 `v1a` signature by Tassyir's webhook keys over `tassyir-proxy.v1.{timestamp}.{METHOD}.{path+query}.{sha256 hex of the body}.{installationId}.{storeId}`, the timestamp within 5 minutes, and the installation by your check (required). It answers the signed `installationId`, `storeId`, `method` and `path`, and the unsigned context (`businessId`, `storeHost`, `country`, `locale`) apart. New `PROXY_*` verification codes, `PROXY_SIGNATURE_LABEL`, `PROXY_TOLERANCE_SECONDS` and `proxySignatureContent`.
