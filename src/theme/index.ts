export const Colors = {
  background: '#0A0A0A',
  surface: '#141414',
  surfaceElevated: '#1C1C1E',
  border: '#2C2C2E',

  primary: '#2DD4BF',
  primaryDim: 'rgba(45, 212, 191, 0.18)',

  steps: '#34D399',
  heart: '#FF6B6B',
  sleep: '#7C6FF7',
  energy: '#FF9F0A',
  weight: '#5AC8FA',

  success: '#30D158',
  successDim: 'rgba(48, 209, 88, 0.15)',
  warning: '#FF9F0A',
  warningDim: 'rgba(255, 159, 10, 0.15)',
  danger: '#FF453A',
  dangerDim: 'rgba(255, 69, 58, 0.15)',

  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textDim: '#48484A',

  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export const Typography = {
  display: { fontSize: 40, fontWeight: '700' as const, color: Colors.text },
  h1: { fontSize: 32, fontWeight: '700' as const, color: Colors.text },
  h2: { fontSize: 24, fontWeight: '700' as const, color: Colors.text },
  h3: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.text },
  bodySecondary: { fontSize: 15, fontWeight: '400' as const, color: Colors.textSecondary },
  caption: { fontSize: 12, fontWeight: '400' as const, color: Colors.textSecondary },
  label: { fontSize: 13, fontWeight: '500' as const, color: Colors.textSecondary },
} as const;

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const Radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 } as const;

export const MetricColor: Record<string, string> = {
  steps: Colors.steps,
  heart_rate: Colors.heart,
  resting_hr: Colors.heart,
  active_kcal: Colors.energy,
  active_minutes: Colors.primary,
  distance: Colors.steps,
  sleep: Colors.sleep,
  weight: Colors.weight,
  spo2: Colors.weight,
  stress: Colors.energy,
};
