import { Tabs, useRouter } from 'expo-router';
import { TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useObdStore } from '../../src/store/useObdStore';

export default function TabLayout() {
  const router = useRouter();
  const connectionState = useObdStore(s => s.connectionState);
  const selectedProfile = useObdStore(s => s.selectedProfile);
  const isConnected = connectionState === 'connected';

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#08080A',
          borderTopColor: '#131317',
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: '#2C74D6',
        tabBarInactiveTintColor: '#56565F',
        headerStyle: { backgroundColor: '#08080A' },
        headerTintColor: '#F2F2F5',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Panel',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="speedometer" size={size} color={color} />
          ),
          headerTitle: `OBD Pro ${isConnected ? '●' : '○'}`,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/vehicle-select')}
              style={{
                marginRight: 16,
                backgroundColor: '#131317',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#26262E'
              }}
            >
              <Text style={{ color: '#2C74D6', fontSize: 11, fontWeight: '700' }}>
                {selectedProfile.make} ▾
              </Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="cylinders"
        options={{
          title: 'Cilindros',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="hardware-chip" size={size} color={color} />
          ),
          headerTitle: 'Cilindros (Ford Modo 22)',
        }}
      />
      <Tabs.Screen
        name="stream"
        options={{
          title: 'En Vivo',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pulse" size={size} color={color} />
          ),
          headerTitle: 'Flujo de Sensores',
        }}
      />
      <Tabs.Screen
        name="dtc"
        options={{
          title: 'Códigos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="warning" size={size} color={color} />
          ),
          headerTitle: 'Códigos de Falla',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
          headerTitle: 'Configuración y Terminal',
        }}
      />
    </Tabs>
  );
}
