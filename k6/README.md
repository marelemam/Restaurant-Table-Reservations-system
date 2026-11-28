# Maria Staff Operations load-test preparation

Run load tests only after the target environment, database, authentication and
monitoring are stable. The script contains no passwords or tokens.

## Local development-bypass test

Start Staff Operations with `DEV_AUTH_BYPASS=true`, then run from the repository
root in Git Bash:

```bash
k6 run --address=localhost:6565 -e TARGET_VUS=200 \
  --summary-export=k6/staff-200-summary.json \
  k6/staff-concurrency-test.js
```

The dashboard reads `http://localhost:6565/v1/status` and displays the active
VUs while this command is running.

## Authenticated integration/cloud test

Use a temporary Staff access token without saving it in Git:

```bash
read -s ACCESS_TOKEN
export ACCESS_TOKEN
k6 run --address=localhost:6565 \
  -e TARGET_VUS=200 \
  -e BASE_URL=http://YOUR_API_GATEWAY_HOST \
  -e ACCESS_TOKEN="$ACCESS_TOKEN" \
  --summary-export=k6/staff-200-cloud-summary.json \
  k6/staff-concurrency-test.js
unset ACCESS_TOKEN
```

Repeat with `TARGET_VUS=1000` only as a stress/capacity test. Do not describe a
test as passed when a threshold fails. The script completes the test instead of
using `abortOnFail`, which gives reproducible final capacity evidence.

The old `staff-1000-result.txt` contains script exceptions and is preliminary
diagnostic evidence, not a clean final result.
