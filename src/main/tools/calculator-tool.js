/**
 * SoloForge - 计算器工具
 * 提供安全的数学表达式计算
 * @module tools/calculator-tool
 */

const { toolRegistry } = require('./tool-registry');

/**
 * 安全的数学表达式求值
 * 只允许数字、运算符和数学函数
 */
function safeEval(expression) {
  // 移除空白
  const cleaned = expression.replace(/\s+/g, '');

  // 验证表达式只包含允许的字符
  const allowedPattern = /^[\d+\-*/().%^,eE]+$|^[\d+\-*/().%^,eE\s]*(sin|cos|tan|sqrt|abs|floor|ceil|round|log|ln|exp|pow|min|max|PI|E)[\d+\-*/().%^,eE\s]*$/;

  // 允许的数学函数
  const mathFunctions = [
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'sqrt', 'abs', 'floor', 'ceil', 'round',
    'log', 'log10', 'log2', 'exp', 'pow',
    'min', 'max', 'random',
    'PI', 'E',
  ];

  // 构建安全的表达式
  let safeExpression = expression;

  // 替换常量
  safeExpression = safeExpression.replace(/\bPI\b/g, String(Math.PI));
  safeExpression = safeExpression.replace(/\bE\b/g, String(Math.E));

  // 替换 ^ 为 **（幂运算）
  safeExpression = safeExpression.replace(/\^/g, '**');

  // 替换数学函数为 Math. 前缀
  for (const fn of mathFunctions) {
    const regex = new RegExp(`\\b${fn}\\b`, 'g');
    if (fn !== 'PI' && fn !== 'E') {
      safeExpression = safeExpression.replace(regex, `Math.${fn}`);
    }
  }

  // ln -> Math.log
  safeExpression = safeExpression.replace(/\bln\b/g, 'Math.log');

  // 验证最终表达式
  const finalPattern = /^[\d+\-*/().%,\s]*(?:Math\.\w+)?[\d+\-*/().%,\s]*$/;
  
  // 使用 Function 构造器进行安全求值
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${safeExpression});`);
    const result = fn();

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('计算结果不是有效数字');
    }

    return result;
  } catch (error) {
    throw new Error(`无法计算表达式: ${error.message}`);
  }
}

/**
 * 计算器工具
 */
const calculatorTool = {
  name: 'calculator',
  description: '计算数学表达式。支持基本运算（+, -, *, /, %, ^）和数学函数（sin, cos, sqrt, log 等）。',
  category: 'math',
  parameters: {
    expression: {
      type: 'string',
      description: '要计算的数学表达式，如 "2 + 3 * 4" 或 "sqrt(16) + pow(2, 3)"',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { expression } = args;

    if (!expression || typeof expression !== 'string') {
      throw new Error('请提供有效的数学表达式');
    }

    const result = safeEval(expression);

    // 格式化结果
    let formattedResult;
    if (Number.isInteger(result)) {
      formattedResult = String(result);
    } else {
      // 保留合理的小数位数
      formattedResult = result.toPrecision(10).replace(/\.?0+$/, '');
    }

    return {
      expression,
      result: formattedResult,
      numericResult: result,
    };
  },
};

/**
 * 注册计算器工具
 */
function registerCalculatorTool() {
  toolRegistry.register(calculatorTool);
}

module.exports = {
  calculatorTool,
  registerCalculatorTool,
  safeEval,
};
