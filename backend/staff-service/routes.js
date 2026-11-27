const express = require("express");

const router = express.Router();

const attendanceRoutes =
    require("./routes/attendanceRoutes");

    const seatingRoutes = require("./routes/seatingRoutes");

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

router.use("/attendance", attendanceRoutes);

router.use("/seating", seatingRoutes);

module.exports = router;