/**
 * Agent 头像组件
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  avatar: string;
  size?: 'small' | 'medium' | 'large';
  showBorder?: boolean;
}

const SIZES = {
  small: { container: 32, font: 18 },
  medium: { container: 48, font: 28 },
  large: { container: 64, font: 40 },
};

export default function AgentAvatar({
  avatar,
  size = 'medium',
  showBorder = false,
}: Props) {
  const dimensions = SIZES[size];

  return (
    <View
      style={[
        styles.container,
        {
          width: dimensions.container,
          height: dimensions.container,
          borderRadius: dimensions.container / 2,
        },
        showBorder && styles.border,
      ]}
    >
      <Text style={[styles.avatar, { fontSize: dimensions.font }]}>
        {avatar || '🤖'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  border: {
    borderWidth: 2,
    borderColor: '#4f46e5',
  },
  avatar: {
    textAlign: 'center',
  },
});
