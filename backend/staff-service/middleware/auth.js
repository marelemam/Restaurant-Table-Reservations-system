function requireStaffOrAdmin(req, res, next) {
    const developmentBypass =
        process.env.NODE_ENV !== "production" &&
        process.env.DEV_AUTH_BYPASS === "true";

    if (developmentBypass) {
        req.user = {
            sub: "local-development-staff",
            groups: ["Staff"]
        };

        return next();
    }

    if (!req.user) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    const allowedGroups = ["Staff", "Admin"];
    const userGroups = req.user.groups || [];

    const isAllowed = userGroups.some((group) =>
        allowedGroups.includes(group)
    );

    if (!isAllowed) {
        return res.status(403).json({
            error: "Staff or Admin permission required"
        });
    }

    next();
}

module.exports = {
    requireStaffOrAdmin
};