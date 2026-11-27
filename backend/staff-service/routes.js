const express = require("express");

const router = express.Router();

const waitlistRoutes = require("./routes/waitlistRoutes");

router.get("/", (req, res) => {
    res.status(200).json({
        service: "staff-operations",
        functions: [
            "daily-service-sheet",
            "attendance",
            "waitlist",
            "seating-and-checkout",
            "analytics-and-activity"
        ]
    });
});

router.use("/waitlist", waitlistRoutes);

module.exports = router;