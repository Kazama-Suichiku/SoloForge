/**
 * Agent 间通信模块 - 移动端版
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

const DATA_DIR = path.join(process.cwd(), 'data');
const COMMUNICATION_FILE = path.join(DATA_DIR, 'communication.json');

class AgentCommunication {
  constructor() {
    this.messages = [];
    this.delegatedTasks = [];
    this._loadFromDisk();
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(COMMUNICATION_FILE)) {
        const data = JSON.parse(fs.readFileSync(COMMUNICATION_FILE, 'utf-8'));
        this.messages = data.messages || [];
        this.delegatedTasks = data.delegatedTasks || [];
      }
    } catch (err) {
      logger.warn('Failed to load communication data:', err.message);
    }
  }

  _saveToDisk() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(COMMUNICATION_FILE, JSON.stringify({
        messages: this.messages,
        delegatedTasks: this.delegatedTasks,
      }, null, 2));
    } catch (err) {
      logger.error('Failed to save communication data:', err.message);
    }
  }

  /**
   * 发送消息给其他 Agent（同步等待回复）
   */
  async sendMessage({ fromAgent, toAgent, message, conversationId, callChain = [], nestingDepth = 0 }) {
    const messageId = uuidv4();
    
    // 循环检测
    if (callChain.includes(toAgent)) {
      return {
        success: false,
        error: `检测到循环调用: ${callChain.join(' → ')} → ${toAgent}`,
      };
    }

    // 深度限制
    const MAX_DEPTH = 3;
    if (nestingDepth >= MAX_DEPTH) {
      return {
        success: false,
        error: `嵌套调用深度超过限制 (${MAX_DEPTH})，请简化协作流程`,
      };
    }

    const record = {
      id: messageId,
      fromAgent,
      toAgent,
      content: message,
      status: 'pending',
      createdAt: Date.now(),
      response: null,
    };
    this.messages.push(record);
    this._saveToDisk();

    try {
      // 延迟加载 chatManager 避免循环依赖
      const { chatManager } = require('../chat');
      
      const response = await chatManager.processAgentMessage({
        fromAgent,
        toAgent,
        message,
        conversationId,
        callChain: [...callChain, fromAgent],
        nestingDepth: nestingDepth + 1,
      });

      record.status = 'completed';
      record.response = response;
      record.completedAt = Date.now();
      this._saveToDisk();

      return {
        success: true,
        messageId,
        response,
      };
    } catch (error) {
      record.status = 'failed';
      record.error = error.message;
      this._saveToDisk();

      return {
        success: false,
        messageId,
        error: error.message,
      };
    }
  }

  /**
   * 委派任务给其他 Agent
   */
  async delegateTask({ fromAgent, toAgent, taskDescription, priority = 3, waitForResult = true, conversationId }) {
    const taskId = uuidv4();
    
    const task = {
      id: taskId,
      fromAgent,
      toAgent,
      taskDescription,
      priority,
      status: 'pending',
      createdAt: Date.now(),
      result: null,
    };
    this.delegatedTasks.push(task);
    this._saveToDisk();

    if (waitForResult) {
      try {
        const { chatManager } = require('../chat');
        
        task.status = 'in_progress';
        this._saveToDisk();

        const response = await chatManager.processAgentMessage({
          fromAgent,
          toAgent,
          message: `[委派任务] ${taskDescription}`,
          conversationId,
          isTask: true,
          taskId,
        });

        task.status = 'completed';
        task.result = response;
        task.completedAt = Date.now();
        this._saveToDisk();

        return {
          success: true,
          taskId,
          result: response,
        };
      } catch (error) {
        task.status = 'failed';
        task.error = error.message;
        this._saveToDisk();

        return {
          success: false,
          taskId,
          error: error.message,
        };
      }
    } else {
      // 异步执行
      setImmediate(async () => {
        try {
          const { chatManager } = require('../chat');
          
          task.status = 'in_progress';
          this._saveToDisk();

          const response = await chatManager.processAgentMessage({
            fromAgent,
            toAgent,
            message: `[委派任务] ${taskDescription}`,
            conversationId,
            isTask: true,
            taskId,
          });

          task.status = 'completed';
          task.result = response;
          task.completedAt = Date.now();
          this._saveToDisk();
        } catch (error) {
          task.status = 'failed';
          task.error = error.message;
          this._saveToDisk();
        }
      });

      return {
        success: true,
        taskId,
        status: 'queued',
      };
    }
  }

  /**
   * 获取消息记录
   */
  getMessages(agentId, options = {}) {
    const { limit = 50 } = options;
    return this.messages
      .filter((m) => m.fromAgent === agentId || m.toAgent === agentId)
      .slice(-limit);
  }

  /**
   * 获取任务列表
   */
  getTasks(agentId, options = {}) {
    const { type = 'all', status } = options;
    
    let tasks = this.delegatedTasks.filter((t) => {
      if (type === 'received') return t.toAgent === agentId;
      if (type === 'assigned') return t.fromAgent === agentId;
      return t.fromAgent === agentId || t.toAgent === agentId;
    });

    if (status) {
      tasks = tasks.filter((t) => t.status === status);
    }

    return tasks;
  }

  /**
   * 更新任务
   */
  updateTask(taskId, updates) {
    const task = this.delegatedTasks.find((t) => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
      this._saveToDisk();
    }
  }

  /**
   * 获取协作统计
   */
  getStats(agentId) {
    const messages = this.getMessages(agentId);
    const tasks = this.getTasks(agentId);

    return {
      messages: {
        sent: messages.filter((m) => m.fromAgent === agentId).length,
        received: messages.filter((m) => m.toAgent === agentId).length,
      },
      tasks: {
        assigned: tasks.filter((t) => t.fromAgent === agentId).length,
        received: tasks.filter((t) => t.toAgent === agentId).length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        pending: tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
      },
    };
  }

  /**
   * 清理 Agent 队列（停职时使用）
   */
  clearAgentQueues(agentId) {
    // 取消该 Agent 的待处理任务
    this.delegatedTasks
      .filter((t) => t.toAgent === agentId && (t.status === 'pending' || t.status === 'in_progress'))
      .forEach((t) => {
        t.status = 'cancelled';
        t.cancelReason = 'Agent 已停职';
      });
    this._saveToDisk();
  }
}

const agentCommunication = new AgentCommunication();

module.exports = { AgentCommunication, agentCommunication };
