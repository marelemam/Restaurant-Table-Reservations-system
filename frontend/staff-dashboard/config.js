"use strict";

// Public runtime endpoint configuration. Update these values after deployment.
// Do not place passwords, database URLs or access tokens in this file.
window.MARIA_STAFF_CONFIG = {
    apiRoot:
    "http://eb501ebec4.execute-api.localhost.floci.io:4566/api/staff",
healthUrl:
    "http://eb501ebec4.execute-api.localhost.floci.io:4566/api/staff",
    cognitoEndpoint: "http://localhost:4566/",
    cognitoClientId: "e8df8ddf8a1248b0ac6816772e",
    k6StatusUrl: "http://localhost:6565/v1/status"
};
