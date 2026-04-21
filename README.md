# Bedrock Models by Region

A local, dependency-light viewer that answers *"what models can I call from this AWS region?"* — the answer the AWS Bedrock docs spread across four pages.

Pick a region → see three lists:

1. **On-Demand** — models invokable directly against that region's endpoint.
2. **Regional (Geo)** — cross-region inference profiles scoped to a geography (`us.*`, `eu.*`, `apac.*`, `au.*`, `ca.*`, `jp.*`, `us-gov.*`).
3. **Global** — `global.*` profiles that can route anywhere.

Data is a live snapshot of `ListFoundationModels` + `ListInferenceProfiles`. Refreshed nightly.

Hosted at **https://awshostedmodels.sjramblings.io**.

## Run locally

```bash
bun install
export AWS_PROFILE=test1
aws sso login --profile test1
bun run fetch       # -> public/data.json
bun run serve       # -> http://localhost:8080
```

## Architecture

```
bedrock-region-viewer/
├── infra/
│   └── github-oidc-role.yaml     # OIDC role + Amplify app + domain
├── .github/workflows/
│   ├── refresh-data.yml          # nightly: fetch -> PR -> auto-merge
│   └── deploy-amplify.yml        # on push to main: upload zip -> Amplify
├── scripts/fetch-data.ts         # AWS SDK -> public/data.json
├── public/                       # static site
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data.json                 # committed, refreshed nightly
└── package.json
```

## One-time deployment setup

Everything below runs against the AWS account behind the `test1` profile in `~/.aws/config`.

### 1. Deploy the CloudFormation stack

```bash
aws sso login --profile test1
aws cloudformation deploy \
  --profile test1 \
  --region us-east-1 \
  --stack-name bedrock-region-viewer \
  --template-file infra/github-oidc-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides OIDCProviderExists=true
```

If the account does NOT yet have the GitHub OIDC provider, pass `OIDCProviderExists=false`. The VCS stack already provisioned one, so the default (`true`) is correct for this account.

Grab the outputs:

```bash
aws cloudformation describe-stacks \
  --profile test1 \
  --region us-east-1 \
  --stack-name bedrock-region-viewer \
  --query 'Stacks[0].Outputs'
```

Note the `RoleArn`, `AmplifyAppId`, `AmplifyDefaultDomain`, and `AmplifyRegion`.

### 2. Configure GitHub repo secrets

In `sjramblings/bedrock-region-viewer` → Settings → Secrets and variables → Actions → **Secrets** → New repository secret:

| Name             | Value                                              |
|------------------|----------------------------------------------------|
| `AWS_ROLE_ARN`   | stack output `RoleArn`                             |
| `AWS_REGION`     | stack output `AmplifyRegion` (e.g. `us-east-1`)    |
| `AMPLIFY_APP_ID` | stack output `AmplifyAppId`                        |

Stored as secrets so their values never surface in workflow logs, even though the repo is public. OIDC handles authentication — no long-lived credentials are stored.

### 3. Enable auto-merge on the repo

Settings → General → Pull Requests → **Allow auto-merge** ✅

Optional but recommended: branch protection on `main` requiring PRs (so the nightly bot can't push directly).

### 4. Add DNS in the other account

The `sjramblings.io` hosted zone lives in a different AWS account. Retrieve the verification + subdomain CNAMEs Amplify needs:

```bash
aws amplify get-domain-association \
  --profile test1 \
  --region us-east-1 \
  --app-id <AmplifyAppId> \
  --domain-name awshostedmodels.sjramblings.io
```

You'll see two types of records:

- **`certificateVerificationDNSRecord`** — one CNAME used by ACM to issue the cert.
- **`subDomainSettings[*].dnsRecord`** — one CNAME (`awshostedmodels`) pointing at the Amplify domain target.

Add both in the Route53 account that owns `sjramblings.io`. After DNS propagates, `domainStatus` moves from `PENDING_VERIFICATION` → `AVAILABLE` (usually 5-30 min for verification, up to 24h for ACM).

### 5. Trigger the first deploy

```bash
gh workflow run deploy-amplify.yml
# or: push any change touching public/
```

## Nightly data refresh

`refresh-data.yml` runs at **14:00 UTC** (≈ midnight AEST / 01:00 AEDT). It:

1. Assumes `AWS_ROLE_ARN` via OIDC.
2. Runs `bun run fetch` → writes new `public/data.json`.
3. If the file changed: commits **only `public/data.json`** to `data/nightly-<date>` and opens a PR with auto-merge (squash) enabled.
4. On merge, `deploy-amplify.yml` fires and redeploys the static bundle.

If no diff, the workflow is a no-op. No PRs when the catalog is unchanged.

Why a PR instead of direct push: repo policy is **no direct pushes to `main`**. The workflow stages only `public/data.json`, so the PR diff is mechanically guaranteed to be data-only.

## Regenerating data locally

Identical to CI — one command:

```bash
bun run fetch
```

Needs `bedrock:ListFoundationModels` + `bedrock:ListInferenceProfiles` and any AWS credential chain.

## Why this tool exists

The AWS docs split model availability across:

- `foundation-models-reference.html` (overview)
- `models-regions.html` (per-region matrix)
- `inference-profiles-support.html` (cross-region profile tables)
- `model-availability-compatibility.html` (compatibility grid)

Answering "can I call Claude Sonnet 4.6 from ap-southeast-2?" today means cross-referencing all four. This tool collapses that into one dropdown.
