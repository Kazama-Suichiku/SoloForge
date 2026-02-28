/**
 * Agent 列表页面
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { chatManager } from '../core/chat';
import { Agent } from '../core/config/agents';

type AgentsScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'MainTabs'
>;

interface Props {
  navigation?: any;
}

interface AvatarPreview {
  avatar: string;
  name: string;
  title: string;
}

export default function AgentsScreen({ navigation: propNav }: Props) {
  const navigation = useNavigation<AgentsScreenNavigationProp>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<AvatarPreview | null>(null);

  const loadAgents = async () => {
    try {
      await chatManager.initialize();
      const result = await chatManager.getAgents();
      const activeAgents = result.filter((a: Agent) => a.status !== 'terminated');
      setAgents(activeAgents);
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  // 页面获得焦点时刷新
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadAgents();
    });
    return unsubscribe;
  }, [navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    loadAgents();
  };

  const handleAgentPress = (agent: Agent) => {
    navigation.navigate('Chat', {
      agentId: agent.id,
      agentName: agent.name,
    });
  };

  const handleAvatarPress = (agent: Agent) => {
    // 使用高清头像（avatarFull）进行预览
    const fullAvatar = (agent as any).avatarFull || agent.avatar || '👤';
    setAvatarPreview({
      avatar: fullAvatar,
      name: agent.name,
      title: agent.title,
    });
  };

  const isImageAvatar = (avatar: string | undefined) => {
    return avatar && (avatar.startsWith('data:image/') || avatar.startsWith('http'));
  };

  const renderAgent = ({ item }: { item: Agent }) => (
    <TouchableOpacity
      style={styles.agentCard}
      onPress={() => handleAgentPress(item)}
      activeOpacity={0.7}
    >
      <TouchableOpacity onPress={() => handleAvatarPress(item)} activeOpacity={0.7}>
        {isImageAvatar(item.avatar) ? (
          <Image source={{ uri: item.avatar }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatar}>{item.avatar || '👤'}</Text>
        )}
      </TouchableOpacity>
      <View style={styles.agentInfo}>
        <Text style={styles.agentName}>{item.name}</Text>
        <Text style={styles.agentTitle}>{item.title}</Text>
        <Text style={styles.agentDesc} numberOfLines={2}>
          {item.description}
        </Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>选择一位成员开始对话（共 {agents.length} 人）</Text>
      <FlatList
        data={agents}
        renderItem={renderAgent}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4f46e5"
          />
        }
      />

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
            {avatarPreview?.avatar && (avatarPreview.avatar.startsWith('data:image/') || avatarPreview.avatar.startsWith('http')) ? (
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
    </View>
  );
}

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
    marginTop: 12,
    color: '#9ca3af',
    fontSize: 16,
  },
  header: {
    fontSize: 16,
    color: '#9ca3af',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  list: {
    padding: 16,
  },
  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  avatar: {
    fontSize: 40,
    marginRight: 16,
  },
  avatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 16,
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  agentTitle: {
    fontSize: 14,
    color: '#4f46e5',
    marginTop: 2,
  },
  agentDesc: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
  arrow: {
    fontSize: 24,
    color: '#4f46e5',
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
