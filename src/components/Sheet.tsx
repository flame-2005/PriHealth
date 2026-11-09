import React from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Sheet({ visible, title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      {/*
        box-none: this view covers the whole screen, so without it taps above the sheet never reach
        the backdrop. Padding on Android too: edge-to-edge windows (Android 15+) are not resized for
        the keyboard, and where the window does resize the padding works out to zero.
      */}
      <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.kav}>
        <View style={[styles.sheet, { paddingBottom: Spacing.xl + insets.bottom }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={Typography.h3}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <X color={Colors.textSecondary} size={22} />
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
});
