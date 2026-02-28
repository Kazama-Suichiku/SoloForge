/**
 * CFO 控制台 - Token 统计、预算管理、薪资管理
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
} from 'react-native';
import { storage } from '../core/storage';
import { Agent } from '../core/config/agents';

interface TokenUsage {
  total: number;
  byAgent: Record<string, number>;
  daily?: Record<string, number>;
}

interface AgentSalary {
  agentId: string;
  agentName: string;
  agentTitle: string;
  dailySalary: number;
  balance: number;
  callCount: number;
  isOverdrawn: boolean;
}

const LEVEL_SALARIES: Record<string, number> = {
  c_level: 100000,
  director: 50000,
  manager: 30000,
  senior: 20000,
  employee: 10000,
  assistant: 5000,
  intern: 3000,
};

const LEVEL_NAMES: Record<string, string> = {
  c_level: 'C-Level 高管',
  director: '总监',
  manager: '经理',
  senior: '高级',
  employee: '员工',
  assistant: '助理',
  intern: '实习生',
};

export default function CFOScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ total: 0, byAgent: {} });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentSalaries, setAgentSalaries] = useState<AgentSalary[]>([]);
  const [activeTab, setActiveTab] = useState<'usage' | 'salary' | 'config'>('usage');
  const [salaryModal, setSalaryModal] = useState<{
    visible: boolean;
    type: 'salary' | 'bonus';
    agentId: string;
    agentName: string;
    currentValue: number;
  } | null>(null);
  const [modalValue, setModalValue] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [usage, allAgents] = await Promise.all([
        storage.getTokenUsage(),
        storage.getAgents(),
      ]);

      setTokenUsage(usage || { total: 0, byAgent: {} });
      
      const safeAgents = allAgents || [];
      const activeAgents = safeAgents.filter((a: Agent) => a.status !== 'terminated');
      setAgents(activeAgents);

      // 计算每个 Agent 的薪资信息
      const salaries: AgentSalary[] = activeAgents.map((agent: Agent) => {
        const usedTokens = usage?.byAgent?.[agent.id] || 0;
        // 优先使用 agent 中存储的薪资，否则使用职级默认值
        const dailySalary = (agent as any).salary?.dailySalary || LEVEL_SALARIES[agent.level] || 10000;
        const balance = dailySalary - usedTokens;
        
        return {
          agentId: agent.id,
          agentName: agent.name,
          agentTitle: agent.title,
          dailySalary,
          balance,
          callCount: Math.floor(usedTokens / 500), // 估算调用次数
          isOverdrawn: balance < 0,
        };
      });

      // 按使用量排序
      salaries.sort((a, b) => (b.dailySalary - b.balance) - (a.dailySalary - a.balance));
      setAgentSalaries(salaries);
    } catch (error) {
      console.error('加载 CFO 数据失败:', error);
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

  const getProgressColor = (percent: number, isOverdrawn: boolean) => {
    if (isOverdrawn) return '#dc2626';
    if (percent >= 100) return '#dc2626';
    if (percent >= 90) return '#f97316';
    if (percent >= 70) return '#eab308';
    return '#22c55e';
  };

  const handleAdjustSalary = (agent: AgentSalary) => {
    setSalaryModal({
      visible: true,
      type: 'salary',
      agentId: agent.agentId,
      agentName: agent.agentName,
      currentValue: agent.dailySalary,
    });
    setModalValue(agent.dailySalary.toString());
  };

  const handlePayBonus = (agent: AgentSalary) => {
    setSalaryModal({
      visible: true,
      type: 'bonus',
      agentId: agent.agentId,
      agentName: agent.agentName,
      currentValue: 10000,
    });
    setModalValue('10000');
  };

  const handleModalConfirm = async () => {
    if (!salaryModal) return;
    
    const value = parseInt(modalValue) || 0;
    if (value <= 0) {
      Alert.alert('错误', '请输入有效的数值');
      return;
    }

    try {
      // 获取当前 agents 数据
      const allAgents = await storage.getAgents();
      const agentIndex = allAgents.findIndex((a: Agent) => a.id === salaryModal.agentId);
      
      if (agentIndex === -1) {
        Alert.alert('错误', '找不到该员工');
        return;
      }

      if (salaryModal.type === 'bonus') {
        // 发放奖金：增加 balance
        const tokenUsage = await storage.getTokenUsage();
        const currentUsage = tokenUsage?.byAgent?.[salaryModal.agentId] || 0;
        // 奖金相当于减少已使用的 token（增加余额）
        const newUsage = Math.max(0, currentUsage - value);
        tokenUsage.byAgent = tokenUsage.byAgent || {};
        tokenUsage.byAgent[salaryModal.agentId] = newUsage;
        tokenUsage.total = Object.values(tokenUsage.byAgent).reduce((sum: number, v: any) => sum + (v as number), 0);
        await storage.setTokenUsage(tokenUsage);
        
        Alert.alert('成功', `已向 ${salaryModal.agentName} 发放 ${formatNumber(value)} tokens 奖金`);
      } else {
        // 调薪：更新 agent 的 salary 信息
        const agent = allAgents[agentIndex];
        agent.salary = agent.salary || { dailySalary: 10000, balance: 10000, isOverdrawn: false };
        agent.salary.dailySalary = value;
        
        await storage.setAgents(allAgents);
        
        Alert.alert('成功', `已将 ${salaryModal.agentName} 的日薪调整为 ${formatNumber(value)} tokens`);
      }
      
      // 关闭弹窗并刷新数据
      setSalaryModal(null);
      setModalValue('');
      loadData(); // 重新加载数据以更新进度条
    } catch (error) {
      console.error('操作失败:', error);
      Alert.alert('错误', '操作失败，请重试');
    }
  };

  const totalBudget = agentSalaries.reduce((sum, a) => sum + a.dailySalary, 0);
  const overdrawnCount = agentSalaries.filter(a => a.isOverdrawn).length;
  const dailyUsagePercent = totalBudget > 0 ? Math.round((tokenUsage.total / totalBudget) * 100) : 0;

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
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4f46e5" />
        }
      >
        {/* 标题 */}
        <View style={styles.header}>
          <Text style={styles.title}>💰 CFO 控制台</Text>
          <Text style={styles.subtitle}>Token 使用统计与工资管理</Text>
        </View>

        {/* 统计卡片 */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>总 Token 使用</Text>
            <Text style={styles.statValue}>{formatNumber(tokenUsage.total)}</Text>
            <Text style={styles.statSubtitle}>{Object.keys(tokenUsage.byAgent || {}).length} 位员工</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>每日预算</Text>
            <Text style={styles.statValue}>{formatNumber(totalBudget)}</Text>
            <Text style={styles.statSubtitle}>{agents.length} 位在职</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>透支员工</Text>
            <Text style={[styles.statValue, overdrawnCount > 0 && styles.warningText]}>
              {overdrawnCount}
            </Text>
            <Text style={styles.statSubtitle}>
              {overdrawnCount > 0 ? '需要关注' : '状态良好'}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>预算使用</Text>
            <Text style={styles.statValue}>{dailyUsagePercent}%</Text>
            <Text style={styles.statSubtitle}>每日限额</Text>
          </View>
        </View>

        {/* 标签页 */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'usage' && styles.tabActive]}
            onPress={() => setActiveTab('usage')}
          >
            <Text style={[styles.tabText, activeTab === 'usage' && styles.tabTextActive]}>
              员工使用
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'salary' && styles.tabActive]}
            onPress={() => setActiveTab('salary')}
          >
            <Text style={[styles.tabText, activeTab === 'salary' && styles.tabTextActive]}>
              工资配置
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'config' && styles.tabActive]}
            onPress={() => setActiveTab('config')}
          >
            <Text style={[styles.tabText, activeTab === 'config' && styles.tabTextActive]}>
              职级薪资
            </Text>
          </TouchableOpacity>
        </View>

        {/* 内容区 */}
        <View style={styles.content}>
          {activeTab === 'usage' && (
            <>
              <Text style={styles.sectionTitle}>员工余额与使用</Text>
              {agentSalaries.length > 0 ? (
                agentSalaries.map((agent) => {
                  const usedPercent = agent.dailySalary > 0
                    ? Math.round(((agent.dailySalary - agent.balance) / agent.dailySalary) * 100)
                    : 0;
                  
                  return (
                    <View key={agent.agentId} style={styles.employeeRow}>
                      <View style={styles.employeeHeader}>
                        <View style={styles.employeeInfo}>
                          <Text style={styles.employeeName}>{agent.agentName}</Text>
                          <Text style={styles.employeeTitle}>{agent.agentTitle}</Text>
                        </View>
                        <View style={styles.employeeStats}>
                          <Text style={[
                            styles.employeeBalance,
                            agent.isOverdrawn && styles.warningText
                          ]}>
                            {formatNumber(agent.balance)} / {formatNumber(agent.dailySalary)}
                          </Text>
                          {agent.isOverdrawn && (
                            <View style={styles.overdraftBadge}>
                              <Text style={styles.overdraftText}>透支</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={styles.progressBar}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${Math.min(Math.abs(usedPercent), 100)}%`,
                              backgroundColor: getProgressColor(usedPercent, agent.isOverdrawn),
                            },
                          ]}
                        />
                      </View>
                      <View style={styles.employeeActions}>
                        <Text style={styles.callCount}>{agent.callCount} 次调用</Text>
                        <View style={styles.actionButtons}>
                          <TouchableOpacity onPress={() => handleAdjustSalary(agent)}>
                            <Text style={styles.actionText}>调薪</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handlePayBonus(agent)}>
                            <Text style={[styles.actionText, styles.bonusText]}>发奖金</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>暂无数据</Text>
              )}
            </>
          )}

          {activeTab === 'salary' && (
            <>
              <Text style={styles.sectionTitle}>员工薪资一览</Text>
              {agentSalaries.map((agent) => (
                <View key={agent.agentId} style={styles.salaryRow}>
                  <View>
                    <Text style={styles.employeeName}>{agent.agentName}</Text>
                    <Text style={styles.employeeTitle}>{agent.agentTitle}</Text>
                  </View>
                  <Text style={styles.salaryValue}>
                    {formatNumber(agent.dailySalary)} / 日
                  </Text>
                </View>
              ))}
            </>
          )}

          {activeTab === 'config' && (
            <>
              <Text style={styles.sectionTitle}>职级默认日薪配置</Text>
              <Text style={styles.configNote}>
                修改后仅影响新入职员工
              </Text>
              {Object.entries(LEVEL_SALARIES).map(([level, salary]) => (
                <View key={level} style={styles.levelRow}>
                  <Text style={styles.levelName}>{LEVEL_NAMES[level] || level}</Text>
                  <Text style={styles.levelSalary}>{formatNumber(salary)}</Text>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      {/* 调薪/发奖金弹窗 */}
      <Modal
        visible={salaryModal?.visible || false}
        animationType="fade"
        transparent
        onRequestClose={() => setSalaryModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {salaryModal?.type === 'bonus' ? '发放奖金' : '调整日薪'}
            </Text>
            <Text style={styles.modalLabel}>员工</Text>
            <Text style={styles.modalAgentName}>{salaryModal?.agentName}</Text>
            <Text style={styles.modalLabel}>
              {salaryModal?.type === 'bonus' ? '奖金金额 (tokens)' : '新日薪 (tokens)'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={modalValue}
              onChangeText={setModalValue}
              keyboardType="numeric"
              placeholder="输入数值"
              placeholderTextColor="#666"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setSalaryModal(null)}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={handleModalConfirm}
              >
                <Text style={styles.modalConfirmText}>确认</Text>
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
  loadingText: {
    color: '#9ca3af',
    marginTop: 12,
  },
  header: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    margin: '1%',
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
  },
  statSubtitle: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  warningText: {
    color: '#dc2626',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#1a1a2e',
  },
  tabActive: {
    backgroundColor: '#4f46e5',
  },
  tabText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  content: {
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  employeeRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  employeeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  employeeInfo: {
    flex: 1,
  },
  employeeName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  employeeTitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  employeeStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  employeeBalance: {
    fontSize: 13,
    color: '#9ca3af',
  },
  overdraftBadge: {
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  overdraftText: {
    fontSize: 10,
    color: '#dc2626',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#2d2d44',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  employeeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  callCount: {
    fontSize: 11,
    color: '#6b7280',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  actionText: {
    fontSize: 12,
    color: '#4f46e5',
  },
  bonusText: {
    color: '#22c55e',
  },
  emptyText: {
    color: '#6b7280',
    textAlign: 'center',
    paddingVertical: 32,
  },
  salaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  salaryValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4f46e5',
  },
  configNote: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 16,
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  levelName: {
    fontSize: 14,
    color: '#d1d5db',
  },
  levelSalary: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  modalLabel: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 4,
  },
  modalAgentName: {
    fontSize: 15,
    color: '#fff',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#2d2d44',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  modalConfirmButton: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
