#!/usr/bin/env bash
set -euo pipefail

soya_project_id="soya-e12cd"
soya_project_number="641439217344"
soya_repository="onesoya/SOYA"
soya_pool_id="github-actions"
soya_provider_id="onesoya-soya"
soya_service_account_id="github-actions-firebase"
soya_service_account_email="${soya_service_account_id}@${soya_project_id}.iam.gserviceaccount.com"
soya_workflow_ref="${soya_repository}/.github/workflows/deploy-firebase-functions.yml@refs/heads/main"

gcloud config set project "${soya_project_id}"
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com

if ! gcloud iam service-accounts describe "${soya_service_account_email}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${soya_service_account_id}" \
    --display-name="GitHub Actions Firebase deployer"
fi

for soya_role in \
  roles/cloudfunctions.admin \
  roles/serviceusage.serviceUsageConsumer \
  roles/firebase.viewer
do
  gcloud projects add-iam-policy-binding "${soya_project_id}" \
    --member="serviceAccount:${soya_service_account_email}" \
    --role="${soya_role}" \
    --condition=None >/dev/null
done

for soya_runtime_service_account in \
  "${soya_project_number}-compute@developer.gserviceaccount.com" \
  "${soya_project_id}@appspot.gserviceaccount.com"
do
  if gcloud iam service-accounts describe "${soya_runtime_service_account}" >/dev/null 2>&1; then
    gcloud iam service-accounts add-iam-policy-binding "${soya_runtime_service_account}" \
      --project="${soya_project_id}" \
      --member="serviceAccount:${soya_service_account_email}" \
      --role="roles/iam.serviceAccountUser" >/dev/null
  fi
done

if ! gcloud iam workload-identity-pools describe "${soya_pool_id}" \
  --project="${soya_project_id}" \
  --location="global" >/dev/null 2>&1
then
  gcloud iam workload-identity-pools create "${soya_pool_id}" \
    --project="${soya_project_id}" \
    --location="global" \
    --display-name="GitHub Actions"
fi

if ! gcloud iam workload-identity-pools providers describe "${soya_provider_id}" \
  --project="${soya_project_id}" \
  --location="global" \
  --workload-identity-pool="${soya_pool_id}" >/dev/null 2>&1
then
  gcloud iam workload-identity-pools providers create-oidc "${soya_provider_id}" \
    --project="${soya_project_id}" \
    --location="global" \
    --workload-identity-pool="${soya_pool_id}" \
    --display-name="onesoya/SOYA main" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.workflow=assertion.job_workflow_ref" \
    --attribute-condition="assertion.repository=='${soya_repository}' && assertion.ref=='refs/heads/main' && assertion.job_workflow_ref=='${soya_workflow_ref}'"
fi

gcloud iam service-accounts add-iam-policy-binding "${soya_service_account_email}" \
  --project="${soya_project_id}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${soya_project_number}/locations/global/workloadIdentityPools/${soya_pool_id}/attribute.repository/${soya_repository}" >/dev/null

echo "GitHub Actions can now deploy Firebase Functions from ${soya_repository} main."
