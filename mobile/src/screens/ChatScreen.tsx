/**
 * 聊天页面 - 微信风格
 * 使用 inverted FlatList，最新消息在底部，上拉加载历史
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
  ActionSheetIOS,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { chatManager, ChatMessage } from '../core/chat';
import { llm } from '../core/llm';
import { storage } from '../core/storage';
import { Agent } from '../core/config/agents';
import { cloudSync } from '../core/sync/cloudSync';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const PAGE_SIZE = 20;

interface AvatarPreview {
  avatar: string;
  name: string;
  title: string;
}

export default function ChatScreen({ route, navigation }: Props) {
  const { agentId, agentName, conversationId: initialConvId, initialMessage } = route.params;
  const [conversationId, setConversationId] = useState<string>(initialConvId || '');
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [displayMessages, setDisplayMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string>('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [bossConfig, setBossConfig] = useState<any>({ name: '老板', avatar: '👑' });
  const [avatarPreview, setAvatarPreview] = useState<AvatarPreview | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const initialMessageSent = useRef(false);

  useEffect(() => {
    initChat();
  }, []);

  useEffect(() => {
    if (!initialLoading && initialMessage && !initialMessageSent.current && conversationId) {
      initialMessageSent.current = true;
      setInputText(initialMessage);
      setTimeout(() => {
        sendMessageWithText(initialMessage);
      }, 300);
    }
  }, [initialLoading, initialMessage, conversationId]);

  const initChat = async () => {
    try {
      await chatManager.initialize();
      
      const agents = await storage.getAgents();
      const agent = agents.find((a: Agent) => a.id === agentId);
      if (agent) {
        setCurrentAgent(agent);
      }

      const boss = await storage.getBossConfig();
      if (boss) {
        setBossConfig(boss);
      }
      
      const apiKey = llm.getApiKey();
      if (!apiKey) {
        Alert.alert(
          'API Key 未设置',
          '请在设置中配置 DeepSeek API Key',
          [
            { text: '去设置', onPress: () => navigation.goBack() },
            { text: '取消', style: 'cancel', onPress: () => navigation.goBack() },
          ]
        );
        return;
      }

      const conv = await chatManager.getOrCreateConversation(agentId);
      setConversationId(conv.id);

      const history = await chatManager.getMessages(conv.id);
      const validMessages = history.filter(m => m.role !== 'tool' && m.role !== 'system');
      setAllMessages(validMessages);
      
      // 微信风格：显示最新的 PAGE_SIZE 条，倒序存储（最新在前）
      const latest = validMessages.slice(-PAGE_SIZE).reverse();
      setDisplayMessages(latest);
      setHasMoreHistory(validMessages.length > PAGE_SIZE);
    } catch (error) {
      console.error('Init chat error:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  // 上拉加载更多历史（在 inverted 列表中实际是往上滚动）
  const loadMoreHistory = useCallback(() => {
    if (isLoadingMore || !hasMoreHistory) return;
    
    setIsLoadingMore(true);
    
    setTimeout(() => {
      const currentCount = displayMessages.length;
      const totalCount = allMessages.length;
      const loadedCount = currentCount;
      const remainingCount = totalCount - loadedCount;
      
      if (remainingCount > 0) {
        const endIndex = totalCount - loadedCount;
        const startIndex = Math.max(0, endIndex - PAGE_SIZE);
        const moreMessages = allMessages.slice(startIndex, endIndex).reverse();
        
        setDisplayMessages(prev => [...prev, ...moreMessages]);
        setHasMoreHistory(startIndex > 0);
      } else {
        setHasMoreHistory(false);
      }
      
      setIsLoadingMore(false);
    }, 300);
  }, [allMessages, displayMessages, isLoadingMore, hasMoreHistory]);

  const sendMessageWithText = async (messageText: string) => {
    if (!messageText.trim() || isLoading || !conversationId) return;

    const userContent = messageText.trim();
    setInputText('');
    setIsLoading(true);
    setStreamingContent('');
    setToolStatus('');

    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
    };
    setDisplayMessages((prev) => [tempUserMsg, ...prev]);
    setAllMessages((prev) => [...prev, tempUserMsg]);

    try {
      await chatManager.sendMessage(
        conversationId,
        agentId,
        userContent,
        {
          onToken: (token) => {
            setStreamingContent((prev) => prev + token);
          },
          onToolCall: (toolName, args) => {
            setToolStatus(`正在执行: ${toolName}`);
          },
          onToolResult: (toolName, result) => {
            setToolStatus(`${toolName} 完成`);
          },
          onComplete: async (message) => {
            const updatedMessages = await chatManager.getMessages(conversationId);
            const validMessages = updatedMessages.filter(m => m.role !== 'tool' && m.role !== 'system');
            setAllMessages(validMessages);
            const showCount = Math.max(displayMessages.length + 1, PAGE_SIZE);
            setDisplayMessages(validMessages.slice(-showCount).reverse());
            setStreamingContent('');
            setToolStatus('');
            setIsLoading(false);
            // 消息发送完成后自动同步
            cloudSync.syncMessages();
          },
          onError: (error) => {
            console.error('Chat error:', error);
            Alert.alert('错误', error.message);
            setStreamingContent('');
            setToolStatus('');
            setIsLoading(false);
          },
        }
      );
    } catch (error) {
      console.error('Send message error:', error);
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;
    await sendMessageWithText(inputText);
  };

  const handleAvatarPress = (isUser: boolean) => {
    if (isSelectionMode) return;
    if (isUser) {
      // 使用高清头像（avatarFull）进行预览，没有则用普通头像
      const fullAvatar = (bossConfig as any).avatarFull || bossConfig.avatar || '👑';
      setAvatarPreview({
        avatar: fullAvatar,
        name: bossConfig.name || '老板',
        title: '公司所有者',
      });
    } else if (currentAgent) {
      const fullAvatar = (currentAgent as any).avatarFull || currentAgent.avatar || '👤';
      setAvatarPreview({
        avatar: fullAvatar,
        name: currentAgent.name,
        title: currentAgent.title,
      });
    }
  };

  const handleLongPress = (messageId: string) => {
    const message = displayMessages.find(m => m.id === messageId) ||
                    allMessages.find(m => m.id === messageId);
    const content = message?.content || '';

    const options = ['复制文本', '多选消息', '取消'];
    const cancelButtonIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex },
        async (buttonIndex) => {
          if (buttonIndex === 0) {
            await Clipboard.setStringAsync(content);
            Alert.alert('已复制', '消息文本已复制到剪贴板');
          } else if (buttonIndex === 1) {
            setIsSelectionMode(true);
            setSelectedMessages(new Set([messageId]));
          }
        }
      );
    } else {
      Alert.alert('消息操作', '', [
        {
          text: '复制文本',
          onPress: async () => {
            await Clipboard.setStringAsync(content);
            Alert.alert('已复制', '消息文本已复制到剪贴板');
          },
        },
        {
          text: '多选消息',
          onPress: () => {
            setIsSelectionMode(true);
            setSelectedMessages(new Set([messageId]));
          },
        },
        { text: '取消', style: 'cancel' },
      ]);
    }
  };

  const handleMessagePress = (messageId: string) => {
    if (!isSelectionMode) return;
    
    setSelectedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const cancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedMessages(new Set());
  };

  const selectAll = () => {
    const allIds = new Set(displayMessages.map(m => m.id));
    setSelectedMessages(allIds);
  };

  const deselectAll = () => {
    setSelectedMessages(new Set());
  };

  const isAllSelected = displayMessages.length > 0 && selectedMessages.size === displayMessages.length;

  const deleteSelectedMessages = async () => {
    if (selectedMessages.size === 0) return;
    
    Alert.alert(
      '删除消息',
      `确定要删除选中的 ${selectedMessages.size} 条消息吗？这将从对话上下文中移除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              const currentMessages = await chatManager.getMessages(conversationId);
              const filteredMessages = currentMessages.filter(m => !selectedMessages.has(m.id));
              await storage.setMessages(conversationId, filteredMessages);
              
              const validMessages = filteredMessages.filter(m => m.role !== 'tool' && m.role !== 'system');
              setAllMessages(validMessages);
              setDisplayMessages(validMessages.slice(-PAGE_SIZE).reverse());
              setHasMoreHistory(validMessages.length > PAGE_SIZE);
              
              setIsSelectionMode(false);
              setSelectedMessages(new Set());
              
              Alert.alert('成功', '已删除选中的消息');
            } catch (error) {
              Alert.alert('错误', '删除失败');
            }
          },
        },
      ]
    );
  };

  const isImageAvatar = (avatar: string | undefined) => {
    return avatar && (avatar.startsWith('data:image/') || avatar.startsWith('http'));
  };

  const renderAvatarElement = (avatar: string | undefined, size: number = 28, isBoss: boolean = false) => {
    let displayAvatar = avatar;
    
    // 优先使用缩略图（用于列表显示更快）
    if (isBoss && bossConfig) {
      const thumbAvatar = bossConfig.avatarThumb;
      if (thumbAvatar && isImageAvatar(thumbAvatar)) {
        displayAvatar = thumbAvatar;
      }
    } else if (!isBoss && currentAgent) {
      const thumbAvatar = (currentAgent as any).avatarThumb;
      if (thumbAvatar && isImageAvatar(thumbAvatar)) {
        displayAvatar = thumbAvatar;
      }
    }
    
    if (isImageAvatar(displayAvatar)) {
      return (
        <Image 
          source={{ uri: displayAvatar }} 
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
        />
      );
    }
    return <Text style={{ fontSize: size }}>{displayAvatar || '👤'}</Text>;
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const isSelected = selectedMessages.has(item.id);

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onLongPress={() => handleLongPress(item.id)}
        onPress={() => handleMessagePress(item.id)}
        delayLongPress={500}
      >
        <View style={[
          styles.messageRow, 
          isUser && styles.messageRowUser,
          isSelected && styles.messageSelected,
        ]}>
          {isSelectionMode && (
            <View style={styles.checkboxContainer}>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </View>
          )}
          {!isUser && (
            <TouchableOpacity 
              style={styles.avatarContainer} 
              onPress={() => handleAvatarPress(false)}
              activeOpacity={0.7}
              disabled={isSelectionMode}
            >
              {renderAvatarElement(currentAgent?.avatar, 32, false)}
            </TouchableOpacity>
          )}
          <View
            style={[
              styles.messageContainer,
              isUser ? styles.userMessage : styles.assistantMessage,
            ]}
          >
            {!isUser && (
              <Text style={styles.messageSender}>{agentName}</Text>
            )}
            {isUser ? (
              <Text style={styles.messageText}>{item.content}</Text>
            ) : (
              <Markdown style={markdownStyles}>{item.content}</Markdown>
            )}
          </View>
          {isUser && (
            <TouchableOpacity 
              style={styles.avatarContainer} 
              onPress={() => handleAvatarPress(true)}
              activeOpacity={0.7}
              disabled={isSelectionMode}
            >
              {renderAvatarElement(bossConfig.avatar || '👑', 32, true)}
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderStreamingMessage = () => {
    if (!streamingContent && !toolStatus) return null;
    return (
      <View style={styles.messageRow}>
        <TouchableOpacity 
          style={styles.avatarContainer} 
          onPress={() => handleAvatarPress(false)}
          activeOpacity={0.7}
        >
          {renderAvatarElement(currentAgent?.avatar, 32, false)}
        </TouchableOpacity>
        <View style={[styles.messageContainer, styles.assistantMessage]}>
          <Text style={styles.messageSender}>{agentName}</Text>
          {toolStatus ? (
            <View style={styles.toolStatusContainer}>
              <ActivityIndicator size="small" color="#4f46e5" />
              <Text style={styles.toolStatusText}>{toolStatus}</Text>
            </View>
          ) : null}
          {streamingContent ? (
            <Markdown style={markdownStyles}>{streamingContent}</Markdown>
          ) : null}
          <ActivityIndicator size="small" color="#4f46e5" style={styles.typing} />
        </View>
      </View>
    );
  };

  const renderLoadMoreFooter = () => {
    if (!hasMoreHistory && !isLoadingMore) return null;
    
    return (
      <View style={styles.loadMoreContainer}>
        {isLoadingMore ? (
          <ActivityIndicator size="small" color="#4f46e5" />
        ) : (
          <Text style={styles.loadMoreText}>上拉加载更多</Text>
        )}
      </View>
    );
  };

  if (initialLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={displayMessages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        inverted
        ListHeaderComponent={renderStreamingMessage}
        ListFooterComponent={renderLoadMoreFooter}
        onEndReached={loadMoreHistory}
        onEndReachedThreshold={0.3}
        initialNumToRender={PAGE_SIZE}
        maxToRenderPerBatch={10}
        windowSize={10}
      />

      {isSelectionMode ? (
        <View style={styles.selectionBarContainer}>
          <View style={styles.selectionBar}>
            <TouchableOpacity style={styles.selectionButton} onPress={cancelSelection}>
              <Text style={styles.selectionButtonText}>✕ 取消</Text>
            </TouchableOpacity>
            <Text style={styles.selectionCount}>
              已选 {selectedMessages.size}/{displayMessages.length}
            </Text>
            <TouchableOpacity 
              style={styles.selectionButton} 
              onPress={isAllSelected ? deselectAll : selectAll}
            >
              <Text style={styles.selectionButtonText}>
                {isAllSelected ? '☐ 取消全选' : '☑ 全选'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.selectionActions}>
            <TouchableOpacity 
              style={[
                styles.actionButton, 
                styles.copyButton,
                selectedMessages.size === 0 && styles.actionButtonDisabled
              ]} 
              onPress={async () => {
                if (selectedMessages.size === 0) return;
                const selected = allMessages
                  .filter(m => selectedMessages.has(m.id))
                  .map(m => m.content)
                  .join('\n\n');
                await Clipboard.setStringAsync(selected);
                Alert.alert('已复制', `${selectedMessages.size} 条消息已复制到剪贴板`);
                cancelSelection();
              }}
              disabled={selectedMessages.size === 0}
            >
              <Text style={styles.copyButtonText}>
                📋 复制 ({selectedMessages.size})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[
                styles.actionButton, 
                styles.deleteButton,
                selectedMessages.size === 0 && styles.actionButtonDisabled
              ]} 
              onPress={deleteSelectedMessages}
              disabled={selectedMessages.size === 0}
            >
              <Text style={styles.deleteButtonText}>
                🗑️ 删除 ({selectedMessages.size})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="输入消息..."
            placeholderTextColor="#6b7280"
            multiline
            maxLength={2000}
            editable={!isLoading}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendButtonText}>发送</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* 头像放大预览弹窗 */}
      <Modal
        visible={avatarPreview !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setAvatarPreview(null)}
      >
        <TouchableOpacity
          style={styles.avatarPreviewOverlay}
          activeOpacity={1}
          onPress={() => setAvatarPreview(null)}
        >
          <View style={styles.avatarPreviewContent}>
            {avatarPreview?.avatar && isImageAvatar(avatarPreview.avatar) ? (
              <Image 
                source={{ uri: avatarPreview.avatar }} 
                style={styles.avatarPreviewImage}
              />
            ) : (
              <Text style={styles.avatarPreviewEmoji}>{avatarPreview?.avatar || '👤'}</Text>
            )}
            <Text style={styles.avatarPreviewName}>{avatarPreview?.name}</Text>
            <Text style={styles.avatarPreviewTitle}>{avatarPreview?.title}</Text>
            <Text style={styles.avatarPreviewHint}>点击任意位置关闭</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const markdownStyles = {
  body: {
    color: '#e5e7eb',
    fontSize: 15,
    lineHeight: 22,
  },
  heading1: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold' as const,
    marginVertical: 8,
  },
  heading2: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold' as const,
    marginVertical: 6,
  },
  heading3: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold' as const,
    marginVertical: 4,
  },
  code_inline: {
    backgroundColor: '#374151',
    color: '#f472b6',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fence: {
    backgroundColor: '#1f2937',
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  code_block: {
    color: '#e5e7eb',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: '#4f46e5',
    paddingLeft: 12,
    marginLeft: 0,
    backgroundColor: '#1f2937',
    paddingVertical: 4,
    marginVertical: 8,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  list_item: {
    flexDirection: 'row' as const,
    marginVertical: 2,
  },
  bullet_list_icon: {
    color: '#4f46e5',
    marginRight: 8,
  },
  ordered_list_icon: {
    color: '#4f46e5',
    marginRight: 8,
  },
  strong: {
    color: '#fff',
    fontWeight: 'bold' as const,
  },
  em: {
    fontStyle: 'italic' as const,
  },
  link: {
    color: '#60a5fa',
    textDecorationLine: 'underline' as const,
  },
  hr: {
    backgroundColor: '#374151',
    height: 1,
    marginVertical: 12,
  },
  table: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 4,
    marginVertical: 8,
  },
  thead: {
    backgroundColor: '#1f2937',
  },
  th: {
    padding: 8,
    color: '#fff',
    fontWeight: 'bold' as const,
  },
  td: {
    padding: 8,
    color: '#e5e7eb',
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16213e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#16213e',
  },
  loadingText: {
    color: '#9ca3af',
    marginTop: 12,
  },
  messageList: {
    padding: 16,
    paddingHorizontal: 8,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageSelected: {
    backgroundColor: 'rgba(79, 70, 229, 0.2)',
    borderRadius: 8,
    marginHorizontal: -4,
    paddingHorizontal: 4,
  },
  checkboxContainer: {
    justifyContent: 'center',
    marginRight: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4f46e5',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  checkboxSelected: {
    backgroundColor: '#4f46e5',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  avatarContainer: {
    marginHorizontal: 6,
    marginBottom: 4,
  },
  messageAvatar: {
    fontSize: 28,
  },
  loadMoreContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  loadMoreText: {
    color: '#4f46e5',
    fontSize: 14,
  },
  messageContainer: {
    maxWidth: '70%',
    padding: 12,
    borderRadius: 16,
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
  toolStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  toolStatusText: {
    color: '#4f46e5',
    fontSize: 12,
    marginLeft: 8,
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
  selectionBarContainer: {
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#2d2d44',
  },
  selectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  selectionActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  selectionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#2d2d44',
  },
  selectionButtonText: {
    color: '#fff',
    fontSize: 13,
  },
  selectionCount: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  actionButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  copyButton: {
    backgroundColor: '#4f46e5',
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  deleteButton: {
    backgroundColor: '#dc2626',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#2d2d44',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  sendButton: {
    backgroundColor: '#4f46e5',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginLeft: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 60,
  },
  sendButtonDisabled: {
    backgroundColor: '#3730a3',
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // 头像放大预览样式
  avatarPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarPreviewContent: {
    alignItems: 'center',
    padding: 40,
  },
  avatarPreviewEmoji: {
    fontSize: 150,
    marginBottom: 24,
  },
  avatarPreviewImage: {
    width: 200,
    height: 200,
    borderRadius: 100,
    marginBottom: 24,
  },
  avatarPreviewName: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  avatarPreviewTitle: {
    color: '#4f46e5',
    fontSize: 18,
    marginBottom: 32,
  },
  avatarPreviewHint: {
    color: '#6b7280',
    fontSize: 14,
  },
});
