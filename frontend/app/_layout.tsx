import { Drawer } from "expo-router/drawer";

export default function Layout() {
  return (
    <Drawer>
      <Drawer.Screen name="index" options={{ title: "Inicio" }} />
      <Drawer.Screen name="balances" options={{ title: "Balances" }} />
      <Drawer.Screen name="transacciones" options={{ title: "Transacciones" }} />
      <Drawer.Screen name="historico" options={{ title: "Histórico" }} />
      <Drawer.Screen name="inversiones" options={{ title: "Inversiones" }} />
      <Drawer.Screen name="prediccion" options={{ title: "Predicción" }} />
    </Drawer>
  );
}
