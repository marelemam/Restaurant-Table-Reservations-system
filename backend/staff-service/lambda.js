const serverless = require("serverless-http");
const app = require("./app");
const {
    loadDatabaseSecret
} = require("./config/loadDatabaseSecret");

const proxyHandler = serverless(app);

module.exports.handler = async (event, context) => {
    await loadDatabaseSecret();
    return proxyHandler(event, context);
};