const crypto = require("crypto");
const {
    SNSClient,
    PublishCommand
} = require("@aws-sdk/client-sns");

let snsClient;

function getSnsClient() {
    if (!snsClient) {
        const configuration = {
            region:
                process.env.AWS_REGION ||
                process.env.AWS_DEFAULT_REGION ||
                "us-east-1"
        };

        if (process.env.AWS_ENDPOINT_URL) {
            configuration.endpoint = process.env.AWS_ENDPOINT_URL;

            configuration.credentials = {
                accessKeyId:
                    process.env.AWS_ACCESS_KEY_ID || "test",
                secretAccessKey:
                    process.env.AWS_SECRET_ACCESS_KEY || "test"
            };
        }

        snsClient = new SNSClient(configuration);
    }

    return snsClient;
}

async function publishNotification(
    notificationType,
    payload = {}
) {
    if (process.env.NODE_ENV === "test") {
        return {
            published: false,
            skipped: true
        };
    }

    const topicArn = process.env.WAITLIST_NOTIFICATION_TOPIC_ARN;

    if (!topicArn) {
        console.warn(
            `SNS notification skipped because the topic is not configured: ${notificationType}`
        );

        return {
            published: false,
            skipped: true
        };
    }

    const notification = {
        notificationId: crypto.randomUUID(),
        notificationType,
        source: "staff-service",
        createdAt: new Date().toISOString(),
        payload
    };

    try {
        const result = await getSnsClient().send(
            new PublishCommand({
                TopicArn: topicArn,
                Subject: "Restaurant waitlist notification",
                Message: JSON.stringify(notification),
                MessageAttributes: {
                    notificationType: {
                        DataType: "String",
                        StringValue: notificationType
                    }
                }
            })
        );

        console.log(
            `SNS notification published: ${notificationType} (${result.MessageId})`
        );

        return {
            published: true,
            messageId: result.MessageId,
            notification
        };
    } catch (error) {
        console.error(
            `SNS notification publishing failed for ${notificationType}:`,
            error.message
        );

        return {
            published: false,
            error: error.message
        };
    }
}

module.exports = {
    publishNotification
};