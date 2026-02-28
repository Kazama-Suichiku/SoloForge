/**
 * 运营仪表板 - 完整版
 * 包含：目标管理、KPI、任务看板、审批流程、Token 预算
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Dimensions,
  Image,
} from 'react-native';
import { storage } from '../core/storage';
import { chatManager } from '../core/chat';

const screenWidth = Dimensions.get('window').width;

const isImageAvatar = (avatar?: string): boolean => {
  if (!avatar) return false;
  return avatar.startsWith('data:image') || avatar.startsWith('http');
};

interface Goal {
  id: string;
  title: string;
  description?: string;
  owner: string;
  department?: string;
  status: 'active' | 'completed' | 'cancelled';
  progress: number;
  type?: 'strategic' | 'quarterly' | 'monthly' | 'weekly';
  dueDate?: string;
  createdAt: string;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  assignee: string;
  requester?: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  dueDate?: string;
  createdAt: string;
  goalId?: string;
}

interface KPI {
  id: string;
  name: string;
  owner: string;
  current: number;
  target: number;
  progress: string;
  department?: string;
  period?: string;
}

interface ApprovalRequest {
  id: string;
  type: 'recruit' | 'terminate' | 'budget';
  title: string;
  description: string;
  requester: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

type TabType = 'overview' | 'goals' | 'tasks' | 'kpis' | 'approvals' | 'budget';

interface Props {
  navigation?: any;
}

export default function DashboardScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 数据状态
  const [agents, setAgents] = useState<any[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [kpis, setKPIs] = useState<KPI[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [tokenUsage, setTokenUsage] = useState({ total: 0, byAgent: {} as Record<string, number> });
  const [budgetConfig, setBudgetConfig] = useState({ globalDailyLimit: 100000 });

  // Modal 状态
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<'goal' | 'task'>('goal');
  const [newItem, setNewItem] = useState({ title: '', description: '', priority: 'medium' as Task['priority'] });

  const loadData = useCallback(async () => {
    try {
      await chatManager.initialize();

      const [agentsData, operations, todos, usage, agentRequests, terminationRequests, budgets] = await Promise.all([
        chatManager.getAgents(),
        storage.getOperations(),
        storage.getTodos(),
        storage.getTokenUsage(),
        storage.getData<any>('agentRequests'),
        storage.getData<any>('terminationRequests'),
        storage.getData<any>('budgets'),
      ]);

      setAgents(agentsData || []);
      setGoals(operations?.goals || []);
      setKPIs(operations?.kpis || []);
      setTokenUsage(usage || { total: 0, byAgent: {} });

      // 加载预算配置
      if (budgets?.globalDailyLimit) {
        setBudgetConfig({ globalDailyLimit: budgets.globalDailyLimit });
      }

      // 合并所有 todos 为任务
      const allTodos: Task[] = [];
      if (todos && typeof todos === 'object') {
        Object.entries(todos).forEach(([agentId, agentTodos]) => {
          if (!Array.isArray(agentTodos)) return;
          (agentTodos as any[]).forEach(todo => {
            allTodos.push({
              id: todo.id,
              title: todo.title || todo.description,
              description: todo.description,
              assignee: agentId,
              status: todo.status === 'done' ? 'done' : todo.status === 'in_progress' ? 'in_progress' : 'pending',
              priority: todo.priority || 'medium',
              createdAt: todo.createdAt || new Date().toISOString(),
            });
          });
        });
      }
      setTasks(allTodos);

      // 加载真实审批数据
      const allApprovals: ApprovalRequest[] = [];
      
      // 招聘审批
      if (agentRequests?.requests && Array.isArray(agentRequests.requests)) {
        agentRequests.requests.forEach((req: any) => {
          allApprovals.push({
            id: req.id,
            type: 'recruit',
            title: `招聘: ${req.role || req.title || '新员工'}`,
            description: req.description || req.reason || '',
            requester: req.requesterId || req.requesterName || '系统',
            status: req.status === 'approved' ? 'approved' : req.status === 'rejected' ? 'rejected' : 'pending',
            createdAt: req.createdAt || new Date().toISOString(),
          });
        });
      }
      
      // 解雇审批
      if (terminationRequests?.requests && Array.isArray(terminationRequests.requests)) {
        terminationRequests.requests.forEach((req: any) => {
          allApprovals.push({
            id: req.id,
            type: 'terminate',
            title: `解雇: ${req.agentName || req.agentId || '员工'}`,
            description: req.reason || '',
            requester: req.requesterId || req.requesterName || '系统',
            status: req.status === 'approved' ? 'approved' : req.status === 'rejected' ? 'rejected' : 'pending',
            createdAt: req.createdAt || new Date().toISOString(),
          });
        });
      }
      
      // 合并 operations 中的审批
      if (operations?.approvals && Array.isArray(operations.approvals)) {
        allApprovals.push(...operations.approvals);
      }
      
      setApprovals(allApprovals);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  // 添加目标或任务
  const handleAdd = async () => {
    if (!newItem.title.trim()) {
      Alert.alert('错误', '请输入标题');
      return;
    }

    try {
      const operations = await storage.getOperations();
      
      if (addType === 'goal') {
        const newGoal: Goal = {
          id: `goal_${Date.now()}`,
          title: newItem.title,
          description: newItem.description,
          owner: '老板',
          status: 'active',
          progress: 0,
          type: 'monthly',
          createdAt: new Date().toISOString(),
        };
        operations.goals = [...(operations.goals || []), newGoal];
        setGoals(operations.goals);
      } else {
        const newTask: Task = {
          id: `task_${Date.now()}`,
          title: newItem.title,
          description: newItem.description,
          assignee: agents[0]?.id || 'unknown',
          status: 'pending',
          priority: newItem.priority,
          createdAt: new Date().toISOString(),
        };
        setTasks([...tasks, newTask]);
      }

      await storage.setOperations(operations);
      setShowAddModal(false);
      setNewItem({ title: '', description: '', priority: 'medium' });
      Alert.alert('成功', `${addType === 'goal' ? '目标' : '任务'}已添加`);
    } catch (error) {
      Alert.alert('错误', '添加失败');
    }
  };

  // 更新目标进度
  const updateGoalProgress = async (goalId: string, progress: number) => {
    try {
      const operations = await storage.getOperations();
      const index = operations.goals.findIndex((g: Goal) => g.id === goalId);
      if (index !== -1) {
        operations.goals[index].progress = progress;
        if (progress >= 100) {
          operations.goals[index].status = 'completed';
        }
        await storage.setOperations(operations);
        setGoals([...operations.goals]);
        setSelectedGoal(null);
        Alert.alert('成功', '进度已更新');
      }
    } catch (error) {
      Alert.alert('错误', '更新失败');
    }
  };

  // 更新任务状态
  const updateTaskStatus = async (taskId: string, status: Task['status']) => {
    try {
      const updated = tasks.map(t => t.id === taskId ? { ...t, status } : t);
      setTasks(updated);
      setSelectedTask(null);
      // 同步到存储...
    } catch (error) {
      Alert.alert('错误', '更新失败');
    }
  };

  // 处理审批
  const handleApproval = async (id: string, approved: boolean) => {
    try {
      const updated = approvals.map(a =>
        a.id === id ? { ...a, status: approved ? 'approved' : 'rejected' as ApprovalRequest['status'] } : a
      );
      setApprovals(updated);
      Alert.alert('成功', approved ? '已批准' : '已拒绝');
    } catch (error) {
      Alert.alert('错误', '操作失败');
    }
  };

  // 催办任务
  const handleUrgeTask = (task: Task) => {
    const agent = agents.find(a => a.id === task.assignee);
    if (!agent) {
      Alert.alert('提示', '找不到对应的负责人');
      return;
    }

    const urgeMessage = `【催办】请尽快处理任务：${task.title}${task.description ? `\n\n任务描述：${task.description}` : ''}${task.priority === 'high' ? '\n\n⚠️ 这是一个高优先级任务！' : ''}`;

    if (navigation) {
      navigation.navigate('Chat', {
        agentId: agent.id,
        agentName: agent.name,
        initialMessage: urgeMessage,
      });
    } else {
      Alert.alert(
        '催办已发送',
        `已向 ${agent.name} 发送催办消息：\n\n${task.title}`,
        [{ text: '确定' }]
      );
    }
  };

  // 统计数据
  const activeAgents = agents.filter(a => a.status !== 'terminated');
  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const doneTasks = tasks.filter(t => t.status === 'done');
  const pendingApprovals = approvals.filter(a => a.status === 'pending');

  // Tab 渲染
  const renderTabs = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
      {[
        { id: 'overview', label: '概览', icon: '📊' },
        { id: 'goals', label: '目标', icon: '🎯' },
        { id: 'tasks', label: '任务', icon: '✅' },
        { id: 'kpis', label: 'KPI', icon: '📈' },
        { id: 'approvals', label: '审批', icon: '📋', badge: pendingApprovals.length },
        { id: 'budget', label: '预算', icon: '💰' },
      ].map(tab => (
        <TouchableOpacity
          key={tab.id}
          style={[styles.tab, activeTab === tab.id && styles.tabActive]}
          onPress={() => setActiveTab(tab.id as TabType)}
        >
          <Text style={styles.tabIcon}>{tab.icon}</Text>
          <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
            {tab.label}
          </Text>
          {tab.badge ? (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{tab.badge}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // 概览视图
  const renderOverview = () => (
    <View>
      {/* 团队概览 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👥 团队概览</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{activeAgents.length}</Text>
            <Text style={styles.statLabel}>在职成员</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{agents.length}</Text>
            <Text style={styles.statLabel}>总人数</Text>
          </View>
        </View>
      </View>

      {/* Token 使用 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🪙 Token 使用</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{formatNumber(tokenUsage.total)}</Text>
            <Text style={styles.statLabel}>累计消耗</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{formatNumber(budgetConfig.globalDailyLimit)}</Text>
            <Text style={styles.statLabel}>每日预算</Text>
          </View>
        </View>
      </View>

      {/* 任务看板 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📋 任务看板</Text>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, styles.todoCard]}>
            <Text style={styles.statNumber}>{pendingTasks.length}</Text>
            <Text style={styles.statLabel}>待办</Text>
          </View>
          <View style={[styles.statCard, styles.progressCard]}>
            <Text style={styles.statNumber}>{inProgressTasks.length}</Text>
            <Text style={styles.statLabel}>进行中</Text>
          </View>
          <View style={[styles.statCard, styles.doneCard]}>
            <Text style={styles.statNumber}>{doneTasks.length}</Text>
            <Text style={styles.statLabel}>已完成</Text>
          </View>
        </View>
      </View>

      {/* 目标进度 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🎯 目标进度</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{activeGoals.length}</Text>
            <Text style={styles.statLabel}>进行中</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{completedGoals.length}</Text>
            <Text style={styles.statLabel}>已完成</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{kpis.length}</Text>
            <Text style={styles.statLabel}>KPI</Text>
          </View>
        </View>
      </View>

      {/* 待处理审批 */}
      {pendingApprovals.length > 0 && (
        <View style={[styles.section, styles.alertSection]}>
          <Text style={styles.sectionTitle}>⚠️ 待处理审批</Text>
          <Text style={styles.alertText}>{pendingApprovals.length} 个审批等待处理</Text>
          <TouchableOpacity
            style={styles.alertButton}
            onPress={() => setActiveTab('approvals')}
          >
            <Text style={styles.alertButtonText}>前往处理</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // 目标列表
  const renderGoals = () => (
    <View>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => { setAddType('goal'); setShowAddModal(true); }}
      >
        <Text style={styles.addButtonText}>+ 添加目标</Text>
      </TouchableOpacity>

      {goals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎯</Text>
          <Text style={styles.emptyText}>暂无目标</Text>
          <Text style={styles.emptyHint}>点击上方按钮添加</Text>
        </View>
      ) : (
        goals.map(goal => (
          <TouchableOpacity
            key={goal.id}
            style={styles.itemCard}
            onPress={() => setSelectedGoal(goal)}
          >
            <View style={styles.itemHeader}>
              <Text style={styles.itemTitle} numberOfLines={1}>{goal.title}</Text>
              <View style={[styles.statusBadge, goal.status === 'completed' ? styles.statusDone : styles.statusActive]}>
                <Text style={styles.statusText}>
                  {goal.status === 'completed' ? '已完成' : '进行中'}
                </Text>
              </View>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${goal.progress}%` }]} />
            </View>
            <View style={styles.itemMeta}>
              <Text style={styles.metaText}>负责人: {goal.owner}</Text>
              <Text style={styles.metaText}>{goal.progress}%</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );

  // 任务列表
  const renderTasks = () => (
    <View>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => { setAddType('task'); setShowAddModal(true); }}
      >
        <Text style={styles.addButtonText}>+ 添加任务</Text>
      </TouchableOpacity>

      {tasks.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>暂无任务</Text>
        </View>
      ) : (
        <>
          {/* 待办 */}
          {pendingTasks.length > 0 && (
            <View style={styles.taskGroup}>
              <Text style={styles.taskGroupTitle}>待办 ({pendingTasks.length})</Text>
              {pendingTasks.map(task => renderTaskItem(task))}
            </View>
          )}

          {/* 进行中 */}
          {inProgressTasks.length > 0 && (
            <View style={styles.taskGroup}>
              <Text style={styles.taskGroupTitle}>进行中 ({inProgressTasks.length})</Text>
              {inProgressTasks.map(task => renderTaskItem(task))}
            </View>
          )}

          {/* 已完成 */}
          {doneTasks.length > 0 && (
            <View style={styles.taskGroup}>
              <Text style={styles.taskGroupTitle}>已完成 ({doneTasks.length})</Text>
              {doneTasks.slice(0, 5).map(task => renderTaskItem(task))}
            </View>
          )}
        </>
      )}
    </View>
  );

  const renderTaskItem = (task: Task) => {
    const showUrgeButton = task.status === 'pending' || task.status === 'in_progress';
    const agent = agents.find(a => a.id === task.assignee);
    const assigneeName = agent?.name || task.assignee;

    return (
      <View key={task.id} style={styles.taskItemContainer}>
        <TouchableOpacity
          style={styles.taskItem}
          onPress={() => setSelectedTask(task)}
        >
          <View style={[styles.priorityDot, 
            task.priority === 'high' ? styles.priorityHigh :
            task.priority === 'medium' ? styles.priorityMedium : styles.priorityLow
          ]} />
          <View style={styles.taskInfo}>
            <Text style={[styles.taskTitle, task.status === 'done' && styles.taskDone]} numberOfLines={1}>
              {task.title}
            </Text>
            <Text style={styles.taskMeta}>执行人: {assigneeName}</Text>
          </View>
        </TouchableOpacity>
        {showUrgeButton && (
          <TouchableOpacity
            style={styles.urgeButton}
            onPress={() => handleUrgeTask(task)}
          >
            <Text style={styles.urgeButtonText}>催办</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // KPI 列表
  const renderKPIs = () => (
    <View>
      {kpis.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📈</Text>
          <Text style={styles.emptyText}>暂无 KPI</Text>
          <Text style={styles.emptyHint}>通过与 CXO 对话创建</Text>
        </View>
      ) : (
        kpis.map(kpi => (
          <View key={kpi.id} style={styles.kpiCard}>
            <View style={styles.kpiHeader}>
              <Text style={styles.kpiName}>{kpi.name}</Text>
              <Text style={styles.kpiProgress}>{kpi.progress}</Text>
            </View>
            <View style={styles.kpiValues}>
              <Text style={styles.kpiCurrent}>{kpi.current}</Text>
              <Text style={styles.kpiTarget}>/ {kpi.target}</Text>
            </View>
            <Text style={styles.kpiOwner}>负责人: {kpi.owner}</Text>
          </View>
        ))
      )}
    </View>
  );

  // 审批列表
  const renderApprovals = () => (
    <View>
      {approvals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>暂无审批</Text>
        </View>
      ) : (
        <>
          {/* 待处理 */}
          {pendingApprovals.length > 0 && (
            <View style={styles.taskGroup}>
              <Text style={styles.taskGroupTitle}>待处理 ({pendingApprovals.length})</Text>
              {pendingApprovals.map(approval => (
                <View key={approval.id} style={styles.approvalCard}>
                  <View style={styles.approvalHeader}>
                    <Text style={styles.approvalType}>
                      {approval.type === 'recruit' ? '🧑‍💼 招聘' :
                       approval.type === 'terminate' ? '⚠️ 开除' : '💰 预算'}
                    </Text>
                    <Text style={styles.approvalDate}>
                      {new Date(approval.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.approvalTitle}>{approval.title}</Text>
                  <Text style={styles.approvalDesc}>{approval.description}</Text>
                  <Text style={styles.approvalRequester}>申请人: {approval.requester}</Text>
                  <View style={styles.approvalActions}>
                    <TouchableOpacity
                      style={[styles.approvalBtn, styles.rejectBtn]}
                      onPress={() => handleApproval(approval.id, false)}
                    >
                      <Text style={styles.approvalBtnText}>拒绝</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approvalBtn, styles.approveBtn]}
                      onPress={() => handleApproval(approval.id, true)}
                    >
                      <Text style={styles.approvalBtnText}>批准</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 已处理 */}
          {approvals.filter(a => a.status !== 'pending').length > 0 && (
            <View style={styles.taskGroup}>
              <Text style={styles.taskGroupTitle}>已处理</Text>
              {approvals.filter(a => a.status !== 'pending').map(approval => (
                <View key={approval.id} style={[styles.approvalCard, styles.processedCard]}>
                  <View style={styles.approvalHeader}>
                    <Text style={styles.approvalTitle}>{approval.title}</Text>
                    <Text style={[styles.approvalStatus,
                      approval.status === 'approved' ? styles.approvedStatus : styles.rejectedStatus
                    ]}>
                      {approval.status === 'approved' ? '✓ 已批准' : '✗ 已拒绝'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );

  // 预算管理
  const renderBudget = () => (
    <View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>💰 Token 预算</Text>
        <View style={styles.budgetCard}>
          <Text style={styles.budgetLabel}>每日全局限额</Text>
          <Text style={styles.budgetValue}>{formatNumber(budgetConfig.globalDailyLimit)}</Text>
        </View>
        <View style={styles.budgetCard}>
          <Text style={styles.budgetLabel}>累计消耗</Text>
          <Text style={styles.budgetValue}>{formatNumber(tokenUsage.total)}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👥 Agent 消耗排行</Text>
        {Object.entries(tokenUsage.byAgent)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 5)
          .map(([agentId, usage]) => {
            const agent = agents.find(a => a.id === agentId);
            const avatarSource = agent?.avatarThumb || agent?.avatar;
            return (
              <View key={agentId} style={styles.agentUsage}>
                {isImageAvatar(avatarSource) ? (
                  <Image
                    source={{ uri: avatarSource }}
                    style={styles.agentAvatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.agentAvatar}>{agent?.avatar || '👤'}</Text>
                )}
                <Text style={styles.agentName}>{agent?.name || agentId}</Text>
                <Text style={styles.agentTokens}>{formatNumber(usage as number)}</Text>
              </View>
            );
          })}
        {Object.keys(tokenUsage.byAgent).length === 0 && (
          <Text style={styles.emptyHint}>暂无使用记录</Text>
        )}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderTabs()}

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4f46e5" />
        }
      >
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'goals' && renderGoals()}
        {activeTab === 'tasks' && renderTasks()}
        {activeTab === 'kpis' && renderKPIs()}
        {activeTab === 'approvals' && renderApprovals()}
        {activeTab === 'budget' && renderBudget()}

        <View style={{ height: 50 }} />
      </ScrollView>

      {/* 目标详情 Modal */}
      <Modal
        visible={selectedGoal !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedGoal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>目标详情</Text>
            <Text style={styles.goalDetailTitle}>{selectedGoal?.title}</Text>
            {selectedGoal?.description && (
              <Text style={styles.goalDetailDesc}>{selectedGoal.description}</Text>
            )}
            <View style={styles.goalDetailRow}>
              <Text style={styles.goalDetailLabel}>负责人:</Text>
              <Text style={styles.goalDetailValue}>{selectedGoal?.owner}</Text>
            </View>
            <View style={styles.goalDetailRow}>
              <Text style={styles.goalDetailLabel}>当前进度:</Text>
              <Text style={styles.goalDetailValue}>{selectedGoal?.progress}%</Text>
            </View>

            <Text style={styles.modalLabel}>更新进度</Text>
            <View style={styles.progressButtons}>
              {[25, 50, 75, 100].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.progressBtn, selectedGoal?.progress === p && styles.progressBtnActive]}
                  onPress={() => selectedGoal && updateGoalProgress(selectedGoal.id, p)}
                >
                  <Text style={styles.progressBtnText}>{p}%</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setSelectedGoal(null)}
            >
              <Text style={styles.closeButtonText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 任务详情 Modal */}
      <Modal
        visible={selectedTask !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedTask(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>任务详情</Text>
            <Text style={styles.goalDetailTitle}>{selectedTask?.title}</Text>
            {selectedTask?.description && (
              <Text style={styles.goalDetailDesc}>{selectedTask.description}</Text>
            )}
            <View style={styles.goalDetailRow}>
              <Text style={styles.goalDetailLabel}>执行人:</Text>
              <Text style={styles.goalDetailValue}>{selectedTask?.assignee}</Text>
            </View>
            <View style={styles.goalDetailRow}>
              <Text style={styles.goalDetailLabel}>优先级:</Text>
              <Text style={styles.goalDetailValue}>
                {selectedTask?.priority === 'high' ? '🔴 高' :
                 selectedTask?.priority === 'medium' ? '🟡 中' : '⚪ 低'}
              </Text>
            </View>

            <Text style={styles.modalLabel}>更新状态</Text>
            <View style={styles.statusButtons}>
              <TouchableOpacity
                style={[styles.statusBtn, selectedTask?.status === 'pending' && styles.statusBtnActive]}
                onPress={() => selectedTask && updateTaskStatus(selectedTask.id, 'pending')}
              >
                <Text style={styles.statusBtnText}>待办</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusBtn, selectedTask?.status === 'in_progress' && styles.statusBtnActive]}
                onPress={() => selectedTask && updateTaskStatus(selectedTask.id, 'in_progress')}
              >
                <Text style={styles.statusBtnText}>进行中</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusBtn, selectedTask?.status === 'done' && styles.statusBtnActive]}
                onPress={() => selectedTask && updateTaskStatus(selectedTask.id, 'done')}
              >
                <Text style={styles.statusBtnText}>完成</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setSelectedTask(null)}
            >
              <Text style={styles.closeButtonText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 添加 Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              添加{addType === 'goal' ? '目标' : '任务'}
            </Text>

            <Text style={styles.modalLabel}>标题</Text>
            <TextInput
              style={styles.input}
              value={newItem.title}
              onChangeText={text => setNewItem({ ...newItem, title: text })}
              placeholder="输入标题"
              placeholderTextColor="#666"
            />

            <Text style={styles.modalLabel}>描述</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={newItem.description}
              onChangeText={text => setNewItem({ ...newItem, description: text })}
              placeholder="输入描述（可选）"
              placeholderTextColor="#666"
              multiline
              numberOfLines={3}
            />

            {addType === 'task' && (
              <>
                <Text style={styles.modalLabel}>优先级</Text>
                <View style={styles.priorityPicker}>
                  {(['high', 'medium', 'low'] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.priorityOption, newItem.priority === p && styles.priorityActive]}
                      onPress={() => setNewItem({ ...newItem, priority: p })}
                    >
                      <Text style={styles.priorityText}>
                        {p === 'high' ? '🔴 高' : p === 'medium' ? '🟡 中' : '⚪ 低'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.modalBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.confirmBtn]}
                onPress={handleAdd}
              >
                <Text style={styles.modalBtnText}>添加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 4,
    borderRadius: 20,
    backgroundColor: '#16213e',
  },
  tabActive: {
    backgroundColor: '#4f46e5',
  },
  tabIcon: {
    fontSize: 16,
  },
  tabLabel: {
    color: '#9ca3af',
    fontSize: 13,
    marginLeft: 6,
  },
  tabLabelActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  tabBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 12,
  },
  section: {
    backgroundColor: '#1a1a2e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4f46e5',
  },
  statLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
  },
  todoCard: { borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  progressCard: { borderLeftWidth: 3, borderLeftColor: '#3b82f6' },
  doneCard: { borderLeftWidth: 3, borderLeftColor: '#10b981' },
  alertSection: {
    backgroundColor: '#7f1d1d',
    borderColor: '#ef4444',
  },
  alertText: {
    color: '#fecaca',
    fontSize: 14,
  },
  alertButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  alertButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  addButton: {
    backgroundColor: '#4f46e5',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
  },
  addButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 15,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 15,
  },
  emptyHint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 4,
  },
  itemCard: {
    backgroundColor: '#1a1a2e',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: {
    backgroundColor: '#3b82f6',
  },
  statusDone: {
    backgroundColor: '#10b981',
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#2d2d44',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4f46e5',
    borderRadius: 3,
  },
  itemMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  metaText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  taskGroup: {
    marginBottom: 16,
  },
  taskGroupTitle: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  taskItemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  urgeButton: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 8,
  },
  urgeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  priorityHigh: { backgroundColor: '#ef4444' },
  priorityMedium: { backgroundColor: '#f59e0b' },
  priorityLow: { backgroundColor: '#6b7280' },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    color: '#fff',
    fontSize: 14,
  },
  taskDone: {
    color: '#6b7280',
    textDecorationLine: 'line-through',
  },
  taskMeta: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 2,
  },
  kpiCard: {
    backgroundColor: '#1a1a2e',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  kpiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kpiName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  kpiProgress: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: 'bold',
  },
  kpiValues: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 8,
  },
  kpiCurrent: {
    color: '#4f46e5',
    fontSize: 24,
    fontWeight: 'bold',
  },
  kpiTarget: {
    color: '#6b7280',
    fontSize: 16,
    marginLeft: 4,
  },
  kpiOwner: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },
  approvalCard: {
    backgroundColor: '#1a1a2e',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  processedCard: {
    borderColor: '#2d2d44',
    opacity: 0.7,
  },
  approvalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  approvalType: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: 'bold',
  },
  approvalDate: {
    color: '#6b7280',
    fontSize: 12,
  },
  approvalTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  approvalDesc: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 4,
  },
  approvalRequester: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 8,
  },
  approvalActions: {
    flexDirection: 'row',
    marginTop: 12,
  },
  approvalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  rejectBtn: {
    backgroundColor: '#374151',
  },
  approveBtn: {
    backgroundColor: '#10b981',
  },
  approvalBtnText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  approvalStatus: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  approvedStatus: {
    color: '#10b981',
  },
  rejectedStatus: {
    color: '#ef4444',
  },
  budgetCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
  },
  budgetLabel: {
    color: '#9ca3af',
    fontSize: 14,
  },
  budgetValue: {
    color: '#4f46e5',
    fontSize: 18,
    fontWeight: 'bold',
  },
  agentUsage: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  agentAvatar: {
    fontSize: 24,
    marginRight: 10,
    width: 32,
    textAlign: 'center',
  },
  agentAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
    backgroundColor: '#2d2d44',
  },
  agentName: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  agentTokens: {
    color: '#4f46e5',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalLabel: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 12,
    marginBottom: 6,
  },
  goalDetailTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  goalDetailDesc: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 8,
  },
  goalDetailRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  goalDetailLabel: {
    color: '#6b7280',
    fontSize: 13,
    marginRight: 8,
  },
  goalDetailValue: {
    color: '#fff',
    fontSize: 13,
  },
  progressButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressBtn: {
    flex: 1,
    backgroundColor: '#16213e',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  progressBtnActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  progressBtnText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  statusButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusBtn: {
    flex: 1,
    backgroundColor: '#16213e',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  statusBtnActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  statusBtnText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 13,
  },
  closeButton: {
    backgroundColor: '#374151',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  closeButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
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
  priorityPicker: {
    flexDirection: 'row',
  },
  priorityOption: {
    flex: 1,
    backgroundColor: '#16213e',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  priorityActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  priorityText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 13,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 20,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  cancelBtn: {
    backgroundColor: '#374151',
  },
  confirmBtn: {
    backgroundColor: '#4f46e5',
  },
  modalBtnText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});
