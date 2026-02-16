# React 组件解析器 API 文档

## 概述

React 组件解析器能够分析 React 组件代码，提取组件的结构信息，包括 props、state、hooks、方法等。

## 安装

```bash
cd react-test-generator
npm install
```

## 基本使用

```javascript
const { parseComponent } = require('./src/parser');

const code = `
  import React, { useState } from 'react';
  
  function MyComponent({ name, age = 18 }) {
    const [count, setCount] = useState(0);
    return <div>{name} - {count}</div>;
  }
`;

const result = parseComponent(code);
console.log(result);
```

## API

### parseComponent(code)

解析 React 组件代码并返回组件信息。

**参数:**
- `code` (string): React 组件源代码

**返回值:**
```javascript
{
  componentName: string | null,        // 组件名称
  componentType: string | null,        // 组件类型: 'function' | 'class' | 'arrow'
  props: Array<PropInfo>,              // Props 信息
  state: Array<StateInfo>,             // State 信息（类组件）
  hooks: Array<HookInfo>,              // Hooks 信息（函数组件）
  methods: Array<MethodInfo>,          // 方法信息（类组件）
  imports: Array<ImportInfo>,          // Import 语句
  exports: Array<ExportInfo>,          // Export 语句
  dependencies: Array<string>          // 外部依赖包
}
```

## 数据结构

### PropInfo

```javascript
{
  name: string,              // Prop 名称
  defaultValue?: any,        // 默认值
  required?: boolean,        // 是否必需
  type?: string,            // 类型（从 PropTypes 提取）
  destructured?: boolean    // 是否解构
}
```

### StateInfo

```javascript
{
  name: string,              // State 变量名
  initialValue: any          // 初始值
}
```

### HookInfo

```javascript
{
  name: string,              // Hook 名称 (useState, useEffect, etc.)
  arguments: Array<any>,     // Hook 参数
  stateVar?: string,         // State 变量名（useState）
  setterVar?: string,        // Setter 函数名（useState）
  dependencies?: Array       // 依赖数组（useEffect, useMemo, etc.）
}
```

### MethodInfo

```javascript
{
  name: string,              // 方法名
  params: Array<string>      // 参数列表
}
```

### ImportInfo

```javascript
{
  source: string,            // 导入源
  specifiers: Array<{        // 导入说明符
    imported: string,        // 导入的名称
    local: string           // 本地名称
  }>
}
```

### ExportInfo

```javascript
{
  type: 'named' | 'default', // 导出类型
  name?: string              // 导出名称
}
```

## 支持的组件类型

### 1. 函数组件

```javascript
function MyComponent({ name, age = 18 }) {
  const [count, setCount] = useState(0);
  return <div>{name}</div>;
}
```

解析结果:
```javascript
{
  componentName: "MyComponent",
  componentType: "function",
  props: [
    { name: "name", required: true },
    { name: "age", defaultValue: 18, required: false }
  ],
  hooks: [
    {
      name: "useState",
      arguments: [0],
      stateVar: "count",
      setterVar: "setCount"
    }
  ]
}
```

### 2. 箭头函数组件

```javascript
const MyComponent = ({ title }) => {
  return <h1>{title}</h1>;
};
```

解析结果:
```javascript
{
  componentName: "MyComponent",
  componentType: "arrow",
  props: [
    { name: "title", required: true }
  ]
}
```

### 3. 类组件

```javascript
class MyComponent extends React.Component {
  state = {
    count: 0
  };
  
  handleClick() {
    this.setState({ count: this.state.count + 1 });
  }
  
  render() {
    return <div>{this.state.count}</div>;
  }
}
```

解析结果:
```javascript
{
  componentName: "MyComponent",
  componentType: "class",
  state: [
    { name: "count", initialValue: 0 }
  ],
  methods: [
    { name: "handleClick", params: [] }
  ]
}
```

## 支持的 Hooks

解析器能够识别和提取以下 Hooks 的信息：

- `useState` - 提取 state 变量和 setter 函数名
- `useEffect` - 提取依赖数组
- `useContext`
- `useReducer`
- `useCallback` - 提取依赖数组
- `useMemo` - 提取依赖数组
- `useRef`
- `useImperativeHandle`
- `useLayoutEffect`
- `useDebugValue`
- 自定义 Hooks（任何以 `use` 开头的函数）

## 依赖提取

解析器会自动识别和提取：

1. **外部依赖**: npm 包（不以 `.` 开头的导入）
2. **本地导入**: 相对路径导入（以 `.` 开头）

示例:
```javascript
import React from 'react';           // 外部依赖
import axios from 'axios';           // 外部依赖
import { Button } from './Button';   // 本地导入（不计入 dependencies）
```

## 错误处理

如果代码解析失败，会抛出错误：

```javascript
try {
  const result = parseComponent(invalidCode);
} catch (error) {
  console.error('解析失败:', error.message);
}
```

## 限制

1. 不支持动态 props（通过 spread 操作符传递的 props）
2. 不支持高阶组件（HOC）的完整分析
3. TypeScript 类型信息提取有限
4. 复杂的条件渲染可能无法完全识别

## 性能

- 小型组件（< 100 行）: < 10ms
- 中型组件（100-500 行）: 10-50ms
- 大型组件（> 500 行）: 50-200ms

## 下一步

- 查看 [测试用例](../tests/parser.test.js) 了解更多使用示例
- 查看 [示例代码](../examples/example.js) 了解实际应用
