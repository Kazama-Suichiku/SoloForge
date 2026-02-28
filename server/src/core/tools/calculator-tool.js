/**
 * 计算器工具 - 移动端版
 */

const { toolRegistry } = require('./tool-registry');

function safeEval(expression) {
  const mathFunctions = [
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'sqrt', 'abs', 'floor', 'ceil', 'round',
    'log', 'log10', 'log2', 'exp', 'pow',
    'min', 'max', 'random', 'PI', 'E',
  ];

  let safeExpression = expression;
  safeExpression = safeExpression.replace(/\bPI\b/g, String(Math.PI));
  safeExpression = safeExpression.replace(/\bE\b/g, String(Math.E));
  safeExpression = safeExpression.replace(/\^/g, '**');

  for (const fn of mathFunctions) {
    const regex = new RegExp(`\\b${fn}\\b`, 'g');
    if (fn !== 'PI' && fn !== 'E') {
      safeExpression = safeExpression.replace(regex, `Math.${fn}`);
    }
  }
  safeExpression = safeExpression.replace(/\bln\b/g, 'Math.log');

  try {
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

const calculatorTool = {
  name: 'calculator',
  description: '计算数学表达式。支持基本运算（+, -, *, /, %, ^）和数学函数（sin, cos, sqrt, log 等）。',
  category: 'math',
  parameters: {
    expression: {
      type: 'string',
      description: '要计算的数学表达式',
      required: true,
    },
  },
  async execute(args) {
    const { expression } = args;
    if (!expression || typeof expression !== 'string') {
      throw new Error('请提供有效的数学表达式');
    }
    const result = safeEval(expression);
    let formattedResult;
    if (Number.isInteger(result)) {
      formattedResult = String(result);
    } else {
      formattedResult = result.toPrecision(10).replace(/\.?0+$/, '');
    }
    return { expression, result: formattedResult, numericResult: result };
  },
};

function registerCalculatorTool() {
  toolRegistry.register(calculatorTool);
}

module.exports = { calculatorTool, registerCalculatorTool, safeEval };
