const fs = require("fs/promises");
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../.env")
});

const { query, closePool } = require("../db");

async function executeSqlFile(filename) {
    const filePath = path.resolve(
        __dirname,
        "../../../database",
        filename
    );

    const sql = await fs.readFile(filePath, "utf8");

    console.log(`Executing ${filename}...`);
    await query(sql);
    console.log(`${filename} completed successfully.`);
}

async function setupDatabase() {
    try {
        await executeSqlFile("schema.sql");

        if (process.argv.includes("--seed")) {
            await executeSqlFile("seed.sql");
        }

        console.log("Database setup completed.");
    } catch (error) {
        console.error("Database setup failed:", error.message);
        process.exitCode = 1;
    } finally {
        await closePool();
    }
}

setupDatabase();