/**
 * SoloForge - 公司数据存储
 * 管理某账号下的公司列表
 * @module account/company-store
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { SOLOFORGE_ROOT } = require('./data-path');

class CompanyStore {
  constructor() {
    this._accountId = null;
    this.companies = [];
  }

  _getFilePath() {
    if (!this._accountId) return null;
    return path.join(SOLOFORGE_ROOT, 'data', this._accountId, 'companies.json');
  }

  _ensureDir() {
    if (!this._accountId) return;
    const dir = path.join(SOLOFORGE_ROOT, 'data', this._accountId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initialize for a specific account
   * @param {string} accountId
   */
  initForAccount(accountId) {
    this._accountId = accountId;
    this.companies = this._loadFromDisk();
  }

  _loadFromDisk() {
    try {
      const filePath = this._getFilePath();
      if (filePath && fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        logger.info('公司列表已加载', { accountId: this._accountId, count: data.length });
        return data;
      }
    } catch (error) {
      logger.error('加载公司列表失败', error);
    }
    return [];
  }

  _saveToDisk() {
    try {
      this._ensureDir();
      const filePath = this._getFilePath();
      if (filePath) {
        fs.writeFileSync(filePath, JSON.stringify(this.companies, null, 2), 'utf-8');
      }
    } catch (error) {
      logger.error('保存公司列表失败', error);
    }
  }

  /**
   * Create a new company
   * @param {string} name
   * @param {string} [description]
   * @returns {{success: boolean, companyId?: string, company?: Object, error?: string}}
   */
  createCompany(name, description = '') {
    if (!this._accountId) {
      return { success: false, error: '未设置账号上下文' };
    }
    if (!name || name.trim().length === 0) {
      return { success: false, error: '公司名称不能为空' };
    }

    const existing = this.companies.find(c => c.name === name);
    if (existing) {
      return { success: false, error: '公司名称已存在' };
    }

    const companyId = `comp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const company = {
      id: companyId,
      name: name.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.companies.push(company);
    this._saveToDisk();

    // Create company data directory
    const companyDir = path.join(SOLOFORGE_ROOT, 'data', this._accountId, companyId);
    if (!fs.existsSync(companyDir)) {
      fs.mkdirSync(companyDir, { recursive: true });
    }

    logger.info('公司已创建', { companyId, name });
    return { success: true, companyId, company };
  }

  /**
   * Get all companies for current account
   * @returns {Array}
   */
  getCompanies() {
    return [...this.companies];
  }

  /**
   * Get company by ID
   * @param {string} companyId
   * @returns {Object|null}
   */
  getCompany(companyId) {
    return this.companies.find(c => c.id === companyId) || null;
  }

  /**
   * Update company
   * @param {string} companyId
   * @param {Object} data - { name?, description? }
   * @returns {{success: boolean, company?: Object, error?: string}}
   */
  updateCompany(companyId, data) {
    const company = this.companies.find(c => c.id === companyId);
    if (!company) {
      return { success: false, error: '公司不存在' };
    }

    if (data.name !== undefined) company.name = data.name.trim();
    if (data.description !== undefined) company.description = data.description.trim();
    company.updatedAt = new Date().toISOString();

    this._saveToDisk();
    logger.info('公司已更新', { companyId });
    return { success: true, company };
  }

  /**
   * Delete company
   * @param {string} companyId
   * @returns {{success: boolean, error?: string}}
   */
  deleteCompany(companyId) {
    const idx = this.companies.findIndex(c => c.id === companyId);
    if (idx === -1) {
      return { success: false, error: '公司不存在' };
    }

    this.companies.splice(idx, 1);
    this._saveToDisk();

    // Note: company data directory is NOT deleted here for safety
    // It can be cleaned up manually later
    logger.info('公司已删除', { companyId });
    return { success: true };
  }
}

const companyStore = new CompanyStore();

module.exports = { CompanyStore, companyStore };
