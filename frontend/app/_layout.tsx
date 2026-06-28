import { Drawer } from "expo-router/drawer";
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { registerTrendRunnerPushNotifications } from "../utils/trendRunnerPush";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function Layout() {
  useEffect(() => {
    registerTrendRunnerPushNotifications();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        screenOptions={{
          headerShown: true,
          drawerType: "front",
          drawerActiveTintColor: "#1b5e20",
          drawerLabelStyle: {
            fontSize: 15,
            fontWeight: "600",
          },
        }}
      >
        <Drawer.Screen
          name="index"
          options={{
            title: "Inicio",
            drawerLabel: "Inicio",
          }}
        />
        <Drawer.Screen
          name="balances"
          options={{
            title: "Balances",
            drawerLabel: "Balances",
          }}
        />
        <Drawer.Screen
          name="transacciones"
          options={{
            title: "Transacciones",
            drawerLabel: "Transacciones",
          }}
        />
        <Drawer.Screen
          name="historico"
          options={{
            title: "Historico",
            drawerLabel: "Historico",
          }}
        />
        <Drawer.Screen
          name="trend-senales"
          options={{
            title: "Trend Runner - Senales",
            drawerLabel: "Trend Senales",
          }}
        />
        <Drawer.Screen
          name="trend-historico"
          options={{
            title: "Trend Runner - Historico",
            drawerLabel: "Trend Historico",
          }}
        />
        <Drawer.Screen
          name="inversiones"
          options={{
            title: "Inversiones",
            drawerLabel: "Inversiones",
          }}
        />
        <Drawer.Screen
          name="prediccion"
          options={{
            title: "Prediccion",
            drawerLabel: "Prediccion",
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}
