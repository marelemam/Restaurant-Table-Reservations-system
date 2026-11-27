const express = require("express");

const router = express.Router();

const attendanceRoutes =
    require("./routes/attendanceRoutes");

    const seatingRoutes = require("./routes/seatingRoutes");

const waitlistRoutes = require("./routes/waitlistRoutes");

const activityRoutes = require("./routes/activityRoutes");


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


router.use("/activity", activityRoutes);
module.exports = router;