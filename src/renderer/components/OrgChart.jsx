/**
 * SoloForge - 组织架构图组件
 * 可视化展示部门层级和汇报关系
 */
import { useState } from 'react';
import AgentAvatar from './AgentAvatar';
import { useAgentStore } from '../store/agent-store';

/**
 * 人员节点组件
 */
function PersonNode({ config, level, dept, isLast, onClick, isSelected }) {
  return (
    <div className="relative flex items-start">
      {/* 连接线 */}
      <div className="flex flex-col items-center mr-3">
        {/* 垂直线（上半部分） */}
        <div className="w-0.5 h-4 bg-gray-300 dark:bg-gray-600" />
        {/* 节点圆点 */}
        <div
          className="w-3 h-3 rounded-full border-2 flex-shrink-0 z-10"
          style={{
            borderColor: dept.color || '#6b7280',
            backgroundColor: isSelected ? (dept.color || '#6b7280') : 'white',
          }}
        />
        {/* 垂直线（下半部分） */}
        {!isLast && <div className="w-0.5 flex-1 bg-gray-300 dark:bg-gray-600 min-h-[20px]" />}
      </div>

      {/* 人员卡片 */}
      <div
        onClick={onClick}
        className={`
          flex-1 p-3 rounded-lg border cursor-pointer transition-all mb-2
          ${isSelected
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
          }
        `}
      >
        <div className="flex items-center gap-3">
          {/* 头像 */}
          <AgentAvatar
            avatar={config.avatar}
            fallback="👤"
            size="md"
            bgStyle={{ backgroundColor: `${dept.color}20` || '#f3f4f6' }}
            bgClass=""
          />

          {/* 信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {config.name}
              </span>
              <span
                className="px-1.5 py-0.5 text-xs rounded"
                style={{
                  backgroundColor: `${dept.color}15`,
                  color: dept.color,
                }}
              >
                {level.name}
              </span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {config.title}
            </div>
          </div>

          {/* 编辑图标 */}
          <svg
            className="w-4 h-4 text-gray-400 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
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
        className="flex items-center gap-3 p-4 rounded-t-xl cursor-pointer"
        style={{ backgroundColor: `${dept.color}15` }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* 部门图标 */}
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: dept.color }}
        >
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        </div>

        {/* 部门信息 */}
        <div className="flex-1">
          <div className="font-semibold text-gray-900 dark:text-gray-100">
            {dept.name}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {members.length} 名成员
          </div>
        </div>

        {/* 展开/收起 */}
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* 成员列表 */}
      {expanded && (
        <div
          className="border-l-4 border-b border-r rounded-b-xl p-4 bg-white dark:bg-gray-900
                     border-gray-200 dark:border-gray-700"
          style={{ borderLeftColor: dept.color }}
        >
          {/* 部门负责人 */}
          {leader && (
            <div className="mb-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                className={`
                  p-4 rounded-lg border-2 cursor-pointer transition-all
                  ${selectedId === leader.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400'
                  }
                `}
                style={{ borderColor: selectedId === leader.id ? undefined : `${dept.color}50` }}
              >
                <div className="flex items-center gap-4">
                  <AgentAvatar
                    avatar={leader.avatar}
                    fallback="👤"
                    size="xl"
                    bgStyle={{ backgroundColor: `${dept.color}20` }}
                    bgClass=""
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {leader.name}
                      </span>
                      <span
                        className="px-2 py-0.5 text-xs rounded-full font-medium"
                        style={{ backgroundColor: dept.color, color: 'white' }}
                      >
                        {levels.find((l) => l.id === leader.level)?.name || leader.level}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {leader.title}
                    </div>
                    {leader.description && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
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
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                团队成员
                {leader && (
                  <span className="text-gray-400">
                    → 向 {leader.name} 汇报
                  </span>
                )}
              </div>
              <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700">
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
            <div className="text-center py-8 text-gray-400 dark:text-gray-500">
              暂无成员
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 组织架构总览图
 */
export default function OrgChart({ configs, levels, departments, onSelectMember, selectedId }) {
  const bossConfig = useAgentStore((s) => s.bossConfig);

  // 按部门分组
  const groupedByDept = configs.reduce((acc, config) => {
    const deptId = config.department || 'other';
    if (!acc[deptId]) {
      acc[deptId] = [];
    }
    acc[deptId].push(config);
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
          <div className="mx-auto shadow-lg">
            <AgentAvatar
              avatar={bossConfig.avatar}
              fallback="👑"
              size="2xl"
              bgClass="bg-gradient-to-br from-yellow-400 to-orange-500 text-white"
            />
          </div>
          <div className="mt-2 font-semibold text-gray-900 dark:text-gray-100">{bossConfig.name || '老板'}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">所有部门向您汇报</div>
        </div>
      </div>

      {/* 汇报线 */}
      <div className="flex justify-center">
        <div className="w-0.5 h-8 bg-gradient-to-b from-orange-400 to-gray-300 dark:to-gray-600" />
      </div>

      {/* 部门网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">图例说明</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-gray-400 bg-white" />
            <span className="text-gray-600 dark:text-gray-400">团队成员</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-gray-600 dark:text-gray-400">当前选中</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="text-gray-600 dark:text-gray-400">汇报关系</span>
          </div>
        </div>
      </div>
    </div>
  );
}
