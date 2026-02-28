/**
 * 人事管理页面 - 完整组织架构与人事管理
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  Dimensions,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { storage } from '../core/storage';
import { Agent } from '../core/config/agents';

interface Department {
  id: string;
  name: string;
  agents: Agent[];
}

const DEFAULT_DEPARTMENT_NAMES: Record<string, string> = {
  executive: '高管层',
  admin: '行政部',
  tech: '技术部',
  hr: '人力资源部',
  finance: '财务部',
  marketing: '市场部',
  sales: '销售部',
  product: '产品部',
  design: '设计部',
  operations: '运营部',
  legal: '法务部',
  general: '综合部',
};

const LEVEL_NAMES: Record<string, string> = {
  c_level: 'C级高管',
  director: '总监',
  manager: '经理',
  senior: '高级',
  employee: '员工',
  assistant: '助理',
  intern: '实习生',
};

const LEVEL_ORDER = ['c_level', 'director', 'manager', 'senior', 'employee', 'assistant', 'intern'];

// ALL_DEPARTMENTS 会在组件内动态生成
const ALL_LEVELS = Object.entries(LEVEL_NAMES).map(([id, name]) => ({ id, name }));

const screenWidth = Dimensions.get('window').width;
const screenHeight = Dimensions.get('window').height;

interface AvatarPreview {
  avatar: string;
  name: string;
  title: string;
}

export default function HRScreen() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentNames, setDepartmentNames] = useState<Record<string, string>>(DEFAULT_DEPARTMENT_NAMES);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'org' | 'list'>('org');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<AvatarPreview | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    title: '',
    description: '',
    department: '',
    level: '',
    reportsTo: '',
    avatar: '',
  });

  const loadAgents = useCallback(async () => {
    try {
      // 加载同步的部门配置
      const syncedDepts = await storage.getData<Record<string, any>>('departments');
      let deptNameMap = { ...DEFAULT_DEPARTMENT_NAMES };
      if (syncedDepts) {
        for (const [id, dept] of Object.entries(syncedDepts)) {
          if (dept.name) {
            deptNameMap[id] = dept.name;
          }
        }
      }
      setDepartmentNames(deptNameMap);

      const allAgents = await storage.getAgents();
      const activeAgents = allAgents.filter((a: Agent) => a.status !== 'terminated');
      setAgents(activeAgents);

      // 按部门分组（支持多部门）
      const deptMap: Record<string, Agent[]> = {};
      for (const agent of activeAgents) {
        // 使用 departments 数组（如果有），否则使用 department
        const depts = (agent as any).departments || [agent.department || 'general'];
        for (const dept of depts) {
          if (!deptMap[dept]) {
            deptMap[dept] = [];
          }
          // 避免重复添加
          if (!deptMap[dept].find(a => a.id === agent.id)) {
            deptMap[dept].push(agent);
          }
        }
      }

      const deptList: Department[] = Object.entries(deptMap).map(([id, agents]) => ({
        id,
        name: deptNameMap[id] || id,
        agents: agents.sort((a, b) => {
          const levelA = LEVEL_ORDER.indexOf(a.level);
          const levelB = LEVEL_ORDER.indexOf(b.level);
          return levelA - levelB;
        }),
      }));

      // 排序：高管层在前
      deptList.sort((a, b) => {
        if (a.id === 'executive') return -1;
        if (b.id === 'executive') return 1;
        return a.name.localeCompare(b.name);
      });

      setDepartments(deptList);
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const onRefresh = () => {
    setRefreshing(true);
    loadAgents();
  };

  const pendingAgentRef = React.useRef<Agent | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState(false);

  const openEditModal = (agent: Agent) => {
    setEditingAgent(agent);
    setEditForm({
      name: agent.name,
      title: agent.title,
      description: agent.description || '',
      department: agent.department || 'general',
      level: agent.level || 'employee',
      reportsTo: agent.reportsTo || '',
      avatar: agent.avatar || '',
    });
  };

  const pickAvatarFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('权限不足', '需要相册权限才能选择头像');
      return;
    }
    pendingAgentRef.current = editingAgent;
    setEditingAgent(null);
    setPickingAvatar(true);
  };

  useEffect(() => {
    if (!pickingAvatar) return;
    setPickingAvatar(false);

    (async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.6,
          base64: true,
        });
        if (!result.canceled && result.assets[0].base64) {
          const uri = result.assets[0].uri;
          const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
          const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
          const base64Data = `data:${mime};base64,${result.assets[0].base64}`;
          setEditForm(prev => ({ ...prev, avatar: base64Data }));
        }
      } catch (e) {
        console.error('Image picker error:', e);
      } finally {
        setEditingAgent(pendingAgentRef.current);
        pendingAgentRef.current = null;
      }
    })();
  }, [pickingAvatar]);

  const renderAvatar = (
    avatar: string,
    size: 'small' | 'medium' | 'large' = 'medium',
    agent?: Agent
  ) => {
    const sizeMap = { small: 24, medium: 36, large: 50 };
    const fontSizeMap = { small: 20, medium: 28, large: 40 };
    const imageSize = sizeMap[size];
    const fontSize = fontSizeMap[size];
    
    const handlePress = () => {
      if (agent) {
        // 使用高清头像（avatarFull）进行预览
        const fullAvatar = (agent as any).avatarFull || agent.avatar || '👤';
        setAvatarPreview({
          avatar: fullAvatar,
          name: agent.name,
          title: agent.title,
        });
      }
    };

    // 判断是否是图片（Base64 或 URL）
    const isImage = avatar && (avatar.startsWith('data:image/') || avatar.startsWith('http'));
    
    return (
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        {isImage ? (
          <Image 
            source={{ uri: avatar }} 
            style={{ width: imageSize, height: imageSize, borderRadius: imageSize / 2 }}
            resizeMode="cover"
            fadeDuration={0}
          />
        ) : (
          <Text style={{ fontSize }}>{avatar || '👤'}</Text>
        )}
      </TouchableOpacity>
    );
  };

  const saveAgent = async () => {
    if (!editingAgent) return;

    try {
      const allAgents = await storage.getAgents();
      const index = allAgents.findIndex((a: Agent) => a.id === editingAgent.id);

      if (index !== -1) {
        const isImageAvatar = editForm.avatar.startsWith('data:image/') || editForm.avatar.startsWith('http');
        allAgents[index] = {
          ...allAgents[index],
          name: editForm.name,
          title: editForm.title,
          description: editForm.description,
          department: editForm.department,
          level: editForm.level,
          reportsTo: editForm.reportsTo || undefined,
          avatar: editForm.avatar,
          updatedAt: Date.now(),
          ...(isImageAvatar ? {
            avatarThumb: editForm.avatar,
            avatarFull: editForm.avatar,
          } : {
            avatarThumb: undefined,
            avatarFull: undefined,
          }),
        };
        await storage.setAgents(allAgents);
        Alert.alert('成功', '员工信息已更新');
        setEditingAgent(null);
        loadAgents();
      }
    } catch (error) {
      Alert.alert('错误', '保存失败');
    }
  };

  const terminateAgent = (agent: Agent) => {
    Alert.alert(
      '确认开除',
      `确定要开除 ${agent.name} 吗？此操作不可撤销。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '开除',
          style: 'destructive',
          onPress: async () => {
            try {
              const allAgents = await storage.getAgents();
              const index = allAgents.findIndex((a: Agent) => a.id === agent.id);
              if (index !== -1) {
                allAgents[index].status = 'terminated';
                await storage.setAgents(allAgents);
                Alert.alert('已开除', `${agent.name} 已离职`);
                loadAgents();
              }
            } catch (error) {
              Alert.alert('错误', '操作失败');
            }
          },
        },
      ]
    );
  };

  const getReportsToName = (reportsTo: string | undefined) => {
    if (!reportsTo) return '老板';
    const manager = agents.find(a => a.id === reportsTo);
    return manager ? manager.name : reportsTo;
  };

  // 组织架构图视图
  const renderOrgChart = () => {
    // 找出所有 C-level
    const cLevel = agents.filter(a => a.level === 'c_level');
    
    return (
      <View style={styles.orgChart}>
        {/* 老板节点 */}
        <View style={styles.bossNode}>
          <Text style={styles.bossEmoji}>👔</Text>
          <Text style={styles.bossTitle}>老板</Text>
        </View>

        {/* 连接线 */}
        <View style={styles.verticalLine} />

        {/* C-Level 高管 */}
        {cLevel.length > 0 && (
          <View style={styles.levelRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.horizontalNodes}>
                {cLevel.map(agent => (
                  <TouchableOpacity
                    key={agent.id}
                    style={styles.orgNode}
                    onPress={() => openEditModal(agent)}
                    onLongPress={() => terminateAgent(agent)}
                  >
                    {renderAvatar(agent.avatar, 'medium', agent)}
                    <Text style={styles.nodeName} numberOfLines={1}>{agent.name}</Text>
                    <Text style={styles.nodeTitle} numberOfLines={1}>{agent.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* 部门分组 */}
        {departments.filter(d => d.id !== 'executive').map(dept => (
          <View key={dept.id} style={styles.deptSection}>
            <View style={styles.deptHeader}>
              <View style={[styles.deptBadge, { backgroundColor: getDeptColor(dept.id) }]}>
                <Text style={styles.deptBadgeText}>{dept.name}</Text>
              </View>
              <Text style={styles.deptCount}>{dept.agents.length}人</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.horizontalNodes}>
                {dept.agents.map(agent => {
                  // 判断是否是兼职（当前部门不是主部门）
                  const isPartTime = agent.department !== dept.id && 
                    (agent as any).departments?.includes(dept.id);
                  return (
                    <TouchableOpacity
                      key={`${agent.id}-${dept.id}`}
                      style={[styles.orgNode, styles.deptNode, isPartTime && styles.partTimeNode]}
                      onPress={() => openEditModal(agent)}
                      onLongPress={() => terminateAgent(agent)}
                    >
                      {renderAvatar(agent.avatar, 'medium', agent)}
                      <Text style={styles.nodeName} numberOfLines={1}>{agent.name}</Text>
                      <Text style={styles.nodeTitle} numberOfLines={1}>{agent.title}</Text>
                      <Text style={styles.nodeLevel}>{LEVEL_NAMES[agent.level] || agent.level}</Text>
                      {isPartTime && <Text style={styles.partTimeBadge}>兼职</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ))}
      </View>
    );
  };

  // 列表视图
  const renderListView = () => (
    <View>
      {departments.map(dept => (
        <View key={dept.id} style={styles.listDept}>
          <View style={styles.listDeptHeader}>
            <View style={[styles.deptDot, { backgroundColor: getDeptColor(dept.id) }]} />
            <Text style={styles.listDeptName}>{dept.name}</Text>
            <Text style={styles.listDeptCount}>{dept.agents.length}人</Text>
          </View>
          {dept.agents.map(agent => {
            const isPartTime = agent.department !== dept.id && 
              (agent as any).departments?.includes(dept.id);
            return (
              <TouchableOpacity
                key={`${agent.id}-${dept.id}`}
                style={[styles.listItem, isPartTime && styles.listItemPartTime]}
                onPress={() => openEditModal(agent)}
                onLongPress={() => terminateAgent(agent)}
              >
                <View style={styles.listAvatarContainer}>
                  {renderAvatar(agent.avatar, 'medium', agent)}
                </View>
                <View style={styles.listInfo}>
                  <View style={styles.listNameRow}>
                    <Text style={styles.listName}>{agent.name}</Text>
                    {isPartTime && <Text style={styles.listPartTimeBadge}>兼职</Text>}
                  </View>
                  <Text style={styles.listTitle}>{agent.title}</Text>
                  <View style={styles.listMeta}>
                    <Text style={styles.listLevel}>{LEVEL_NAMES[agent.level]}</Text>
                    <Text style={styles.listReports}>
                      汇报给: {getReportsToName(agent.reportsTo)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.editIcon}>✏️</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );

  const getDeptColor = (deptId: string): string => {
    const colors: Record<string, string> = {
      executive: '#8B5CF6',
      tech: '#3B82F6',
      product: '#10B981',
      design: '#F59E0B',
      marketing: '#EC4899',
      sales: '#EF4444',
      finance: '#14B8A6',
      hr: '#6366F1',
      admin: '#6B7280',
      operations: '#F97316',
      general: '#9CA3AF',
    };
    return colors[deptId] || '#6B7280';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 视图切换 */}
      <View style={styles.viewSwitch}>
        <TouchableOpacity
          style={[styles.switchBtn, viewMode === 'org' && styles.switchBtnActive]}
          onPress={() => setViewMode('org')}
        >
          <Text style={[styles.switchText, viewMode === 'org' && styles.switchTextActive]}>
            架构图
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.switchBtn, viewMode === 'list' && styles.switchBtnActive]}
          onPress={() => setViewMode('list')}
        >
          <Text style={[styles.switchText, viewMode === 'list' && styles.switchTextActive]}>
            列表
          </Text>
        </TouchableOpacity>
      </View>

      {/* 统计 */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{agents.length}</Text>
          <Text style={styles.statLabel}>在职员工</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{departments.length}</Text>
          <Text style={styles.statLabel}>部门数量</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>
            {agents.filter(a => a.level === 'c_level').length}
          </Text>
          <Text style={styles.statLabel}>高管人数</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4f46e5" />
        }
      >
        {viewMode === 'org' ? renderOrgChart() : renderListView()}

        <Text style={styles.hint}>点击编辑员工信息，长按可开除员工</Text>
      </ScrollView>

      {/* 编辑弹窗 */}
      <Modal
        visible={editingAgent !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingAgent(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>编辑员工信息</Text>

              {/* 头像编辑区 */}
              <View style={styles.avatarSection}>
                {(editForm.avatar || editingAgent?.avatar || '').startsWith('data:image/') || 
                 (editForm.avatar || editingAgent?.avatar || '').startsWith('http') ? (
                  <Image 
                    source={{ uri: editForm.avatar || editingAgent?.avatar }} 
                    style={styles.modalAvatarImage}
                  />
                ) : (
                  <Text style={styles.modalAvatar}>{editForm.avatar || editingAgent?.avatar || '👤'}</Text>
                )}
                <View style={styles.avatarButtons}>
                  <TouchableOpacity
                    style={styles.avatarPickButton}
                    onPress={pickAvatarFromLibrary}
                  >
                    <Text style={styles.avatarPickText}>📷 从相册选择</Text>
                  </TouchableOpacity>
                  {(editForm.avatar || '').startsWith('data:image/') && (
                    <TouchableOpacity
                      style={[styles.avatarPickButton, styles.avatarClearButton]}
                      onPress={() => setEditForm({ ...editForm, avatar: '👤' })}
                    >
                      <Text style={styles.avatarPickText}>🗑️ 清除图片</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <Text style={styles.label}>头像（输入 Emoji 或从相册选择图片）</Text>
              <TextInput
                style={[styles.input, styles.emojiInput]}
                value={(editForm.avatar || '').startsWith('data:image/') ? '📷 已选择图片' : editForm.avatar}
                onChangeText={(text) => {
                  if (text !== '📷 已选择图片') {
                    setEditForm({ ...editForm, avatar: text });
                  }
                }}
                placeholder="👤 输入 Emoji"
                placeholderTextColor="#666"
                editable={!(editForm.avatar || '').startsWith('data:image/')}
              />

              <Text style={styles.label}>姓名</Text>
              <TextInput
                style={styles.input}
                value={editForm.name}
                onChangeText={(text) => setEditForm({ ...editForm, name: text })}
                placeholder="姓名"
                placeholderTextColor="#666"
              />

              <Text style={styles.label}>职位</Text>
              <TextInput
                style={styles.input}
                value={editForm.title}
                onChangeText={(text) => setEditForm({ ...editForm, title: text })}
                placeholder="职位"
                placeholderTextColor="#666"
              />

              <Text style={styles.label}>所属部门</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
                {Object.entries(departmentNames).map(([id, name]) => (
                  <TouchableOpacity
                    key={id}
                    style={[
                      styles.pickerItem,
                      editForm.department === id && styles.pickerItemActive,
                    ]}
                    onPress={() => setEditForm({ ...editForm, department: id })}
                  >
                    <Text
                      style={[
                        styles.pickerText,
                        editForm.department === id && styles.pickerTextActive,
                      ]}
                    >
                      {name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.label}>职级</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
                {ALL_LEVELS.map(level => (
                  <TouchableOpacity
                    key={level.id}
                    style={[
                      styles.pickerItem,
                      editForm.level === level.id && styles.pickerItemActive,
                    ]}
                    onPress={() => setEditForm({ ...editForm, level: level.id })}
                  >
                    <Text
                      style={[
                        styles.pickerText,
                        editForm.level === level.id && styles.pickerTextActive,
                      ]}
                    >
                      {level.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.label}>汇报对象</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
                <TouchableOpacity
                  style={[
                    styles.pickerItem,
                    !editForm.reportsTo && styles.pickerItemActive,
                  ]}
                  onPress={() => setEditForm({ ...editForm, reportsTo: '' })}
                >
                  <Text
                    style={[
                      styles.pickerText,
                      !editForm.reportsTo && styles.pickerTextActive,
                    ]}
                  >
                    👔 老板
                  </Text>
                </TouchableOpacity>
                {agents
                  .filter(a => a.id !== editingAgent?.id)
                  .map(agent => (
                    <TouchableOpacity
                      key={agent.id}
                      style={[
                        styles.pickerItem,
                        editForm.reportsTo === agent.id && styles.pickerItemActive,
                      ]}
                      onPress={() => setEditForm({ ...editForm, reportsTo: agent.id })}
                    >
                      <Text
                        style={[
                          styles.pickerText,
                          editForm.reportsTo === agent.id && styles.pickerTextActive,
                        ]}
                      >
                        {agent.avatar} {agent.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>

              <Text style={styles.label}>职责描述</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={editForm.description}
                onChangeText={(text) => setEditForm({ ...editForm, description: text })}
                placeholder="职责描述"
                placeholderTextColor="#666"
                multiline
                numberOfLines={3}
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={() => setEditingAgent(null)}
                >
                  <Text style={styles.buttonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={saveAgent}>
                  <Text style={styles.buttonText}>保存</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

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
  viewSwitch: {
    flexDirection: 'row',
    margin: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 4,
  },
  switchBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  switchBtnActive: {
    backgroundColor: '#4f46e5',
  },
  switchText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  switchTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4f46e5',
  },
  statLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  // 组织架构图样式
  orgChart: {
    padding: 12,
  },
  bossNode: {
    alignSelf: 'center',
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  bossEmoji: {
    fontSize: 32,
  },
  bossTitle: {
    color: '#fff',
    fontWeight: 'bold',
    marginTop: 4,
  },
  verticalLine: {
    width: 2,
    height: 20,
    backgroundColor: '#4f46e5',
    alignSelf: 'center',
  },
  levelRow: {
    marginVertical: 8,
  },
  horizontalNodes: {
    flexDirection: 'row',
    paddingHorizontal: 8,
  },
  orgNode: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 6,
    alignItems: 'center',
    minWidth: 90,
    borderWidth: 1,
    borderColor: '#4f46e5',
  },
  deptNode: {
    borderColor: '#2d2d44',
  },
  partTimeNode: {
    borderColor: '#f59e0b',
    borderStyle: 'dashed',
    opacity: 0.9,
  },
  partTimeBadge: {
    fontSize: 9,
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  nodeAvatar: {
    fontSize: 28,
  },
  nodeName: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  nodeTitle: {
    color: '#9ca3af',
    fontSize: 11,
    textAlign: 'center',
  },
  nodeLevel: {
    color: '#6b7280',
    fontSize: 10,
    marginTop: 2,
  },
  deptSection: {
    marginTop: 16,
  },
  deptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  deptBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  deptBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  deptCount: {
    color: '#9ca3af',
    fontSize: 12,
    marginLeft: 8,
  },
  // 列表视图样式
  listDept: {
    marginHorizontal: 12,
    marginBottom: 16,
  },
  listDeptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  deptDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  listDeptName: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  listDeptCount: {
    color: '#9ca3af',
    fontSize: 12,
    marginLeft: 8,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  listAvatarContainer: {
    marginRight: 12,
  },
  listInfo: {
    flex: 1,
  },
  listItemPartTime: {
    borderColor: '#f59e0b',
    borderStyle: 'dashed',
  },
  listNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listName: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  listPartTimeBadge: {
    fontSize: 10,
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 8,
  },
  listTitle: {
    color: '#4f46e5',
    fontSize: 13,
    marginTop: 2,
  },
  listMeta: {
    flexDirection: 'row',
    marginTop: 4,
  },
  listLevel: {
    color: '#9ca3af',
    fontSize: 11,
    marginRight: 12,
  },
  listReports: {
    color: '#6b7280',
    fontSize: 11,
  },
  editIcon: {
    fontSize: 16,
  },
  hint: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    padding: 16,
    paddingBottom: 32,
  },
  // Modal 样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalAvatar: {
    fontSize: 48,
    textAlign: 'center',
  },
  modalAvatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarButtons: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  avatarPickButton: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  avatarClearButton: {
    backgroundColor: '#ef4444',
  },
  avatarPickText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emojiInput: {
    fontSize: 28,
    textAlign: 'center',
  },
  label: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  picker: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  pickerItem: {
    backgroundColor: '#16213e',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  pickerItemActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  pickerText: {
    color: '#9ca3af',
    fontSize: 13,
  },
  pickerTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 24,
  },
  button: {
    flex: 1,
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  cancelButton: {
    backgroundColor: '#374151',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
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
