const express = require("express");

const router = express.Router();

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

module.exports = router;