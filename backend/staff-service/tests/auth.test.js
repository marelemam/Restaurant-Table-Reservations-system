const mockVerify = jest.fn();

jest.mock("aws-jwt-verify", () => ({
    CognitoJwtVerifier: {
        create: jest.fn(() => ({
            verify: mockVerify
        }))
    }
}));

const {
    requireStaffOrAdmin,
    requireAdmin
} = require("../middleware/auth");

function createResponse() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
    };
}

describe("Cognito authentication and authorization", () => {
    let req;
    let res;
    let next;
    let warningSpy;
    let errorSpy;

    beforeEach(() => {
        jest.clearAllMocks();

        process.env.NODE_ENV = "test";
        process.env.DEV_AUTH_BYPASS = "false";
        process.env.DEV_AUTH_GROUP = "Staff";
        process.env.COGNITO_USER_POOL_ID =
            "us-east-1_TestPool";
        process.env.COGNITO_CLIENT_ID =
            "test-client-id";

        req = {
            get: jest.fn()
        };

        res = createResponse();
        next = jest.fn();

        warningSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});

        errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
    });

    afterEach(() => {
        warningSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test("development bypass creates a Staff user", async () => {
        process.env.DEV_AUTH_BYPASS = "true";

        await requireStaffOrAdmin(req, res, next);

        expect(req.user).toEqual({
            sub: "local-development-staff",
            groups: ["Staff"]
        });

        expect(mockVerify).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    test("missing Authorization header returns 401", async () => {
        req.get.mockReturnValue(null);

        await requireStaffOrAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);

        expect(res.json).toHaveBeenCalledWith({
            error: "Authentication required"
        });

        expect(next).not.toHaveBeenCalled();
    });

    test("missing Cognito configuration returns 503", async () => {
        delete process.env.COGNITO_USER_POOL_ID;
        delete process.env.COGNITO_CLIENT_ID;

        req.get.mockReturnValue(
            "Bearer valid-looking-token"
        );

        await requireStaffOrAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(503);

        expect(res.json).toHaveBeenCalledWith({
            error:
                 "Authentication service is unavailable"
        });

        expect(next).not.toHaveBeenCalled();
    });

    test("invalid Cognito token returns 401", async () => {
        req.get.mockReturnValue(
            "Bearer invalid-token"
        );

        mockVerify.mockRejectedValueOnce(
            new Error("Invalid token")
        );

        await requireStaffOrAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);

        expect(res.json).toHaveBeenCalledWith({
            error: "Invalid or expired access token"
        });

        expect(next).not.toHaveBeenCalled();
    });

    test("valid Staff token is accepted", async () => {
        req.get.mockReturnValue(
            "Bearer valid-staff-token"
        );

        mockVerify.mockResolvedValueOnce({
            sub: "cognito-staff-001",
            username: "staff@example.com",
            "cognito:groups": ["Staff"],
            scope: "openid"
        });

        await requireStaffOrAdmin(req, res, next);

        expect(req.user.sub)
            .toBe("cognito-staff-001");

        expect(req.user.groups)
            .toEqual(["Staff"]);

        expect(next).toHaveBeenCalled();
    });

    test("Customer token is rejected from staff routes", async () => {
        req.get.mockReturnValue(
            "Bearer valid-customer-token"
        );

        mockVerify.mockResolvedValueOnce({
            sub: "cognito-customer-001",
            "cognito:groups": ["Customer"]
        });

        await requireStaffOrAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);

        expect(res.json).toHaveBeenCalledWith({
            error:
                "Staff or Admin permission required"
        });

        expect(next).not.toHaveBeenCalled();
    });

    test("Admin token is accepted by Admin middleware", async () => {
        req.get.mockReturnValue(
            "Bearer valid-admin-token"
        );

        mockVerify.mockResolvedValueOnce({
            sub: "cognito-admin-001",
            "cognito:groups": ["Admin"]
        });

        await requireAdmin(req, res, next);

        expect(req.user.groups)
            .toEqual(["Admin"]);

        expect(next).toHaveBeenCalled();
    });

    test("Staff token is rejected by Admin middleware", async () => {
        req.get.mockReturnValue(
            "Bearer valid-staff-token"
        );

        mockVerify.mockResolvedValueOnce({
            sub: "cognito-staff-001",
            "cognito:groups": ["Staff"]
        });

        await requireAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);

        expect(res.json).toHaveBeenCalledWith({
            error: "Admin permission required"
        });

        expect(next).not.toHaveBeenCalled();
    });
});