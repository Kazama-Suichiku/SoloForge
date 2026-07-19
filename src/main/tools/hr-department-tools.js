/**
 * SoloForge - HR 部门与调岗相关工具
 *
 * 包含：部门列表/创建/更新/删除、调岗、多部门管理（添加/移除/设主部门）。
 * @module tools/hr-department-tools
 */

const {
  agentConfigStore,
  departmentStore,
  getAgentDepartments,
  logger,
} = require('./hr-shared');

// ═══════════════════════════════════════════════════════════════
// 部门管理工具
// ═══════════════════════════════════════════════════════════════

/**
 * 查看部门列表
 */
const hrListDepartmentsTool = {
  name: 'hr_list_departments',
  description: `查看公司所有部门信息，包括部门名称、颜色、负责人、成员数量等。`,
  category: 'hr',
  parameters: {},
  requiredPermissions: [],

  async execute() {
    const stats = departmentStore.getStats();
    
    const departments = stats.map(({ department, memberCount }) => ({
      id: department.id,
      name: department.name,
      color: department.color,
      description: department.description || '',
      headAgentId: department.headAgentId || null,
      memberCount,
      preset: department.preset || false,
      createdAt: department.createdAt,
    }));

    // 按成员数量排序
    departments.sort((a, b) => b.memberCount - a.memberCount);

    const totalMembers = departments.reduce((sum, d) => sum + d.memberCount, 0);

    return {
      success: true,
      totalDepartments: departments.length,
      totalMembers,
      departments,
      hint: '使用 hr_create_department 创建新部门，hr_update_department 修改部门信息',
    };
  },
};

/**
 * 创建新部门
 */
const hrCreateDepartmentTool = {
  name: 'hr_create_department',
  description: `创建一个新的部门。

部门 ID 规则：
- 必须以字母开头
- 仅包含小写字母、数字和下划线
- 长度 2-20 字符
- 不能与已有部门重复

示例：research_dev, customer_service, quality_assurance`,
  category: 'hr',
  parameters: {
    id: {
      type: 'string',
      description: '部门 ID（英文小写，如 research_dev）',
      required: true,
    },
    name: {
      type: 'string',
      description: '部门名称（中文显示名，如 "研发中心"）',
      required: true,
    },
    color: {
      type: 'string',
      description: '部门主题色（可选，hex 格式如 #3B82F6）',
      required: false,
    },
    description: {
      type: 'string',
      description: '部门职能描述（可选）',
      required: false,
    },
    head_agent_id: {
      type: 'string',
      description: '部门负责人 Agent ID（可选）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { id, name, color, description, head_agent_id } = args;

    // 如果指定了负责人，验证其存在
    if (head_agent_id) {
      const headAgent = agentConfigStore.get(head_agent_id);
      if (!headAgent) {
        return { success: false, error: `找不到 Agent: ${head_agent_id}` };
      }
      if ((headAgent.status || 'active') !== 'active') {
        return { success: false, error: `Agent ${head_agent_id} 不在职` };
      }
    }

    const result = departmentStore.create({
      id,
      name,
      color,
      description,
      headAgentId: head_agent_id,
    });

    if (!result.success) {
      return result;
    }

    logger.info('CHRO 创建新部门', { id, name });

    return {
      success: true,
      message: `已创建部门「${result.department.name}」`,
      department: result.department,
      nextStep: '可以使用 hr_transfer_agent 将员工调入新部门',
    };
  },
};

/**
 * 更新部门信息
 */
const hrUpdateDepartmentTool = {
  name: 'hr_update_department',
  description: `更新部门信息（名称、颜色、描述、负责人等）。

预设部门（如 tech, hr, finance）不可删除，但可以修改名称和颜色。`,
  category: 'hr',
  parameters: {
    department_id: {
      type: 'string',
      description: '部门 ID',
      required: true,
    },
    name: {
      type: 'string',
      description: '新的部门名称',
      required: false,
    },
    color: {
      type: 'string',
      description: '新的主题色（hex 格式）',
      required: false,
    },
    description: {
      type: 'string',
      description: '新的职能描述',
      required: false,
    },
    head_agent_id: {
      type: 'string',
      description: '新的部门负责人 Agent ID（传空字符串则清除负责人）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { department_id, name, color, description, head_agent_id } = args;

    if (!department_id) {
      return { success: false, error: '必须指定 department_id' };
    }

    // 如果指定了负责人，验证其存在
    if (head_agent_id && head_agent_id !== '') {
      const headAgent = agentConfigStore.get(head_agent_id);
      if (!headAgent) {
        return { success: false, error: `找不到 Agent: ${head_agent_id}` };
      }
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (description !== undefined) updates.description = description;
    if (head_agent_id !== undefined) updates.headAgentId = head_agent_id === '' ? null : head_agent_id;

    const result = departmentStore.update(department_id, updates);

    if (!result.success) {
      return result;
    }

    logger.info('CHRO 更新部门', { department_id, updates });

    return {
      success: true,
      message: `已更新部门「${result.department.name}」`,
      department: result.department,
    };
  },
};

/**
 * 删除部门
 */
const hrDeleteDepartmentTool = {
  name: 'hr_delete_department',
  description: `删除一个自定义部门。

注意：
- 预设部门（如 tech, hr, finance 等）不可删除
- 删除前必须确保部门内没有员工
- 建议先将员工调岗到其他部门`,
  category: 'hr',
  parameters: {
    department_id: {
      type: 'string',
      description: '要删除的部门 ID',
      required: true,
    },
    force: {
      type: 'boolean',
      description: '如果部门内有员工，是否强制删除（员工会被移到默认部门）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { department_id, force } = args;

    if (!department_id) {
      return { success: false, error: '必须指定 department_id' };
    }

    const dept = departmentStore.get(department_id);
    if (!dept) {
      return { success: false, error: `部门 "${department_id}" 不存在` };
    }

    // 检查部门内是否有员工
    const memberCount = departmentStore.getMemberCount(department_id);
    if (memberCount > 0 && !force) {
      return {
        success: false,
        error: `部门「${dept.name}」内还有 ${memberCount} 名员工，请先将他们调岗或使用 force=true 强制删除`,
        memberCount,
      };
    }

    // 如果强制删除，将员工移到 admin 部门
    if (memberCount > 0 && force) {
      const agents = agentConfigStore.getAll().filter(
        (a) => a.department?.toLowerCase() === department_id.toLowerCase() &&
               (a.status || 'active') !== 'terminated'
      );
      for (const agent of agents) {
        agentConfigStore.update(agent.id, { department: 'admin' });
      }
      logger.info(`强制删除部门，${agents.length} 名员工已移至行政部`);
    }

    const result = departmentStore.delete(department_id);

    if (!result.success) {
      return result;
    }

    logger.info('CHRO 删除部门', { department_id, name: dept.name });

    return {
      success: true,
      message: `已删除部门「${dept.name}」`,
      movedMembers: force ? memberCount : 0,
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 调岗工具
// ═══════════════════════════════════════════════════════════════

/**
 * 调岗工具
 */
const hrTransferAgentTool = {
  name: 'hr_transfer_agent',
  description: `将 Agent 调岗到其他部门或更换直属上级。

调岗会：
1. 记录调岗历史（可追溯）
2. 更新组织架构中的汇报关系
3. 如果有部门群聊，自动调整群成员

注意：此工具会将员工的主部门改为新部门。
- 如果是完全调岗，员工会从原部门移除
- 如果需要保留原部门（跨部门），请使用 hr_add_department

与 hr_update_agent 不同，调岗专门处理组织关系变更，会记录完整变动历史。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    new_department: {
      type: 'string',
      description: '新主部门 ID（如 tech, hr, finance）',
      required: false,
    },
    keep_old_department: {
      type: 'boolean',
      description: '是否保留原部门（设为 true 则变成跨部门员工，默认 false）',
      required: false,
    },
    new_reports_to: {
      type: 'string',
      description: '新直属上级的 Agent ID',
      required: false,
    },
    new_title: {
      type: 'string',
      description: '新职位头衔（可选）',
      required: false,
    },
    reason: {
      type: 'string',
      description: '调岗原因',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, new_department, keep_old_department, new_reports_to, new_title, reason } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定 agent_id' };
    }
    if (!reason) {
      return { success: false, error: '必须提供调岗原因' };
    }
    if (!new_department && !new_reports_to) {
      return { success: false, error: '必须指定新部门或新上级' };
    }

    const config = agentConfigStore.get(agent_id);
    if (!config) {
      return { success: false, error: `找不到 Agent: ${agent_id}` };
    }

    if ((config.status || 'active') !== 'active') {
      return { success: false, error: `Agent ${agent_id} 不在职` };
    }

    // 验证新部门
    if (new_department) {
      if (!departmentStore.exists(new_department)) {
        return {
          success: false,
          error: `无效的部门: ${new_department}`,
          validDepartments: departmentStore.getAll().map((d) => d.id),
        };
      }
    }

    // 验证新上级
    if (new_reports_to) {
      const supervisor = agentConfigStore.get(new_reports_to);
      if (!supervisor) {
        return { success: false, error: `找不到上级 Agent: ${new_reports_to}` };
      }
      if ((supervisor.status || 'active') !== 'active') {
        return { success: false, error: `上级 Agent ${new_reports_to} 不在职` };
      }
      // 防止循环汇报
      if (new_reports_to === agent_id) {
        return { success: false, error: '不能将自己设为自己的上级' };
      }
    }

    // 获取当前部门列表
    const oldDepartments = getAgentDepartments(config);
    const oldPrimaryDepartment = oldDepartments[0] || null;
    const oldReportsTo = config.reportsTo;
    const oldTitle = config.title;

    const updates = {};
    
    // 处理部门变更
    if (new_department) {
      const newDeptLower = new_department.toLowerCase();
      if (keep_old_department) {
        // 保留原部门，添加新部门为主部门
        let newDepts = [newDeptLower];
        for (const d of oldDepartments) {
          if (d !== newDeptLower) {
            newDepts.push(d);
          }
        }
        updates.departments = newDepts;
        updates.department = newDeptLower; // 兼容字段
      } else {
        // 完全调岗，只保留新部门
        updates.departments = [newDeptLower];
        updates.department = newDeptLower; // 兼容字段
      }
    }
    
    if (new_reports_to) updates.reportsTo = new_reports_to;
    if (new_title) updates.title = new_title;

    // 添加调岗记录
    const transferRecord = {
      date: new Date().toISOString(),
      type: 'transfer',
      fromDepartments: oldDepartments,
      toDepartments: updates.departments || oldDepartments,
      fromDepartment: oldPrimaryDepartment,
      toDepartment: new_department || oldPrimaryDepartment,
      fromReportsTo: oldReportsTo,
      toReportsTo: new_reports_to || oldReportsTo,
      fromTitle: oldTitle,
      toTitle: new_title || oldTitle,
      keepOldDepartment: keep_old_department || false,
      reason,
    };

    // 追加到变动历史
    const history = config.personnelHistory || [];
    history.push(transferRecord);
    updates.personnelHistory = history;

    const result = agentConfigStore.update(agent_id, updates);
    if (!result) {
      return { success: false, error: '更新失败' };
    }

    logger.info('Agent 调岗', { 
      agent_id, 
      oldDepartments, 
      newDepartments: updates.departments, 
      keepOld: keep_old_department,
      reason,
    });

    const changes = [];
    if (new_department && new_department !== oldPrimaryDepartment) {
      const oldDept = departmentStore.get(oldPrimaryDepartment);
      const newDept = departmentStore.get(new_department);
      if (keep_old_department) {
        changes.push(`主部门: ${oldDept?.name || oldPrimaryDepartment} → ${newDept?.name || new_department}（保留原部门）`);
      } else {
        changes.push(`部门: ${oldDept?.name || oldPrimaryDepartment} → ${newDept?.name || new_department}`);
      }
    }
    if (new_reports_to && new_reports_to !== oldReportsTo) {
      const oldSupervisor = agentConfigStore.get(oldReportsTo);
      const newSupervisor = agentConfigStore.get(new_reports_to);
      changes.push(`上级: ${oldSupervisor?.name || oldReportsTo || '无'} → ${newSupervisor?.name || new_reports_to}`);
    }
    if (new_title && new_title !== oldTitle) {
      changes.push(`职位: ${oldTitle} → ${new_title}`);
    }

    const finalConfig = agentConfigStore.get(agent_id);
    const finalDepts = getAgentDepartments(finalConfig);
    const finalDeptNames = finalDepts.map((d) => departmentStore.get(d)?.name || d).join('、');

    return {
      success: true,
      message: `已完成「${config.name}」的调岗`,
      agent: {
        id: agent_id,
        name: config.name,
        oldDepartments,
        newDepartments: finalDepts,
        departmentNames: finalDeptNames,
        isMultiDepartment: finalDepts.length > 1,
        oldReportsTo,
        newReportsTo: new_reports_to || oldReportsTo,
      },
      changes,
      note: keep_old_department 
        ? `员工现在属于 ${finalDepts.length} 个部门：${finalDeptNames}。部门群聊成员已自动同步。`
        : '部门群聊成员已自动同步。建议通知相关人员。',
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 多部门管理工具
// ═══════════════════════════════════════════════════════════════

/**
 * 给员工添加部门（兼职/跨部门）
 */
const hrAddDepartmentTool = {
  name: 'hr_add_department',
  description: `给员工添加一个额外的部门归属（跨部门/兼职）。

使用场景：
- 员工需要同时服务于多个部门
- 跨部门项目需要临时借调
- 员工承担多个岗位职责

员工可以属于多个部门，第一个部门为主部门。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    department_id: {
      type: 'string',
      description: '要添加的部门 ID',
      required: true,
    },
    reason: {
      type: 'string',
      description: '添加原因（如跨部门项目、临时借调等）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, department_id, reason } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定 agent_id' };
    }
    if (!department_id) {
      return { success: false, error: '必须指定 department_id' };
    }

    // 验证部门存在
    if (!departmentStore.exists(department_id)) {
      return {
        success: false,
        error: `无效的部门: ${department_id}`,
        validDepartments: departmentStore.getAll().map((d) => d.id),
      };
    }

    const result = agentConfigStore.addDepartment(agent_id, department_id.toLowerCase());
    
    if (!result.success) {
      return result;
    }

    const config = agentConfigStore.get(agent_id);
    const dept = departmentStore.get(department_id);
    const allDepts = getAgentDepartments(config);
    const deptNames = allDepts.map((d) => departmentStore.get(d)?.name || d).join('、');

    logger.info('HR 添加员工部门', { agent_id, department_id, reason });

    return {
      success: true,
      message: `已将「${config.name}」添加到「${dept.name}」部门`,
      agent: {
        id: agent_id,
        name: config.name,
        departments: allDepts,
        departmentNames: deptNames,
      },
      reason: reason || null,
      note: allDepts.length > 1 
        ? `该员工现在属于 ${allDepts.length} 个部门：${deptNames}` 
        : null,
    };
  },
};

/**
 * 从员工移除部门
 */
const hrRemoveDepartmentTool = {
  name: 'hr_remove_department',
  description: `从员工移除一个部门归属。

注意：
- 员工至少需要属于一个部门
- 如果只剩一个部门，不能移除
- 如果移除的是主部门，下一个部门会自动成为主部门`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    department_id: {
      type: 'string',
      description: '要移除的部门 ID',
      required: true,
    },
    reason: {
      type: 'string',
      description: '移除原因',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, department_id, reason } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定 agent_id' };
    }
    if (!department_id) {
      return { success: false, error: '必须指定 department_id' };
    }

    const result = agentConfigStore.removeDepartment(agent_id, department_id.toLowerCase());
    
    if (!result.success) {
      return result;
    }

    const config = agentConfigStore.get(agent_id);
    const dept = departmentStore.get(department_id);
    const allDepts = getAgentDepartments(config);
    const deptNames = allDepts.map((d) => departmentStore.get(d)?.name || d).join('、');

    logger.info('HR 移除员工部门', { agent_id, department_id, reason });

    return {
      success: true,
      message: `已将「${config.name}」从「${dept?.name || department_id}」部门移除`,
      agent: {
        id: agent_id,
        name: config.name,
        departments: allDepts,
        departmentNames: deptNames,
      },
      reason: reason || null,
    };
  },
};

/**
 * 设置员工的主部门
 */
const hrSetPrimaryDepartmentTool = {
  name: 'hr_set_primary_department',
  description: `设置员工的主部门（第一个部门）。

主部门影响：
- 在组织架构中的主要归属
- 汇报关系
- 默认显示

员工必须已经属于该部门才能设为主部门。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    department_id: {
      type: 'string',
      description: '要设为主部门的部门 ID',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, department_id } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定 agent_id' };
    }
    if (!department_id) {
      return { success: false, error: '必须指定 department_id' };
    }

    const result = agentConfigStore.setPrimaryDepartment(agent_id, department_id.toLowerCase());
    
    if (!result.success) {
      return result;
    }

    const config = agentConfigStore.get(agent_id);
    const dept = departmentStore.get(department_id);
    const allDepts = getAgentDepartments(config);
    const deptNames = allDepts.map((d) => departmentStore.get(d)?.name || d).join('、');

    logger.info('HR 设置员工主部门', { agent_id, department_id });

    return {
      success: true,
      message: `已将「${config.name}」的主部门设为「${dept?.name || department_id}」`,
      agent: {
        id: agent_id,
        name: config.name,
        primaryDepartment: department_id,
        departments: allDepts,
        departmentNames: deptNames,
      },
    };
  },
};

module.exports = {
  hrListDepartmentsTool,
  hrCreateDepartmentTool,
  hrUpdateDepartmentTool,
  hrDeleteDepartmentTool,
  hrTransferAgentTool,
  hrAddDepartmentTool,
  hrRemoveDepartmentTool,
  hrSetPrimaryDepartmentTool,
};
