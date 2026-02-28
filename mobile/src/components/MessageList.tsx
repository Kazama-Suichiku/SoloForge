/**
 * 消息列表组件
 */

import React from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Message } from '../types';

interface Props {
  messages: Message[];
  streamingContent?: string;
  agentName?: string;
  isLoading?: boolean;
}

export default function MessageList({
  messages,
  streamingContent,
  agentName,
  isLoading,
}: Props) {
  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View
        style={[
          styles.messageContainer,
          isUser ? styles.userMessage : styles.assistantMessage,
        ]}
      >
        {!isUser && (
          <Text style={styles.messageSender}>{item.agentName || agentName}</Text>
        )}
        <Text style={styles.messageText}>{item.content}</Text>
      </View>
    );
  };

  const renderStreamingMessage = () => {
    if (!streamingContent) return null;
    return (
      <View style={[styles.messageContainer, styles.assistantMessage]}>
        <Text style={styles.messageSender}>{agentName}</Text>
        <Text style={styles.messageText}>{streamingContent}</Text>
        {isLoading && (
          <ActivityIndicator size="small" color="#4f46e5" style={styles.typing} />
        )}
      </View>
    );
  };

  return (
    <FlatList
      data={messages}
      renderItem={renderMessage}
      keyExtractor={(_, index) => index.toString()}
      contentContainerStyle={styles.list}
      ListFooterComponent={renderStreamingMessage}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    flexGrow: 1,
  },
  messageContainer: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 12,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#4f46e5',
    borderBottomRightRadius: 4,
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a2e',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  messageSender: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 16,
    color: '#fff',
    lineHeight: 22,
  },
  typing: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
});
