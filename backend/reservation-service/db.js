const { Pool, types } = require('pg');
const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');

types.setTypeParser(1082, (value) => value);

let pool;
let secretPromise;

async function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!process.env.DATABASE_SECRET_ID) {
    throw new Error('DATABASE_URL or DATABASE_SECRET_ID is required');
  }
  if (!secretPromise) {
    secretPromise = (async () => {
      const config = { region: process.env.AWS_REGION || 'us-east-1' };
      if (process.env.AWS_ENDPOINT_URL) {
        config.endpoint = process.env.AWS_ENDPOINT_URL;
        config.credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
      }
      const client = new SecretsManagerClient(config);
      const response = await client.send(new GetSecretValueCommand({
        SecretId: process.env.DATABASE_SECRET_ID
      }));
      const secret = JSON.parse(response.SecretString || '{}');
      const value = secret.DATABASE_URL || secret.databaseUrl;
      if (!value) throw new Error('Database secret does not contain DATABASE_URL');
      process.env.DATABASE_URL = value;
      return value;
    })();
  }
  return secretPromise;
}

async function getPool() {
  if (!pool) {
    const connectionString = await ensureDatabaseUrl();
    pool = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX || 5)
    });
  }
  return pool;
}

module.exports = {
  async query(...args) {
    return (await getPool()).query(...args);
  },
  getPool
};
