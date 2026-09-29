import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useObdStore } from '../src/store/useObdStore';
import { useVisiblesSegundoPlano } from '../src/ui/useVisibles';

export default function RootLayout() {
  // Recupera del disco la última prueba de PIDs y las preferencias.
  const hydrate = useObdStore(st => st.hydrate);
  useEffect(() => { void hydrate(); }, []);
  // Con la app en segundo plano no hay ninguna pantalla delante: el muestreo
  // cae al núcleo y deja de pedir lo de la última pantalla que se vio.
  useVisiblesSegundoPlano();

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#08080A' },
          headerTintColor: '#F2F2F5',
          contentStyle: { backgroundColor: '#08080A' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="vehicle-select"
          options={{
            title: 'Seleccionar vehículo',
            presentation: 'modal',
          }}
        />
        
        <Stack.Screen
          name="diagnose"
          options={{
            title: 'Diagnóstico',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="datos"
          options={{
            title: 'Datos del vehículo',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="caja"
          options={{
            title: 'Prueba de la caja',
            presentation: 'modal',
          }}
        />
      </Stack>
    </>
  );
}
