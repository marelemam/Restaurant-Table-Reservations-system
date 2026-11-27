require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const staffRoutes = require("./routes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        service: "staff-operations",
        owner: "Maria"
    });
});

app.use("/api/staff", staffRoutes);

app.use((req, res) => {
    res.status(404).json({
        error: "Route not found"
    });
});

app.use((error, req, res, next) => {
    console.error(
        "Staff service error:",
        error.stack || error
    );

    const response = {
        error: "Internal server error"
    };

    if (process.env.NODE_ENV !== "production") {
        response.details = error.message;
        response.code = error.code || null;
    }

    res.status(500).json(response);
});
const PORT = process.env.PORT || 3002;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Maria staff service running on port ${PORT}`);
    });
}

module.exports = app;
