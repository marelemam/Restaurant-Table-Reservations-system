require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const staffRoutes = require("./routes");

const app = express();

function allowedOrigins() {
    const configuredOrigins = process.env.ALLOWED_ORIGINS ||
        (process.env.NODE_ENV === "production"
            ? ""
            : "http://localhost:5500,http://127.0.0.1:5500,http://localhost:4566");

    return configuredOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}

app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        // Lambda/API clients do not send a browser Origin header.
        if (!origin || allowedOrigins().includes(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"]
}));
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

    res.status(error.statusCode || 500).json(response);
});
const PORT = process.env.PORT || 3002;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Maria staff service running on port ${PORT}`);
    });
}

module.exports = app;
