/**
 * SoloForge - 组织架构图组件
 * 可视化展示部门层级和汇报关系。Linear 风格：.card 节点 + rgba(255,255,255,0.1) 连接线。
 */
import { useState } from 'react';
import AgentAvatar from './AgentAvatar';
import { useAgentStore } from '../store/agent-store';

/** 连接线统一用半透明白色 */
const LINE_COLOR = 'rgba(255,255,255,0.1)';

/**
 * P2-5: 将 hex 颜色转为标准 rgba 字符串，避免 `${color}20` 字符串拼接 alpha
 * 兼容 #rgb / #rrggbb；alpha 为 0-1 浮点。
 */
function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 安全的部门 tint 色：hex 优先用 rgba，否则回退到中性半透明 */
function deptTint(color, alpha) {
  return hexToRgba(color, alpha) || 'rgba(255,255,255,0.04)';
}

/**
 * 人员节点组件
 */
function PersonNode({ config, level, dept, isLast, onClick, isSelected }) {
  return (
    <div className="relative flex items-start">
      {/* 连接线 */}
      <div className="flex flex-col items-center mr-3">
        {/* 垂直线（上半部分） */}
        <div className="w-px h-4" style={{ backgroundColor: LINE_COLOR }} />
        {/* 节点圆点 */}
        <div
          className="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0 z-10"
          style={{
            borderColor: dept.color || 'var(--text-tertiary)',
            backgroundColor: isSelected ? (dept.color || 'var(--accent)') : 'transparent',
          }}
        />
        {/* 垂直线（下半部分） */}
        {!isLast && <div className="w-px flex-1 min-h-[20px]" style={{ backgroundColor: LINE_COLOR }} />}
      </div>

      {/* 人员卡片：.card 类 */}
      <div
        onClick={onClick}
        className={`card flex-1 cursor-pointer mb-2 transition-colors ${
          isSelected ? '' : 'card-hover'
        }`}
        style={{
          borderColor: isSelected ? 'var(--accent)' : undefined,
          // P2-3: 选中态 border-color 160ms ease-out 过渡
          transition: 'border-color 160ms var(--ease-out)',
        }}
      >
        <div className="flex items-center gap-3">
          {/* 头像 */}
          <AgentAvatar
            avatar={config.avatar}
            fallback="👤"
            size="md"
            bgStyle={{ backgroundColor: deptTint(dept.color, 0.1) }}
            bgClass=""
          />

          {/* 信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-ui text-sm text-text-primary">
                {config.name}
              </span>
              <span
                className="px-1.5 py-0.5 text-xs rounded"
                style={{
                  backgroundColor: deptTint(dept.color, 0.08),
                  color: dept.color,
                }}
              >
                {level.name}
              </span>
              {/* 跨部门标记 */}
              {config.isMultiDepartment && !config.isPrimaryDepartment && (
                <span
                  className="px-1.5 py-0.5 text-xs rounded"
                  style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}
                >
                  兼职
                </span>
              )}
            </div>
            <div className="text-sm text-text-secondary truncate">
              {config.title}
            </div>
            {/* 显示其他部门 */}
            {config.isMultiDepartment && config.crossDepartments?.length > 0 && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--accent)' }}>
                {config.isPrimaryDepartment ? '兼任' : '主职'}：{config.crossDepartments.join('、')}
              </div>
            )}
          </div>

          {/* 编辑图标 */}
          <svg
            className="w-4 h-4 text-text-tertiary flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

/**
 * 部门卡片组件
 */
function DepartmentCard({ dept, members, levels, onSelectMember, selectedId }) {
  const [expanded, setExpanded] = useState(true);

  // 按职级排序（高到低）
  const sortedMembers = [...members].sort((a, b) => {
    const levelA = levels.find((l) => l.id === a.level)?.rank || 0;
    const levelB = levels.find((l) => l.id === b.level)?.rank || 0;
    return levelB - levelA;
  });

  // 找出部门负责人（最高职级）
  const leader = sortedMembers[0];
  const otherMembers = sortedMembers.slice(1);

  return (
    <div className="relative">
      {/* 部门头部 */}
      <div
        className="flex items-center gap-3 p-4 rounded-t-lg cursor-pointer"
        style={{ backgroundColor: deptTint(dept.color, 0.08) }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* 部门图标 */}
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center"
          style={{ backgroundColor: dept.color }}
        >
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        </div>

        {/* 部门信息 */}
        <div className="flex-1 min-w-0">
          <div className="font-ui text-text-primary truncate">
            {dept.name}
          </div>
          <div className="text-sm text-text-secondary">
            {members.length} 名成员
          </div>
        </div>

        {/* 展开/收起 */}
        <svg
          className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* 成员列表 */}
      {expanded && (
        <div
          className="border-l-2 border-b border-r rounded-b-lg p-4 bg-bg-surface"
          style={{ borderColor: 'var(--border-default)', borderLeftColor: dept.color }}
        >
          {/* 部门负责人 */}
          {leader && (
            <div className="mb-4">
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
                部门负责人
              </div>
              <div
                onClick={() => onSelectMember(leader)}
                className={`card cursor-pointer transition-colors ${selectedId === leader.id ? '' : 'card-hover'}`}
                style={{
                  borderColor: selectedId === leader.id ? 'var(--accent)' : undefined,
                  // P2-3: 选中态 border-color 160ms ease-out 过渡
                  transition: 'border-color 160ms var(--ease-out)',
                }}
              >
                <div className="flex items-center gap-4">
                  <AgentAvatar
                    avatar={leader.avatar}
                    fallback="👤"
                    size="xl"
                    bgStyle={{ backgroundColor: deptTint(dept.color, 0.1) }}
                    bgClass=""
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-ui text-text-primary">
                        {leader.name}
                      </span>
                      <span
                        className="px-2 py-0.5 text-xs rounded-full font-medium"
                        style={{ backgroundColor: dept.color, color: 'white' }}
                      >
                        {levels.find((l) => l.id === leader.level)?.name || leader.level}
                      </span>
                      {/* 跨部门标记 */}
                      {leader.isMultiDepartment && !leader.isPrimaryDepartment && (
                        <span
                          className="px-2 py-0.5 text-xs rounded-full"
                          style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}
                        >
                          兼职
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-text-secondary mt-0.5">
                      {leader.title}
                    </div>
                    {/* 显示其他部门 */}
                    {leader.isMultiDepartment && leader.crossDepartments?.length > 0 && (
                      <div className="text-xs mt-1" style={{ color: 'var(--accent)' }}>
                        {leader.isPrimaryDepartment ? '兼任' : '主职'}：{leader.crossDepartments.join('、')}
                      </div>
                    )}
                    {leader.description && (
                      <div className="text-xs text-text-tertiary mt-1">
                        {leader.description}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 其他成员 */}
          {otherMembers.length > 0 && (
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                团队成员
                {leader && (
                  <span className="text-text-tertiary">
                    → 向 {leader.name} 汇报
                  </span>
                )}
              </div>
              <div className="pl-3 border-l-2" style={{ borderColor: LINE_COLOR }}>
                {otherMembers.map((member, index) => (
                  <PersonNode
                    key={member.id}
                    config={member}
                    level={levels.find((l) => l.id === member.level) || { name: member.level }}
                    dept={dept}
                    isLast={index === otherMembers.length - 1}
                    onClick={() => onSelectMember(member)}
                    isSelected={selectedId === member.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 空部门提示 */}
          {members.length === 0 && (
            <div className="text-center py-8 text-text-tertiary">
              暂无成员
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 获取 Agent 所属的所有部门（兼容新旧格式）
 */
function getAgentDepartments(config) {
  if (Array.isArray(config.departments) && config.departments.length > 0) {
    return config.departments;
  }
  if (config.department) {
    return [config.department];
  }
  return ['other'];
}

/**
 * 组织架构总览图
 */
export default function OrgChart({ configs, levels, departments, onSelectMember, selectedId }) {
  const bossConfig = useAgentStore((s) => s.bossConfig);

  // 按部门分组（支持多部门，同一员工可出现在多个部门）
  const groupedByDept = configs.reduce((acc, config) => {
    const deptIds = getAgentDepartments(config);
    for (const deptId of deptIds) {
      if (!acc[deptId]) {
        acc[deptId] = [];
      }
      // 标记该员工是否属于多个部门，以及这是否是其主部门
      const isPrimary = deptId === deptIds[0];
      const otherDeptIds = deptIds.filter(d => d !== deptId);
      // 将部门 ID 转换为部门名称
      const otherDeptNames = otherDeptIds.map(d => {
        const dept = departments.find(dep => dep.id === d);
        return dept?.name || d;
      });
      acc[deptId].push({
        ...config,
        isPrimaryDepartment: isPrimary,
        crossDepartments: otherDeptNames,
        isMultiDepartment: deptIds.length > 1,
      });
    }
    return acc;
  }, {});

  // 定义部门显示顺序（高管优先，然后按重要性排序）
  const deptOrder = ['executive', 'tech', 'finance', 'hr', 'product', 'marketing', 'sales', 'operations', 'admin', 'legal'];
  const sortedDeptIds = Object.keys(groupedByDept).sort((a, b) => {
    const indexA = deptOrder.indexOf(a);
    const indexB = deptOrder.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  return (
    <div className="space-y-6">
      {/* 老板位置（在组织架构顶端） */}
      <div className="flex justify-center mb-8">
        <div className="text-center">
          <div className="mx-auto">
            <AgentAvatar
              avatar={bossConfig.avatar}
              fallback="👑"
              size="2xl"
              bgClass="border border-border-default"
              bgStyle={{
                // P2-4: 老板头像渐变用语义 token（warning → accent），避免硬编码颜色
                background: 'linear-gradient(135deg, var(--color-warning), var(--accent))',
                color: 'white',
              }}
            />
          </div>
          <div className="mt-2 font-ui text-text-primary">{bossConfig.name || '老板'}</div>
          <div className="text-sm text-text-secondary">所有部门向您汇报</div>
        </div>
      </div>

      {/* 汇报线 */}
      <div className="flex justify-center">
        <div className="w-px h-8" style={{ backgroundColor: LINE_COLOR }} />
      </div>

      {/* 部门网格 —— P2-9: 部门卡片 stagger 入场，40ms 递增 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 stagger">
        {sortedDeptIds.map((deptId) => {
          const dept = departments.find((d) => d.id === deptId) || {
            id: deptId,
            name: deptId,
            color: '#6b7280',
          };
          const members = groupedByDept[deptId] || [];

          return (
            <DepartmentCard
              key={deptId}
              dept={dept}
              members={members}
              levels={levels}
              onSelectMember={onSelectMember}
              selectedId={selectedId}
            />
          );
        })}
      </div>

      {/* 图例 */}
      <div className="card mt-8">
        <div className="text-sm font-ui text-text-secondary mb-3">图例说明</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full border-2"
              style={{ borderColor: 'var(--text-tertiary)', backgroundColor: 'transparent' }}
            />
            <span className="text-text-secondary">团队成员</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
            <span className="text-text-secondary">当前选中</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="text-text-secondary">汇报关系</span>
          </div>
        </div>
      </div>
    </div>
  );
}
