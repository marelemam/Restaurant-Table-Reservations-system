const express = require("express");
const cors = require("cors");
const serverless = require("serverless-http");
require("dotenv").config();

const tableRoutes = require("./routes");

const app = express();

const allowed = (process.env.CORS_ORIGINS || "").split(",").filter(Boolean);
app.use(cors({ origin: allowed }));
app.use(express.json());

app.get("/api/tables/health", (req, res) => {
    const runtime = process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda" : "pc";
    res.status(200).json({ status: "ok", service: "table-service", runtime });
});

app.use("/api/tables", tableRoutes);

const PORT = process.env.PORT || 3002;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Table Service running on port ${PORT}`);
    });
}

module.exports = app;
module.exports.handler = serverless(app);
