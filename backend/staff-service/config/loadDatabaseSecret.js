const {
    SecretsManagerClient,
    GetSecretValueCommand
} = require("@aws-sdk/client-secrets-manager");

let loadingPromise;

function createSecretsClient() {
    const configuration = {
        region:
            process.env.AWS_REGION ||
            process.env.AWS_DEFAULT_REGION ||
            "us-east-1"
    };

    if (process.env.AWS_ENDPOINT_URL) {
        configuration.endpoint = process.env.AWS_ENDPOINT_URL;
    }

    return new SecretsManagerClient(configuration);
}

async function retrieveDatabaseSecret() {
    const secretId = process.env.DATABASE_SECRET_ID;

    if (!secretId) {
        throw new Error("DATABASE_SECRET_ID is not configured");
    }

    const client = createSecretsClient();

    const response = await client.send(
        new GetSecretValueCommand({
            SecretId: secretId
        })
    );

    if (!response.SecretString) {
        throw new Error("Database secret does not contain a SecretString");
    }

    let databaseUrl = response.SecretString;

    try {
        const secretObject = JSON.parse(response.SecretString);
        databaseUrl =
            secretObject.DATABASE_URL ||
            secretObject.databaseUrl;
    } catch {
        // The secret may contain the connection string directly.
    }

    if (
        typeof databaseUrl !== "string" ||
        !databaseUrl.match(/^postgres(ql)?:\/\//)
    ) {
        throw new Error("Database secret does not contain a valid PostgreSQL URL");
    }

    process.env.DATABASE_URL = databaseUrl;
}

async function loadDatabaseSecret() {
    // Local development continues using DATABASE_URL from .env.
    if (process.env.DATABASE_URL) {
        return;
    }

    if (!loadingPromise) {
        loadingPromise = retrieveDatabaseSecret().catch((error) => {
            loadingPromise = undefined;
            throw error;
        });
    }

    await loadingPromise;
}

module.exports = {
    loadDatabaseSecret
};