const { Pool } = require("pg");

let pool;

function getPool() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not configured");
    }

    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: Number(process.env.DB_POOL_MAX || 5),
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 10000,
            application_name: "maria-staff-operations"
        });

        pool.on("error", (error) => {
            console.error("Unexpected PostgreSQL pool error:", error.message);
        });
    }

    return pool;
}

async function query(text, parameters = []) {
    return getPool().query(text, parameters);
}

async function closePool() {
    if (pool) {
        await pool.end();
        pool = undefined;
    }
}

module.exports = {
    getPool,
    query,
    closePool
};