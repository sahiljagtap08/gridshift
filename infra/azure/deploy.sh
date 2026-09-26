#!/usr/bin/env bash
# Deploy GridShift to Azure Container Apps (API + web).
#
# Images are built locally with Docker (linux/amd64) and pushed to an Azure Container
# Registry, because some subscriptions (Azure for Students) do not permit ACR cloud
# builds. Prereqs: `az login`, Docker running.
#
# Usage:   LOCATION=westus ./infra/azure/deploy.sh
# Env:     RG, LOCATION, ENV_NAME, API_APP, WEB_APP, ACR_NAME override the defaults.
#          FOUNDRY_* are read from .env if present.

set -euo pipefail
cd "$(dirname "$0")/../.."

RG="${RG:-gridshift-rg}"
LOCATION="${LOCATION:-westus}"
ENV_NAME="${ENV_NAME:-gridshift-env}"
API_APP="${API_APP:-gridshift-api}"
WEB_APP="${WEB_APP:-gridshift-web}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

az extension add --name containerapp --upgrade --only-show-errors >/dev/null
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry; do
  az provider register -n "$ns" --wait >/dev/null
done

az group create -n "$RG" -l "$LOCATION" -o none

# ---- registry -------------------------------------------------------------
ACR_NAME="${ACR_NAME:-$(az acr list -g "$RG" --query "[0].name" -o tsv)}"
if [[ -z "$ACR_NAME" ]]; then
  ACR_NAME="gridshift$(openssl rand -hex 3)"
  az acr create -n "$ACR_NAME" -g "$RG" -l "$LOCATION" --sku Basic --admin-enabled true -o none
else
  az acr update -n "$ACR_NAME" --admin-enabled true -o none
fi
ACR_SERVER=$(az acr show -n "$ACR_NAME" -g "$RG" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR_NAME" --query "passwords[0].value" -o tsv)
echo "$ACR_PASS" | docker login "$ACR_SERVER" -u "$ACR_USER" --password-stdin >/dev/null

# ---- build + push ---------------------------------------------------------
echo "==> building images ($TAG)"
docker build --platform linux/amd64 -t "$ACR_SERVER/gridshift-api:$TAG" services/api
docker build --platform linux/amd64 -t "$ACR_SERVER/gridshift-web:$TAG" apps/web
docker push "$ACR_SERVER/gridshift-api:$TAG"
docker push "$ACR_SERVER/gridshift-web:$TAG"

# ---- environment ----------------------------------------------------------
az containerapp env create -n "$ENV_NAME" -g "$RG" -l "$LOCATION" -o none 2>/dev/null || true

deploy_app() {
  local name=$1 image=$2 port=$3; shift 3
  if az containerapp show -n "$name" -g "$RG" -o none 2>/dev/null; then
    az containerapp update -n "$name" -g "$RG" --image "$image" --set-env-vars "$@" -o none
  else
    az containerapp create -n "$name" -g "$RG" --environment "$ENV_NAME" --image "$image" \
      --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
      --ingress external --target-port "$port" --min-replicas 1 --max-replicas 1 \
      --cpu 0.5 --memory 1.0Gi --env-vars "$@" -o none
  fi
  az containerapp show -n "$name" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv
}

echo "==> deploying API"
API_FQDN=$(deploy_app "$API_APP" "$ACR_SERVER/gridshift-api:$TAG" 8000 \
  "CORS_ORIGINS=*" "DEMO_RANDOM_SEED=42" \
  "FOUNDRY_ENDPOINT=${FOUNDRY_ENDPOINT:-}" "FOUNDRY_API_KEY=${FOUNDRY_API_KEY:-}" \
  "FOUNDRY_MODEL_DEPLOYMENT=${FOUNDRY_MODEL_DEPLOYMENT:-gpt-4.1-mini}" \
  "FOUNDRY_API_VERSION=${FOUNDRY_API_VERSION:-2024-10-21}")
echo "API: https://$API_FQDN"

echo "==> deploying web"
WEB_FQDN=$(deploy_app "$WEB_APP" "$ACR_SERVER/gridshift-web:$TAG" 3000 \
  "API_UPSTREAM=https://$API_FQDN")

az containerapp update -n "$API_APP" -g "$RG" --set-env-vars "CORS_ORIGINS=https://$WEB_FQDN" -o none

echo
echo "GridShift is live:"
echo "  web: https://$WEB_FQDN"
echo "  api: https://$API_FQDN/health"
