const express = require("express");
const cors = require("cors");
const serverless = require("serverless-http");
const helmet = require("helmet");
require("dotenv").config();

const tableRoutes = require("./routes");

const app = express();

const allowed = (
    process.env.CORS_ORIGINS ||
    "http://localhost:5500,http://127.0.0.1:5500"
).split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
    origin(origin, callback) {
        callback(null, !origin || allowed.includes(origin));
    }
}));
app.use(helmet());
app.use(express.json());

app.get("/api/tables/health", (req, res) => {
    const runtime = process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda" : "pc";
    res.status(200).json({ status: "ok", service: "table-service", runtime });
});

app.use("/api/tables", tableRoutes);

const PORT = process.env.PORT || 3003;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Table Service running on port ${PORT}`);
    });
}

module.exports = app;
module.exports.handler = serverless(app);
