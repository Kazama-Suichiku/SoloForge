const { parseComponent } = require('../src/parser');

describe('React Component Parser', () => {
  test('解析函数组件', () => {
    const code = `
      import React from 'react';
      
      function MyComponent({ name, age = 18 }) {
        return <div>{name}</div>;
      }
      
      export default MyComponent;
    `;
    
    const result = parseComponent(code);
    
    expect(result.componentName).toBe('MyComponent');
    expect(result.componentType).toBe('function');
    expect(result.props).toHaveLength(2);
    expect(result.props[0].name).toBe('name');
    expect(result.props[1].name).toBe('age');
    expect(result.props[1].defaultValue).toBe(18);
  });

  test('解析带 useState 的组件', () => {
    const code = `
      import React, { useState } from 'react';
      
      function Counter() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `;
    
    const result = parseComponent(code);
    
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0].name).toBe('useState');
    expect(result.hooks[0].stateVar).toBe('count');
    expect(result.hooks[0].setterVar).toBe('setCount');
  });

  test('解析箭头函数组件', () => {
    const code = `
      const MyComponent = ({ title }) => {
        return <h1>{title}</h1>;
      };
    `;
    
    const result = parseComponent(code);
    
    expect(result.componentName).toBe('MyComponent');
    expect(result.componentType).toBe('arrow');
    expect(result.props[0].name).toBe('title');
  });

  test('解析类组件', () => {
    const code = `
      import React, { Component } from 'react';
      
      class MyComponent extends Component {
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
    `;
    
    const result = parseComponent(code);
    
    expect(result.componentName).toBe('MyComponent');
    expect(result.componentType).toBe('class');
    expect(result.state).toHaveLength(1);
    expect(result.state[0].name).toBe('count');
    expect(result.methods).toHaveLength(1);
    expect(result.methods[0].name).toBe('handleClick');
  });

  test('提取 imports 和 dependencies', () => {
    const code = `
      import React from 'react';
      import { useState, useEffect } from 'react';
      import axios from 'axios';
      import './styles.css';
      
      function MyComponent() {
        return <div>Hello</div>;
      }
    `;
    
    const result = parseComponent(code);
    
    expect(result.imports).toHaveLength(4);
    expect(result.dependencies).toContain('react');
    expect(result.dependencies).toContain('axios');
    expect(result.dependencies).not.toContain('./styles.css');
  });
});
