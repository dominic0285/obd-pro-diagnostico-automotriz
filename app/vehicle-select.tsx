import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ALL_PROFILES } from '../src/profiles';
import { useObdStore } from '../src/store/useObdStore';

export default function VehicleSelectModal() {
  const router = useRouter();
  const { selectedProfile, setProfile } = useObdStore();

  const handleSelect = (id: string) => {
    setProfile(id);
    router.back();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Selecciona tu Vehículo</Text>
      <Text style={styles.subtitle}>
        Configura los comandos de red CAN, modos UDS y diagnósticos específicos de cada marca.
      </Text>

      <FlatList
        data={ALL_PROFILES}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isSelected = selectedProfile.id === item.id;
          return (
            <TouchableOpacity
              style={[styles.itemCard, isSelected && styles.itemCardSelected]}
              onPress={() => handleSelect(item.id)}
            >
              <View style={styles.cardHeader}>
                <Ionicons
                  name={item.hasEnhanced ? 'car-sport' : 'speedometer'}
                  size={24}
                  color={isSelected ? '#2C74D6' : '#93939E'}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.itemMake, isSelected && { color: '#2C74D6' }]}>
                    {item.make} {item.model}
                  </Text>
                  <Text style={styles.itemYear}>
                    {item.year} · {item.engine}
                  </Text>
                </View>
                {isSelected && <Ionicons name="checkmark-circle" size={24} color="#2C74D6" />}
              </View>

              <Text style={styles.itemDesc}>{item.description}</Text>

              {item.hasEnhanced && (
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: '#2C74D622' }]}>
                    <Text style={[styles.badgeText, { color: '#2C74D6' }]}>MODO 22 UDS</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: '#7A6BD022' }]}>
                    <Text style={[styles.badgeText, { color: '#7A6BD0' }]}>HS-CAN 500K</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: '#C25A1222' }]}>
                    <Text style={[styles.badgeText, { color: '#C25A12' }]}>8 CILINDROS</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08080A', padding: 20 },
  title: { color: '#F2F2F5', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#56565F', fontSize: 13, marginTop: 4, marginBottom: 20 },
  itemCard: {
    backgroundColor: '#131317',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#131317',
  },
  itemCardSelected: {
    borderColor: '#2C74D6',
    backgroundColor: '#131317',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  itemMake: { color: '#F2F2F5', fontSize: 16, fontWeight: '700' },
  itemYear: { color: '#56565F', fontSize: 12, marginTop: 2 },
  itemDesc: { color: '#93939E', fontSize: 12, marginTop: 10, lineHeight: 16 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800' },
});
