"use strict";

// Public settings only. Never put passwords, database URLs or API keys here.
window.CUSTOMER_APP_CONFIG = {
    // Where the reservation service lives.
    // Local:  "http://localhost:3001"
    // Floci:  "http://reservation-api.execute-api.localhost.floci.io:4566"
    apiRoot: "http://localhost:3001",

    // Cognito login (same as the staff dashboard). Leave empty until Cognito is set up.
    cognitoEndpoint: "",
    cognitoClientId: "",

    // LOCAL TESTING ONLY: sign in with a customer number instead of Cognito.
    // The backend only accepts this when ALLOW_FAKE_AUTH=true, which is never set on Lambda.
    testMode: true,

    // Must match the backend rule in validation.js
    maxDaysAhead: 30
};
