#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN_NAME="${CUSTOM_DOMAIN_NAME:-}"
VALIDATION_DOMAIN="${VALIDATION_DOMAIN:-}"
APPLICATION_NAME="${APPLICATION_NAME:-word-trainer}"
CERTIFICATE_REGION="us-east-1"
CERTIFICATE_STACK_NAME="${CERTIFICATE_STACK_NAME:-}"
AWS_PROFILE="${AWS_PROFILE:-}"

if [[ -z "${DOMAIN_NAME}" || -z "${VALIDATION_DOMAIN}" || -z "${CERTIFICATE_STACK_NAME}" ]]; then
  echo "CUSTOM_DOMAIN_NAME, VALIDATION_DOMAIN and CERTIFICATE_STACK_NAME must be set." >&2
  exit 1
fi

AWS_ARGS=(--region "${CERTIFICATE_REGION}")
if [[ -n "${AWS_PROFILE}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

aws "${AWS_ARGS[@]}" cloudformation validate-template \
  --template-body "file://${SCRIPT_DIR}/domain-certificate.yml" \
  >/dev/null

if ! aws "${AWS_ARGS[@]}" cloudformation describe-stacks --stack-name "${CERTIFICATE_STACK_NAME}" >/dev/null 2>&1; then
  echo "Requesting certificate for ${DOMAIN_NAME}"
  aws "${AWS_ARGS[@]}" cloudformation create-stack \
    --stack-name "${CERTIFICATE_STACK_NAME}" \
    --template-body "file://${SCRIPT_DIR}/domain-certificate.yml" \
    --parameters \
      "ParameterKey=DomainName,ParameterValue=${DOMAIN_NAME}" \
      "ParameterKey=ValidationDomain,ParameterValue=${VALIDATION_DOMAIN}" \
      "ParameterKey=ApplicationName,ParameterValue=${APPLICATION_NAME}" \
    --tags Key=Application,Value="${APPLICATION_NAME}" Key=ManagedBy,Value=CloudFormation \
    >/dev/null
else
  STACK_DOMAIN="$(aws "${AWS_ARGS[@]}" cloudformation describe-stacks \
    --stack-name "${CERTIFICATE_STACK_NAME}" \
    --query "Stacks[0].Parameters[?ParameterKey=='DomainName'].ParameterValue | [0]" \
    --output text)"
  if [[ "${STACK_DOMAIN}" != "${DOMAIN_NAME}" ]]; then
    echo "Certificate stack already belongs to ${STACK_DOMAIN}, not ${DOMAIN_NAME}." >&2
    exit 1
  fi
fi

CERTIFICATE_ARN=""
for _ in {1..10}; do
  CERTIFICATE_ARN="$(aws "${AWS_ARGS[@]}" cloudformation describe-stack-resource \
    --stack-name "${CERTIFICATE_STACK_NAME}" \
    --logical-resource-id Certificate \
    --query StackResourceDetail.PhysicalResourceId \
    --output text 2>/dev/null || true)"
  if [[ -n "${CERTIFICATE_ARN}" && "${CERTIFICATE_ARN}" != "None" ]]; then
    break
  fi
  sleep 3
done

if [[ -z "${CERTIFICATE_ARN}" || "${CERTIFICATE_ARN}" == "None" ]]; then
  echo "Certificate request is still starting. Run this command again in a minute." >&2
  exit 1
fi

STATUS="$(aws "${AWS_ARGS[@]}" acm describe-certificate \
  --certificate-arn "${CERTIFICATE_ARN}" \
  --query Certificate.Status \
  --output text)"

echo "Certificate status: ${STATUS}"
if [[ "${STATUS}" == "ISSUED" ]]; then
  echo "Certificate is ready. Apply it with npm run deploy:infra using your private deployment environment."
else
  echo "Add this ACM validation CNAME at your current DNS provider and keep it permanently:"
  for _ in {1..10}; do
    RECORD_NAME="$(aws "${AWS_ARGS[@]}" acm describe-certificate \
      --certificate-arn "${CERTIFICATE_ARN}" \
      --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Name' \
      --output text)"
    if [[ -n "${RECORD_NAME}" && "${RECORD_NAME}" != "None" ]]; then
      break
    fi
    sleep 3
  done
  aws "${AWS_ARGS[@]}" acm describe-certificate \
    --certificate-arn "${CERTIFICATE_ARN}" \
    --query 'Certificate.DomainValidationOptions[].ResourceRecord.[Name,Type,Value]' \
    --output table
  echo "After validation, run npm run domain:setup again and then npm run deploy:infra."
fi
