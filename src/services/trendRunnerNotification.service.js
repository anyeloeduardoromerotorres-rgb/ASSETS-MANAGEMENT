import axios from "axios";
import TrendRunnerPushToken from "../models/trendRunnerPushToken.model.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(token) {
  return (
    typeof token === "string"
    && (
      token.startsWith("ExponentPushToken[")
      || token.startsWith("ExpoPushToken[")
    )
  );
}

export async function saveTrendRunnerPushToken({
  token,
  platform,
  deviceName,
}) {
  if (!isExpoPushToken(token)) {
    throw new Error("Token push de Expo invalido");
  }

  return TrendRunnerPushToken.findOneAndUpdate(
    { token },
    {
      token,
      platform,
      deviceName,
      active: true,
      lastSeenAt: new Date(),
      lastError: null,
    },
    { upsert: true, new: true }
  );
}

export async function sendTrendRunnerPush({ title, body, data = {} }) {
  const tokens = await TrendRunnerPushToken.find({ active: true });
  const validTokens = tokens.filter((item) => isExpoPushToken(item.token));

  if (!validTokens.length) {
    return { sent: 0, skipped: "no_push_tokens" };
  }

  const messages = validTokens.map((item) => ({
    to: item.token,
    sound: "default",
    title,
    body,
    data,
  }));

  try {
    const response = await axios.post(EXPO_PUSH_URL, messages, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    return {
      sent: messages.length,
      response: response.data,
    };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.message ?? error.message;
    await TrendRunnerPushToken.updateMany(
      { token: { $in: validTokens.map((item) => item.token) } },
      { lastError: message }
    );
    throw error;
  }
}
