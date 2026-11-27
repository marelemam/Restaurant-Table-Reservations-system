#!/usr/bin/env bash

set -euo pipefail

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
ENDPOINT_URL="${ENDPOINT_URL%/}"

POOL_NAME="restaurant-reservation-users"
CLIENT_NAME="restaurant-web-client"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" ||
      -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    echo "Floci environment is not loaded."
    echo 'Run: eval "$(floci env)"'
    exit 1
fi

echo "Checking Cognito user pool..."

POOL_ID=$(aws \
    --endpoint-url "$ENDPOINT_URL" \
    cognito-idp list-user-pools \
    --max-results 60 \
    --query "UserPools[?Name=='${POOL_NAME}'].Id | [0]" \
    --output text)

if [[ -z "$POOL_ID" || "$POOL_ID" == "None" ]]; then
    POOL_ID=$(aws \
        --endpoint-url "$ENDPOINT_URL" \
        cognito-idp create-user-pool \
        --pool-name "$POOL_NAME" \
        --query "UserPool.Id" \
        --output text)

    echo "Created user pool: $POOL_ID"
else
    echo "Reusing user pool: $POOL_ID"
fi

echo "Checking application client..."

CLIENT_ID=$(aws \
    --endpoint-url "$ENDPOINT_URL" \
    cognito-idp list-user-pool-clients \
    --user-pool-id "$POOL_ID" \
    --max-results 60 \
    --query "UserPoolClients[?ClientName=='${CLIENT_NAME}'].ClientId | [0]" \
    --output text)

if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "None" ]]; then
    CLIENT_ID=$(aws \
        --endpoint-url "$ENDPOINT_URL" \
        cognito-idp create-user-pool-client \
        --user-pool-id "$POOL_ID" \
        --client-name "$CLIENT_NAME" \
        --no-generate-secret \
        --explicit-auth-flows \
            ALLOW_USER_PASSWORD_AUTH \
            ALLOW_REFRESH_TOKEN_AUTH \
        --query "UserPoolClient.ClientId" \
        --output text)

    echo "Created app client: $CLIENT_ID"
else
    echo "Reusing app client: $CLIENT_ID"
fi

create_group() {
    local group_name="$1"
    local precedence="$2"

    if aws \
        --endpoint-url "$ENDPOINT_URL" \
        cognito-idp get-group \
        --user-pool-id "$POOL_ID" \
        --group-name "$group_name" \
        >/dev/null 2>&1; then

        echo "Reusing group: $group_name"
    else
        aws \
            --endpoint-url "$ENDPOINT_URL" \
            cognito-idp create-group \
            --user-pool-id "$POOL_ID" \
            --group-name "$group_name" \
            --precedence "$precedence" \
            >/dev/null

        echo "Created group: $group_name"
    fi
}

create_group "Admin" 1
create_group "Staff" 10
create_group "Customer" 20

echo
echo "Cognito setup completed."
echo "COGNITO_USER_POOL_ID=$POOL_ID"
echo "COGNITO_CLIENT_ID=$CLIENT_ID"
echo "COGNITO_ISSUER=$ENDPOINT_URL/$POOL_ID"
echo "COGNITO_JWKS_URI=$ENDPOINT_URL/$POOL_ID/.well-known/jwks.json"

set -euo pipefail
