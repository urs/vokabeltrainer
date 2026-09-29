#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APPLICATION_NAME="${APPLICATION_NAME:-word-trainer}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
REGION="${REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-central-1}}}"
STACK_NAME="${STACK_NAME:-${APPLICATION_NAME}-${ENVIRONMENT}-static-site}"
AWS_PROFILE="${AWS_PROFILE:-}"

AWS_ARGS=(--region "${REGION}")
if [[ -n "${AWS_PROFILE}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

cd "${PROJECT_DIR}"

# Production uses the password-protected same-origin CloudFront behavior.
export VITE_OCR_API_URL="${VITE_OCR_API_URL:-/api/analyze}"
if [[ -z "${VITE_OCR_USERNAME:-}" ]]; then
  echo "VITE_OCR_USERNAME must be set for a production deployment." >&2
  exit 1
fi
export VITE_OCR_USERNAME

echo "Building application"
npm run build

stack_output() {
  local output_key="$1"
  aws "${AWS_ARGS[@]}" cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

BUCKET_NAME="$(stack_output BucketName)"
DISTRIBUTION_ID="$(stack_output DistributionId)"
CLOUDFRONT_URL="$(stack_output CloudFrontUrl)"
CUSTOM_DOMAIN_URL="$(stack_output CustomDomainUrl)"

if [[ -z "${BUCKET_NAME}" || "${BUCKET_NAME}" == "None" ]]; then
  echo "Could not resolve BucketName from stack ${STACK_NAME}. Run npm run deploy:infra first." >&2
  exit 1
fi
if [[ -z "${DISTRIBUTION_ID}" || "${DISTRIBUTION_ID}" == "None" ]]; then
  echo "Could not resolve DistributionId from stack ${STACK_NAME}. Run npm run deploy:infra first." >&2
  exit 1
fi

echo "Uploading dist/client to s3://${BUCKET_NAME}"
aws "${AWS_ARGS[@]}" s3 sync dist/client "s3://${BUCKET_NAME}" --delete

echo "Invalidating CloudFront distribution ${DISTRIBUTION_ID}"
aws "${AWS_ARGS[@]}" cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/*" \
  >/dev/null

if [[ -n "${CUSTOM_DOMAIN_URL}" && "${CUSTOM_DOMAIN_URL}" != "None" ]]; then
  echo "Application deployment complete: ${CUSTOM_DOMAIN_URL}"
else
  echo "Application deployment complete: ${CLOUDFRONT_URL}"
fi
