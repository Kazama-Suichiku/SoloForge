# React Test Generator

React 组件解析器和测试生成工具

## 功能

### 组件解析器 (Parser)
- 解析 React 组件代码
- 提取组件的 props、state、hooks 信息
- 识别组件依赖关系
- 分析组件结构和类型

### 测试生成器 (Generator)
- 基于组件分析结果生成测试用例
- 支持多种测试策略
- AI 驱动的智能测试生成

### Web UI
- 代码编辑器集成
- 实时预览和测试结果展示
- 交互式测试策略配置

## 目录结构

```
react-test-generator/
├── src/
│   ├── parser/          # 组件解析器
│   ├── generator/       # 测试生成器
│   └── ui/             # Web UI 界面
├── tests/              # 测试用例
└── docs/               # 文档
```

## 使用方法

```javascript
const { parseComponent } = require('./src/parser');

const code = `
function MyComponent({ name, age }) {
  const [count, setCount] = useState(0);
  return <div>{name}</div>;
}
`;

const result = parseComponent(code);
console.log(result);
```
