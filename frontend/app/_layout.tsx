import { Tabs } from "expo-router";

export default function Layout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: "Inicio" }} />
      <Tabs.Screen name="balances" options={{ title: "Balances" }} />
      <Tabs.Screen name="transacciones" options={{ title: "Transacciones" }} />
      <Tabs.Screen name="historico" options={{ title: "Histórico" }} />
      <Tabs.Screen name="inversiones" options={{ title: "Inversiones" }} />
      <Tabs.Screen name="prediccion" options={{ title: "Predicción" }} />
    </Tabs>
  );
}