const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

/**
 * 解析 React 组件代码
 * @param {string} code - React 组件源代码
 * @returns {Object} 解析结果
 */
function parseComponent(code) {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    });

    const result = {
      componentName: null,
      componentType: null, // 'function' | 'class' | 'arrow'
      props: [],
      state: [],
      hooks: [],
      methods: [],
      imports: [],
      exports: [],
      dependencies: []
    };

    traverse(ast, {
      // 处理函数组件
      FunctionDeclaration(path) {
        if (isReactComponent(path.node)) {
          result.componentName = path.node.id.name;
          result.componentType = 'function';
          extractProps(path.node.params, result);
          extractHooks(path, result);
        }
      },

      // 处理箭头函数组件
      VariableDeclarator(path) {
        if (path.node.init && t.isArrowFunctionExpression(path.node.init)) {
          if (isReactComponent(path.node.init)) {
            result.componentName = path.node.id.name;
            result.componentType = 'arrow';
            extractProps(path.node.init.params, result);
            extractHooks(path, result);
          }
        }
      },

      // 处理类组件
      ClassDeclaration(path) {
        if (isReactClassComponent(path.node)) {
          result.componentName = path.node.id.name;
          result.componentType = 'class';
          extractClassProps(path, result);
          extractClassState(path, result);
          extractClassMethods(path, result);
        }
      },

      // 提取 import 语句
      ImportDeclaration(path) {
        const importInfo = {
          source: path.node.source.value,
          specifiers: path.node.specifiers.map(spec => ({
            imported: spec.imported ? spec.imported.name : 'default',
            local: spec.local.name
          }))
        };
        result.imports.push(importInfo);

        // 记录依赖
        if (!path.node.source.value.startsWith('.')) {
          result.dependencies.push(path.node.source.value);
        }
      },

      // 提取 export 语句
      ExportNamedDeclaration(path) {
        if (path.node.declaration) {
          result.exports.push({
            type: 'named',
            name: path.node.declaration.id?.name
          });
        }
      },

      ExportDefaultDeclaration(path) {
        result.exports.push({
          type: 'default',
          name: path.node.declaration.id?.name || path.node.declaration.name
        });
      }
    });

    return result;
  } catch (error) {
    throw new Error(`解析失败: ${error.message}`);
  }
}

/**
 * 判断是否为 React 组件（通过递归检查 AST 节点）
 */
function isReactComponent(node) {
  // 递归检查节点及其子节点是否包含 JSX
  function containsJSX(n) {
    if (!n || typeof n !== 'object') return false;
    
    // 检查是否是 JSX 元素或片段
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
      return true;
    }
    
    // 递归检查所有属性
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
      
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (containsJSX(item)) return true;
        }
      } else if (typeof value === 'object' && value !== null) {
        if (containsJSX(value)) return true;
      }
    }
    
    return false;
  }
  
  if (t.isFunctionDeclaration(node) || t.isArrowFunctionExpression(node)) {
    return containsJSX(node.body);
  }
  
  return false;
}

/**
 * 判断是否为 React 类组件
 */
function isReactClassComponent(node) {
  if (!t.isClassDeclaration(node)) return false;
  
  const superClass = node.superClass;
  if (!superClass) return false;
  
  // 检查是否继承自 React.Component 或 Component
  if (t.isMemberExpression(superClass)) {
    return superClass.object.name === 'React' && 
           (superClass.property.name === 'Component' || superClass.property.name === 'PureComponent');
  }
  
  return superClass.name === 'Component' || superClass.name === 'PureComponent';
}

/**
 * 提取函数组件的 props
 */
function extractProps(params, result) {
  if (params.length === 0) return;
  
  const propsParam = params[0];
  
  if (t.isObjectPattern(propsParam)) {
    // 解构的 props: function MyComponent({ name, age })
    propsParam.properties.forEach(prop => {
      if (t.isObjectProperty(prop)) {
        result.props.push({
          name: prop.key.name,
          defaultValue: prop.value.right ? getValueLiteral(prop.value.right) : undefined,
          required: !prop.value.right
        });
      }
    });
  } else if (t.isIdentifier(propsParam)) {
    // 整个 props 对象: function MyComponent(props)
    result.props.push({
      name: propsParam.name,
      type: 'object',
      destructured: false
    });
  }
}

/**
 * 提取 Hooks
 */
function extractHooks(path, result) {
  path.traverse({
    CallExpression(callPath) {
      const callee = callPath.node.callee;
      
      if (t.isIdentifier(callee) && callee.name.startsWith('use')) {
        const hookInfo = {
          name: callee.name,
          arguments: callPath.node.arguments.map(arg => getValueLiteral(arg))
        };
        
        // 特殊处理 useState
        if (callee.name === 'useState') {
          const parent = callPath.parent;
          if (t.isVariableDeclarator(parent) && t.isArrayPattern(parent.id)) {
            hookInfo.stateVar = parent.id.elements[0]?.name;
            hookInfo.setterVar = parent.id.elements[1]?.name;
          }
        }
        
        // 特殊处理 useEffect
        if (callee.name === 'useEffect') {
          hookInfo.dependencies = callPath.node.arguments[1] ? 
            getValueLiteral(callPath.node.arguments[1]) : undefined;
        }
        
        result.hooks.push(hookInfo);
      }
    }
  });
}

/**
 * 提取类组件的 props
 */
function extractClassProps(path, result) {
  // 从 propTypes 提取
  path.traverse({
    AssignmentExpression(assignPath) {
      if (t.isMemberExpression(assignPath.node.left) &&
          assignPath.node.left.property.name === 'propTypes') {
        const propsObj = assignPath.node.right;
        if (t.isObjectExpression(propsObj)) {
          propsObj.properties.forEach(prop => {
            result.props.push({
              name: prop.key.name,
              type: getPropType(prop.value)
            });
          });
        }
      }
    }
  });
}

/**
 * 提取类组件的 state
 */
function extractClassState(path, result) {
  path.traverse({
    ClassProperty(propPath) {
      if (propPath.node.key.name === 'state') {
        if (t.isObjectExpression(propPath.node.value)) {
          propPath.node.value.properties.forEach(prop => {
            result.state.push({
              name: prop.key.name,
              initialValue: getValueLiteral(prop.value)
            });
          });
        }
      }
    }
  });
}

/**
 * 提取类组件的方法
 */
function extractClassMethods(path, result) {
  path.traverse({
    ClassMethod(methodPath) {
      if (methodPath.node.key.name !== 'constructor' &&
          methodPath.node.key.name !== 'render') {
        result.methods.push({
          name: methodPath.node.key.name,
          params: methodPath.node.params.map(p => p.name)
        });
      }
    }
  });
}

/**
 * 获取值的字面量表示
 */
function getValueLiteral(node) {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isArrayExpression(node)) {
    return node.elements.map(el => getValueLiteral(el));
  }
  if (t.isObjectExpression(node)) {
    const obj = {};
    node.properties.forEach(prop => {
      obj[prop.key.name] = getValueLiteral(prop.value);
    });
    return obj;
  }
  return undefined;
}

/**
 * 获取 PropType 类型
 */
function getPropType(node) {
  if (t.isMemberExpression(node)) {
    return node.property.name;
  }
  return 'unknown';
}

module.exports = {
  parseComponent
};
