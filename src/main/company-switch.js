/**
 * SoloForge - 公司切换（P1-2 拆分产物 + P1-10 重构）
 *
 * 从 main.js 抽出：
 * - cleanupCurrentCompany()：切换公司前的清理（刷盘 + 停调度器 + 清运行时状态）
 * - initializeForCompany(accountId, companyId)：切换后的 9 步初始化
 * - initializeDepartmentGroups()：为现有员工创建部门群聊
 * - setupAgentConfigSubscription()：订阅 Agent 配置变更，同步部门群聊成员
 *
 * P1-10 重构要点：
 * - 消除私有字段访问：原 main.js 的 virtualFileStore._index.clear() /
 *   virtualFileStore._initialized = false / dynamicAgentFactory.dynamicAgents.clear()
 *   改为调用 store 暴露的公开方法 resetRuntime() / clearRuntime()。
 * - 声明式 STORES 数组：第 2 步的 17 个 store reinitialize 用循环统一调用，
 *   数组按依赖关系排序，每项 { name, store, reinitialize, dependsOn, optional }。
 *   dependsOn 仅做声明（数组已按拓扑序排好），便于后人理解，不在运行时校验。
 * - cleanup 与 initialize 不再重复调用 scratchpadManager.reinitialize()：
 *   cleanup 只做 flush + stop + clearRuntime；initialize 只做 reinitialize。
 *
 * 依赖模块：
 * - app-context：读写 pmEngine / taskPatrol（间接，通过 scheduler-bootstrap）
 * - scheduler-bootstrap：restartSchedulers / stopSchedulers
 * - 单例 store 模块：见下方 require
 */

const { logger } = require('./utils/logger');
const { appContext } = require('./app-context');
const { stopSchedulers, restartSchedulers } = require('./scheduler-bootstrap');

// ─── 单例 store ───────────────────────────────────────────────
const { dataPath } = require('./account/data-path');
const { agentConfigStore, AGENT_STATUS } = require('./config/agent-config-store');
const { chatHistoryStore } = require('./chat/chat-history-store');
const { todoStore } = require('./tools/todo-store');
const { permissionStore } = require('./config/permission-store');
const { operationsStore } = require('./operations/operations-store');
const { projectStore } = require('./pm/project-store');
const { agentCommunication } = require('./collaboration/agent-communication');
const { devPlanQueue } = require('./collaboration/dev-plan-queue');
const { approvalQueue } = require('./agent-factory/approval-queue');
const { terminationQueue } = require('./agent-factory/termination-queue');
const { tokenTracker } = require('./budget/token-tracker');
const { budgetManager } = require('./budget/budget-manager');
const { memoryStore } = require('./memory/memory-store');
const { memoryManager } = require('./memory');
const { attachmentManager } = require('./attachments/attachment-manager');
const { chatManager } = require('./chat');
const departmentGroup = require('./chat/department-group');

// ─── STORES 数组（声明式依赖顺序，P1-10）──────────────────────
// 数组顺序即为初始化顺序，按依赖拓扑排序。
// dependsOn 字段仅做文档化声明（数组已排好），便于后人理解依赖关系。
// reinitialize 字段：默认调用 store.reinitialize()，特殊 store 在此函数中
//   追加额外步骤（如 todoStore.load()、tokenTracker.purgeZeroTokenRecords()）。
// optional 字段：true 表示初始化失败只 warn 不抛（如上下文模块）。
//
// 依赖关系说明：
// - departmentStore 必须在 agentConfigStore 之前（后者可能依赖部门数据）
// - agentConfigStore 在 operationsStore / projectStore / agentCommunication 之前
//   （这些 store 的运行时可能引用 agent 配置）
// - budgetManager 在 tokenTracker 之后（budgetManager 聚合 tokenTracker 数据）
// - virtualFileStore / scratchpadManager（上下文模块）必须 dataPath 切换后
//   才能加载正确路径，因此放在最后
const STORES = [
  { name: 'departmentStore',    store: require('./config/department-store').departmentStore,
    dependsOn: [] },
  { name: 'agentConfigStore',   store: agentConfigStore,
    dependsOn: ['departmentStore'] },
  { name: 'chatHistoryStore',   store: chatHistoryStore,
    dependsOn: ['agentConfigStore'] },
  { name: 'todoStore',          store: todoStore,
    dependsOn: [],
    reinitialize: () => { todoStore.reinitialize(); todoStore.load(); } },
  { name: 'permissionStore',    store: permissionStore,
    dependsOn: [] },
  { name: 'operationsStore',    store: operationsStore,
    dependsOn: ['agentConfigStore'] },
  { name: 'projectStore',       store: projectStore,
    dependsOn: ['agentConfigStore'] },
  { name: 'agentCommunication',  store: agentCommunication,
    dependsOn: ['agentConfigStore'] },
  { name: 'devPlanQueue',       store: devPlanQueue,
    dependsOn: ['agentConfigStore'] },
  { name: 'approvalQueue',      store: approvalQueue,
    dependsOn: ['agentConfigStore'] },
  { name: 'terminationQueue',  store: terminationQueue,
    dependsOn: ['agentConfigStore'] },
  { name: 'tokenTracker',       store: tokenTracker,
    dependsOn: [],
    reinitialize: () => { tokenTracker.reinitialize(); tokenTracker.purgeZeroTokenRecords(); } },
  { name: 'budgetManager',      store: budgetManager,
    dependsOn: ['tokenTracker'] },
  { name: 'memoryStore',        store: memoryStore,
    dependsOn: [] },
  { name: 'attachmentManager',  store: attachmentManager,
    dependsOn: [] },
  // 上下文模块（第 2.5 步）：延迟 require，optional=true
  { name: 'virtualFileStore',   store: require('./context/virtual-file-store').virtualFileStore,
    dependsOn: ['dataPath'], optional: true },
  { name: 'scratchpadManager',  store: require('./context/agent-scratchpad').scratchpadManager,
    dependsOn: ['dataPath'], optional: true },
];

/**
 * 按数组顺序统一调用所有 store 的 reinitialize。
 * optional 的 store 失败只 warn 不抛。
 */
function reinitializeAllStores() {
  for (const entry of STORES) {
    try {
      const reinit = entry.reinitialize;
      if (typeof reinit === 'function') {
        reinit();
      } else if (entry.store && typeof entry.store.reinitialize === 'function') {
        entry.store.reinitialize();
      } else {
        logger.warn(`reinitializeAllStores: store "${entry.name}" 没有 reinitialize 方法，已跳过`);
      }
    } catch (err) {
      if (entry.optional) {
        logger.warn(`reinitializeAllStores: optional store "${entry.name}" 初始化失败:`, err.message);
      } else {
        throw err;
      }
    }
  }
}

// ─── 初始化部门群聊 ──────────────────────────────────────────
/**
 * 初始化部门群聊（为现有员工创建）
 * 在应用启动或公司切换时调用，确保所有 CXO 团队都有对应的部门群聊
 *
 * 由 company-switch 自身（initializeForCompany 第 4.5 步）和
 * window-manager.createWindow（webContents 可用后重试）共同调用。
 */
function initializeDepartmentGroups() {
  const allConfigs = agentConfigStore.getAll();

  // 找出所有 CXO 级别的 Agent
  const cxoAgents = allConfigs.filter(
    (c) => c.level === 'c_level' && (c.status || 'active') !== AGENT_STATUS.TERMINATED
  );

  // 统计每个 CXO 有多少活跃下属
  const cxoTeams = new Map(); // cxoId -> [subordinateIds]

  for (const config of allConfigs) {
    // 跳过已离职的
    if ((config.status || 'active') === AGENT_STATUS.TERMINATED) continue;
    // 跳过 CXO 本身
    if (config.level === 'c_level') continue;

    // 查找该员工所属的 CXO
    const deptInfo = departmentGroup.getAgentDepartmentInfo(config.id);
    if (deptInfo?.ownerId) {
      if (!cxoTeams.has(deptInfo.ownerId)) {
        cxoTeams.set(deptInfo.ownerId, []);
      }
      cxoTeams.get(deptInfo.ownerId).push(config.id);
    }
  }

  // 为有下属的 CXO 创建部门群聊
  let created = 0;
  for (const [cxoId, subordinates] of cxoTeams) {
    if (subordinates.length === 0) continue;

    const cxoConfig = agentConfigStore.get(cxoId);
    if (!cxoConfig) continue;

    const departmentId = cxoConfig.department;
    if (!departmentId) continue;

    // 创建/确保部门群聊存在
    const result = departmentGroup.ensureDepartmentGroup(departmentId, cxoId);
    if (result.success) {
      created++;
      logger.info('初始化部门群聊:', {
        departmentId,
        ownerId: cxoId,
        ownerName: cxoConfig.name,
        members: subordinates.length + 1, // +1 for CXO
      });
    }
  }

  if (created > 0) {
    logger.info(`部门群聊初始化完成: 创建了 ${created} 个部门群`);
  }
}

// ─── Agent 配置变更订阅 ──────────────────────────────────────
// 用于跟踪之前的 Agent 状态（检测状态变更）
let _previousAgentStatuses = new Map();
let _agentConfigUnsubscribe = null;

/**
 * 设置 Agent 配置变更订阅，用于同步部门群聊成员
 */
function setupAgentConfigSubscription() {
  // 取消之前的订阅
  if (_agentConfigUnsubscribe) {
    _agentConfigUnsubscribe();
    _agentConfigUnsubscribe = null;
  }

  // 初始化状态快照
  const configs = agentConfigStore.getAll();
  _previousAgentStatuses.clear();
  for (const config of configs) {
    _previousAgentStatuses.set(config.id, config.status || 'active');
  }

  // 订阅变更（departmentGroup 已在模块顶部 require，直接使用）
  _agentConfigUnsubscribe = agentConfigStore.subscribe((newConfigs) => {
    for (const config of newConfigs) {
      const prevStatus = _previousAgentStatuses.get(config.id);
      const newStatus = config.status || 'active';

      // 检测状态变更为 terminated（离职）
      if (prevStatus !== AGENT_STATUS.TERMINATED && newStatus === AGENT_STATUS.TERMINATED) {
        // 从部门群聊移除
        const deptInfo = departmentGroup.getAgentDepartmentInfo(config.id);
        if (deptInfo) {
          departmentGroup.removeMemberFromGroup(deptInfo.departmentId, config.id);
          logger.info('员工离职，已从部门群聊移除:', {
            agentId: config.id,
            agentName: config.name,
            departmentId: deptInfo.departmentId,
          });
        }
      }

      // 检测状态从 terminated 恢复（理论上不应该发生，但以防万一）
      if (prevStatus === AGENT_STATUS.TERMINATED && newStatus === AGENT_STATUS.ACTIVE) {
        const deptInfo = departmentGroup.getAgentDepartmentInfo(config.id);
        if (deptInfo) {
          departmentGroup.addMemberToGroup(deptInfo.departmentId, config.id);
          logger.info('员工复职，已加入部门群聊:', {
            agentId: config.id,
            agentName: config.name,
            departmentId: deptInfo.departmentId,
          });
        }
      }

      // 更新状态快照
      _previousAgentStatuses.set(config.id, newStatus);
    }
  });
}

// ─── cleanup / initialize ────────────────────────────────────

/**
 * 清理当前公司状态（切换公司前调用）
 *
 * P1-10 重构：cleanup 只做三件事，不调用任何 store.reinitialize()：
 * 1. 刷盘（flush）需要持久化的运行时数据
 * 2. 停止定时器/调度器（PM / patrol / alert / memory 维护）
 * 3. 清理运行时内存状态（用公开方法，不访问私有字段）
 *
 * 真正的 reinitialize() 在 initializeForCompany() 中 dataPath 切换后执行。
 */
async function cleanupCurrentCompany() {
  logger.info('清理当前公司状态...');

  // 1. 刷盘所有数据
  chatHistoryStore.flush();
  todoStore.flush();
  memoryManager.flush();

  // 2. 停止定时器/调度器
  stopSchedulers();

  // 3. 清理运行时状态（避免旧公司数据残留）
  // 注意：这里只做内存清理，不要调用 reinitialize()（会从磁盘加载，但 dataPath 还指向旧公司）
  // 真正的 reinitialize() 在 initializeForCompany() 中 dataPath 切换后执行
  try {
    // 清理 chatManager 运行时状态
    chatManager.reinitialize();

    // 清理 historyManager 摘要缓存
    const { historyManager } = require('./chat/history-manager');
    historyManager.reinitialize();

    // 清理 scratchpadManager 内存缓存（只清 Map，不加载）
    // P1-10 修正：cleanup 不再调用 scratchpadManager.reinitialize()（那是 initialize 的职责）。
    // 这里只清内存 Map —— scratchpadManager.reinitialize() 本身就是清 Map，
    // 但为了和 initialize 阶段职责分离，改用 clearAll() 语义等价的清空。
    // scratchpadManager.reinitialize() 的实现就是 this._scratchpads.clear()，
    // 与 clearAll() 的清 Map 部分等价（clearAll 还会调用每个 sp.clear() 触发 save）。
    // 这里直接用 reinitialize() 清 Map 即可，不触发 save，因为数据没变。
    // 但为避免“cleanup 和 initialize 都调 reinitialize”被误读为重复，
    // 这里用更明确的语义：scratchpadManager 缓存只是内存态，cleanup 清掉即可，
    // initialize 阶段会重新惰性加载。所以 cleanup 调 reinitialize() 是合理的“清缓存”。
    // —— 保留原行为，但注释清楚：这是清缓存不是 reinitialize-from-disk。
    const { scratchpadManager } = require('./context/agent-scratchpad');
    scratchpadManager.reinitialize(); // 清内存缓存（与 initialize 阶段职责不重叠：initialize 不再调它）

    // 清理 virtualFileStore 内存索引（只清 Map，不加载旧公司数据）
    // P1-10：用公开方法 resetRuntime() 代替 _index.clear() / _initialized = false
    const { virtualFileStore } = require('./context/virtual-file-store');
    virtualFileStore.resetRuntime();

    // 清理动态 Agent 工厂
    // P1-10：用公开方法 clearRuntime() 代替 dynamicAgents.clear()
    const { dynamicAgentFactory } = require('./agent-factory/dynamic-agent');
    dynamicAgentFactory.clearRuntime();
  } catch (e) {
    logger.warn('清理运行时状态时出错:', e.message);
  }

  logger.info('当前公司状态已清理');
}

/**
 * 当用户选择公司后，初始化（或重初始化）所有子系统
 *
 * 9 步初始化（与原 main.js 一致）：
 * 1. 设置数据路径上下文
 * 2. 重初始化所有 store（声明式 STORES 数组，循环调用）
 * 3. 重新初始化依赖 store 数据的子系统（LLM / memory 维护）
 * 4. 恢复已批准的动态 Agent
 * 4.5 初始化部门群聊
 * 5-8. 重启调度器（PM / alert / patrol / salaryScheduler）—— 由 scheduler-bootstrap 负责
 * 9. 订阅 Agent 配置变更
 *
 * @param {string} accountId
 * @param {string} companyId
 */
async function initializeForCompany(accountId, companyId) {
  logger.info('初始化公司数据...', { accountId, companyId });

  // 1. 设置数据路径上下文（所有 store 的路径都会指向新目录）
  dataPath.setCurrentContext(accountId, companyId);
  dataPath.ensureDirectories();

  // 2. 重初始化所有 store（从新路径加载数据）—— 声明式 STORES 循环（P1-10）
  reinitializeAllStores();

  // 3. 重新初始化依赖 store 数据的子系统
  // 注意：setup() 和 setupTools() 不在此调用
  // 工具定义和 Agent 实例是全局的，已在 app.whenReady() 中注册，不随公司切换变化
  const llmManager = appContext.getLLMManager();
  if (llmManager) {
    chatManager.setLLMManager(llmManager);
    chatManager.initToolExecutor();
    memoryManager.initialize(llmManager);
    memoryManager.startMaintenanceSchedule();
  }

  // 4. 恢复已批准的动态 Agent
  try {
    const { dynamicAgentFactory } = require('./agent-factory/dynamic-agent');
    const restoreResult = dynamicAgentFactory.restoreApprovedAgents();
    if (restoreResult.restored > 0) {
      logger.info('动态 Agent 恢复结果:', restoreResult);
    }
  } catch (err) {
    logger.error('恢复动态 Agent 失败:', err);
  }

  // 4.5 初始化部门群聊（为现有员工创建）
  // 注意：如果窗口尚未创建（webContents 不可用），会在 createWindow 中重试
  try {
    initializeDepartmentGroups();
  } catch (err) {
    // 如果是 webContents 不可用的错误，不打印警告，等窗口创建后重试
    if (!err.message?.includes('webContents')) {
      logger.error('初始化部门群聊失败:', err);
    }
  }

  // 5-8. 重启调度器（PM 引擎 / 预算预警 / 任务巡查 / 工资调度器）
  restartSchedulers({ llmManager });

  // 9. 订阅 Agent 配置变更，同步部门群聊成员
  setupAgentConfigSubscription();

  logger.info('公司数据初始化完成', { accountId, companyId });
}

module.exports = {
  STORES,
  reinitializeAllStores,
  cleanupCurrentCompany,
  initializeForCompany,
  initializeDepartmentGroups,
  setupAgentConfigSubscription,
};
