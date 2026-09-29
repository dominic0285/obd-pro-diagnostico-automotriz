import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={60} color={C.card} />
      <Text style={s.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={s.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

export function Button({ label, icon, onPress, variant = 'primary', disabled, loading, style }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void;
  variant?: 'primary' | 'danger' | 'ghost'; disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = variant === 'primary' ? C.cyan : variant === 'danger' ? 'transparent' : C.card;
  const fg = variant === 'primary' ? C.bg : variant === 'danger' ? C.red : C.text;
  return (
    <TouchableOpacity
      onPress={onPress} disabled={disabled || loading}
      style={[s.btn, { backgroundColor: bg, borderColor: variant === 'danger' ? C.red : bg },
              (disabled || loading) && { opacity: 0.45 }, style]}>
      {loading ? <ActivityIndicator size="small" color={fg} />
               : icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[s.badge, { backgroundColor: color + '22' }]}>
      <Text style={[s.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      {typeof value === 'string'
        ? <Text style={[s.rowValue, mono && { fontFamily: 'monospace', fontSize: 11 }]}>{value}</Text>
        : value}
    </View>
  );
}

/** Barra horizontal simple con valor */
export function Gauge({ label, value, unit, min, max, color = C.cyan, hint }: {
  label: string; value: number | null | undefined; unit: string; min: number; max: number; color?: string; hint?: string;
}) {
  const v = value ?? null;
  const pct = v !== null ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0;
  return (
    <View style={s.gauge}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={s.gaugeLabel}>{label}</Text>
        {hint ? <Text style={s.gaugeHint}>{hint}</Text> : null}
      </View>
      <View style={s.gaugeBar}><View style={[s.gaugeFill, { width: `${pct}%` as any, backgroundColor: color }]} /></View>
      <Text style={[s.gaugeValue, { color: v !== null ? color : C.muted }]}>
        {v !== null ? `${Math.abs(v) < 100 ? v.toFixed(1) : Math.round(v)} ${unit}` : '—'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  sectionTitle: { color: C.sub, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptySub: { color: C.muted, fontSize: 13, marginTop: 8, textAlign: 'center', maxWidth: 280 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
         paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  btnText: { fontWeight: '700', fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
         paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bg },
  rowLabel: { color: C.muted, fontSize: 13 },
  rowValue: { color: C.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  gauge: { marginBottom: 12 },
  gaugeLabel: { color: C.sub, fontSize: 12, marginBottom: 4 },
  gaugeHint: { color: C.muted, fontSize: 10 },
  gaugeBar: { height: 6, backgroundColor: C.bg, borderRadius: 3, overflow: 'hidden' },
  gaugeFill: { height: '100%', borderRadius: 3 },
  gaugeValue: { fontSize: 15, fontWeight: '700', marginTop: 4 },
});
