import type { ExpressionNode } from "./model";

export function renderNodeAsLatex(node: ExpressionNode, parentPrecedence = 0): string {
  switch (node.type) {
    case "number":
      return formatNumberAsLatex(node.value);
    case "constant":
      return node.name === "pi" ? "\\pi" : "e";
    case "variable":
      return node.name;
    case "unary": {
      const argument = renderNodeAsLatex(node.argument, 4);
      const content = `${node.operator === "-" ? "-" : "+"}${argument}`;
      return wrapLatex(content, latexPrecedence(node), parentPrecedence);
    }
    case "binary":
      return wrapLatex(
        renderBinaryNodeAsLatex(node),
        latexPrecedence(node),
        parentPrecedence
      );
    case "function":
      return renderFunctionNodeAsLatex(node);
  }
}

function renderBinaryNodeAsLatex(
  node: Extract<ExpressionNode, { type: "binary" }>
): string {
  switch (node.operator) {
    case "+":
      return `${renderNodeAsLatex(node.left, 1)} + ${renderNodeAsLatex(node.right, 1)}`;
    case "-":
      return `${renderNodeAsLatex(node.left, 1)} - ${renderSubtractiveRightOperand(node.right)}`;
    case "*":
      return `${renderMultiplicativeOperand(node.left)} \\cdot ${renderMultiplicativeOperand(node.right)}`;
    case "/":
      return renderQuotientAsLatex(node.left, node.right);
    case "^":
      return `${renderPowerBase(node.left)}^{${renderNodeAsLatex(node.right)}}`;
  }
}

function renderQuotientAsLatex(
  numerator: ExpressionNode,
  denominator: ExpressionNode
): string {
  if (numerator.type === "unary" && numerator.operator === "-") {
    return `-\\frac{${renderNodeAsLatex(numerator.argument)}}{${renderNodeAsLatex(denominator)}}`;
  }

  return `\\frac{${renderNodeAsLatex(numerator)}}{${renderNodeAsLatex(denominator)}}`;
}

function renderFunctionNodeAsLatex(
  node: Extract<ExpressionNode, { type: "function" }>
): string {
  if (node.name === "abs") {
    return `\\left|${renderNodeAsLatex(node.arguments[0])}\\right|`;
  }

  if (node.name === "sqrt") {
    return `\\sqrt{${renderNodeAsLatex(node.arguments[0])}}`;
  }

  if (node.name === "floor") {
    return `\\left\\lfloor ${renderNodeAsLatex(node.arguments[0])} \\right\\rfloor`;
  }

  if (node.name === "ceil") {
    return `\\left\\lceil ${renderNodeAsLatex(node.arguments[0])} \\right\\rceil`;
  }

  if (node.name === "pow") {
    return `${renderPowerBase(node.arguments[0])}^{${renderNodeAsLatex(node.arguments[1])}}`;
  }

  const latexName = latexFunctionName(node.name);
  const argumentsLatex = node.arguments
    .map((argument) => renderNodeAsLatex(argument))
    .join(", ");
  return `${latexName}\\left(${argumentsLatex}\\right)`;
}

function latexFunctionName(name: string): string {
  switch (name) {
    case "sin":
    case "cos":
    case "tan":
    case "sinh":
    case "cosh":
    case "tanh":
    case "log":
    case "exp":
    case "min":
    case "max":
      return `\\${name}`;
    default:
      return `\\operatorname{${name}}`;
  }
}

function renderPowerBase(node: ExpressionNode): string {
  const latex = renderNodeAsLatex(node);
  if (node.type === "number" || node.type === "variable" || node.type === "constant") {
    return latex;
  }

  if (node.type === "function") {
    return latex;
  }

  return `\\left(${latex}\\right)`;
}

function renderMultiplicativeOperand(node: ExpressionNode): string {
  const latex = renderNodeAsLatex(node);
  if (
    node.type === "binary" &&
    (node.operator === "+" || node.operator === "-" || node.operator === "/")
  ) {
    return `\\left(${latex}\\right)`;
  }

  return latex;
}

function renderSubtractiveRightOperand(node: ExpressionNode): string {
  const latex = renderNodeAsLatex(node, 1);
  if (node.type === "binary" && (node.operator === "+" || node.operator === "-")) {
    return `\\left(${latex}\\right)`;
  }

  return latex;
}

function latexPrecedence(node: ExpressionNode): number {
  switch (node.type) {
    case "number":
    case "variable":
    case "constant":
    case "function":
      return 5;
    case "unary":
      return 4;
    case "binary":
      switch (node.operator) {
        case "+":
        case "-":
          return 1;
        case "*":
        case "/":
          return 2;
        case "^":
          return 4;
      }
  }
}

function wrapLatex(content: string, precedence: number, parentPrecedence: number): string {
  if (precedence < parentPrecedence) {
    return `\\left(${content}\\right)`;
  }

  return content;
}

function formatNumberAsLatex(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}`;
  }

  return `${Number(value.toPrecision(12))}`;
}
