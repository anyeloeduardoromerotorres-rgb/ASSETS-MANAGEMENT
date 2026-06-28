import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import api from "../constants/api";

function getProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId
  );
}

export async function registerTrendRunnerPushNotifications() {
  if (Platform.OS === "web") return;

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("trend-runner", {
        name: "Trend Runner",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#1b5e20",
      });
    }

    const currentPermissions = await Notifications.getPermissionsAsync();
    let finalStatus = currentPermissions.status;

    if (finalStatus !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (finalStatus !== "granted") return;

    const projectId = getProjectId();
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await api.post("/trend-runner/push-token", {
      token: tokenResult.data,
      platform: Platform.OS,
      deviceName: Constants.deviceName ?? undefined,
    });
  } catch (error) {
    console.warn("No se pudo registrar push token Trend Runner", error);
  }
}
