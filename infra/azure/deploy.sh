#!/usr/bin/env bash
# Deploy GridShift to Azure Container Apps (API + web) from source.
#
# Prereqs: `az login`, Docker not required (ACA builds from source in the cloud).
# Usage:   ./infra/azure/deploy.sh            # uses defaults below
# Env:     RG, LOCATION, ENV_NAME, API_APP, WEB_APP override the defaults.
#          FOUNDRY_* are read from ../../.env if present.

set -euo pipefail
cd "$(dirname "$0")/../.."

RG="${RG:-gridshift-rg}"
LOCATION="${LOCATION:-eastus2}"
ENV_NAME="${ENV_NAME:-gridshift-env}"
API_APP="${API_APP:-gridshift-api}"
WEB_APP="${WEB_APP:-gridshift-web}"

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

az extension add --name containerapp --upgrade --only-show-errors >/dev/null
az provider register -n Microsoft.App --wait >/dev/null
az provider register -n Microsoft.OperationalInsights --wait >/dev/null

az group create -n "$RG" -l "$LOCATION" -o none
az containerapp env create -n "$ENV_NAME" -g "$RG" -l "$LOCATION" -o none 2>/dev/null || true

echo "==> deploying API"
az containerapp up -n "$API_APP" -g "$RG" -l "$LOCATION" --environment "$ENV_NAME" \
  --source services/api --ingress external --target-port 8000 \
  --env-vars "CORS_ORIGINS=*" "DEMO_RANDOM_SEED=42" \
    "FOUNDRY_ENDPOINT=${FOUNDRY_ENDPOINT:-}" "FOUNDRY_API_KEY=${FOUNDRY_API_KEY:-}" \
    "FOUNDRY_MODEL_DEPLOYMENT=${FOUNDRY_MODEL_DEPLOYMENT:-gpt-4.1}" \
    "FOUNDRY_API_VERSION=${FOUNDRY_API_VERSION:-2024-10-21}" \
  -o none
API_FQDN=$(az containerapp show -n "$API_APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
az containerapp update -n "$API_APP" -g "$RG" --min-replicas 1 --max-replicas 1 -o none
echo "API: https://$API_FQDN"

echo "==> deploying web"
az containerapp up -n "$WEB_APP" -g "$RG" -l "$LOCATION" --environment "$ENV_NAME" \
  --source apps/web --ingress external --target-port 3000 \
  --env-vars "API_UPSTREAM=https://$API_FQDN" \
  -o none
WEB_FQDN=$(az containerapp show -n "$WEB_APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
az containerapp update -n "$WEB_APP" -g "$RG" --min-replicas 1 --max-replicas 1 -o none

az containerapp update -n "$API_APP" -g "$RG" --set-env-vars "CORS_ORIGINS=https://$WEB_FQDN" -o none

echo
echo "GridShift is live:"
echo "  web: https://$WEB_FQDN"
echo "  api: https://$API_FQDN/health"
