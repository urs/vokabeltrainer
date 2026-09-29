#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="${SCRIPT_DIR}/static-site.yml"

APPLICATION_NAME="${APPLICATION_NAME:-word-trainer}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
REGION="${REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-central-1}}}"
STACK_NAME="${STACK_NAME:-${APPLICATION_NAME}-${ENVIRONMENT}-static-site}"
AWS_PROFILE="${AWS_PROFILE:-}"
OCR_ORIGIN_SECRET="${OCR_ORIGIN_SECRET:-}"
OCR_BASIC_AUTHORIZATION="${OCR_BASIC_AUTHORIZATION:-}"
OCR_ORIGIN_SECRET_PARAMETER="${OCR_ORIGIN_SECRET_PARAMETER:-}"
OCR_BASIC_AUTHORIZATION_PARAMETER="${OCR_BASIC_AUTHORIZATION_PARAMETER:-}"
OCR_MODEL_ID="${OCR_MODEL_ID:-eu.amazon.nova-pro-v1:0}"
OCR_MONTHLY_BUDGET_USD="${OCR_MONTHLY_BUDGET_USD:-6}"
CUSTOM_DOMAIN_NAME="${CUSTOM_DOMAIN_NAME:-}"
CUSTOM_CERTIFICATE_ARN="${CUSTOM_CERTIFICATE_ARN:-}"
CERTIFICATE_STACK_NAME="${CERTIFICATE_STACK_NAME:-}"
CERTIFICATE_REGION="us-east-1"

AWS_ARGS=(--region "${REGION}")
if [[ -n "${AWS_PROFILE}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

if [[ -z "${OCR_ORIGIN_SECRET}" && -n "${OCR_ORIGIN_SECRET_PARAMETER}" ]]; then
  OCR_ORIGIN_SECRET="$(aws "${AWS_ARGS[@]}" ssm get-parameter --name "${OCR_ORIGIN_SECRET_PARAMETER}" --with-decryption --query Parameter.Value --output text 2>/dev/null || true)"
fi
if [[ -z "${OCR_BASIC_AUTHORIZATION}" && -n "${OCR_BASIC_AUTHORIZATION_PARAMETER}" ]]; then
  OCR_BASIC_AUTHORIZATION="$(aws "${AWS_ARGS[@]}" ssm get-parameter --name "${OCR_BASIC_AUTHORIZATION_PARAMETER}" --with-decryption --query Parameter.Value --output text 2>/dev/null || true)"
fi
if [[ -z "${OCR_ORIGIN_SECRET}" || "${OCR_ORIGIN_SECRET}" == "None" ]]; then
  OCR_ORIGIN_SECRET="$(openssl rand -hex 32)"
  if [[ -n "${OCR_ORIGIN_SECRET_PARAMETER}" ]]; then
    aws "${AWS_ARGS[@]}" ssm put-parameter --name "${OCR_ORIGIN_SECRET_PARAMETER}" --type SecureString --value "${OCR_ORIGIN_SECRET}" --overwrite >/dev/null
  fi
fi
if [[ -z "${OCR_BASIC_AUTHORIZATION}" || "${OCR_BASIC_AUTHORIZATION}" == "None" ]]; then
  echo "OCR Basic authorization is missing. Set OCR_BASIC_AUTHORIZATION or OCR_BASIC_AUTHORIZATION_PARAMETER." >&2
  exit 1
fi

CERTIFICATE_ARGS=(--region "${CERTIFICATE_REGION}")
if [[ -n "${AWS_PROFILE}" ]]; then
  CERTIFICATE_ARGS+=(--profile "${AWS_PROFILE}")
fi

CERTIFICATE_STATUS=""
if [[ -n "${CERTIFICATE_STACK_NAME}" ]]; then
  CERTIFICATE_STATUS="$(aws "${CERTIFICATE_ARGS[@]}" cloudformation describe-stacks \
    --stack-name "${CERTIFICATE_STACK_NAME}" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)"
fi
if [[ "${CERTIFICATE_STATUS}" == "CREATE_COMPLETE" || "${CERTIFICATE_STATUS}" == "UPDATE_COMPLETE" ]]; then
  CUSTOM_DOMAIN_NAME="${CUSTOM_DOMAIN_NAME:-$(aws "${CERTIFICATE_ARGS[@]}" cloudformation describe-stacks \
    --stack-name "${CERTIFICATE_STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='DomainName'].OutputValue | [0]" --output text)}"
  CUSTOM_CERTIFICATE_ARN="${CUSTOM_CERTIFICATE_ARN:-$(aws "${CERTIFICATE_ARGS[@]}" cloudformation describe-stacks \
    --stack-name "${CERTIFICATE_STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue | [0]" --output text)}"
  echo "Using custom domain: https://${CUSTOM_DOMAIN_NAME}"
else
  echo "Custom domain certificate is not issued yet; keeping the CloudFront default domain."
fi

echo "Validating CloudFormation template: ${TEMPLATE_FILE}"
aws "${AWS_ARGS[@]}" cloudformation validate-template \
  --template-body "file://${TEMPLATE_FILE}" \
  >/dev/null

echo "Deploying stack ${STACK_NAME} in ${REGION}"
aws "${AWS_ARGS[@]}" cloudformation deploy \
  --template-file "${TEMPLATE_FILE}" \
  --stack-name "${STACK_NAME}" \
  --parameter-overrides \
    "ApplicationName=${APPLICATION_NAME}" \
    "Environment=${ENVIRONMENT}" \
    "OcrOriginSecret=${OCR_ORIGIN_SECRET}" \
    "OcrBasicAuthorization=${OCR_BASIC_AUTHORIZATION}" \
    "OcrModelId=${OCR_MODEL_ID}" \
    "OcrMonthlyBudgetUsd=${OCR_MONTHLY_BUDGET_USD}" \
    "CustomDomainName=${CUSTOM_DOMAIN_NAME}" \
    "CustomCertificateArn=${CUSTOM_CERTIFICATE_ARN}" \
  --capabilities CAPABILITY_IAM \
  --tags \
    "Application=${APPLICATION_NAME}" \
    "Environment=${ENVIRONMENT}" \
    "ManagedBy=CloudFormation" \
  --no-fail-on-empty-changeset

echo "Stack outputs:"
aws "${AWS_ARGS[@]}" cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" \
  --output table
