type VariableName = "t" | "y";
type Operator = "+" | "-" | "*" | "/" | "^";

type Token =
  | { type: "number"; value: number; lexeme: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: Operator }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma"; value: "," }
  | { type: "eof" };

type ExpressionNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: VariableName }
  | { type: "constant"; name: string; value: number }
  | { type: "unary"; operator: "+" | "-"; argument: ExpressionNode }
  | {
      type: "binary";
      operator: Operator;
      left: ExpressionNode;
      right: ExpressionNode;
    }
  | { type: "function"; name: string; arguments: ExpressionNode[] };

export interface CompiledExpression {
  source: string;
  variables: Set<VariableName>;
  isAutonomous: boolean;
  dependsOnY: boolean;
  latex: string;
  evaluate: (t: number, y: number) => number;
  evaluateAutonomous?: (y: number) => number;
}

const CONSTANTS = new Map<string, number>([
  ["pi", Math.PI],
  ["e", Math.E]
]);

const FUNCTIONS = new Map<
  string,
  {
    minArgs: number;
    maxArgs: number;
    evaluate: (...args: number[]) => number;
  }
>([
  ["abs", { minArgs: 1, maxArgs: 1, evaluate: Math.abs }],
  ["acos", { minArgs: 1, maxArgs: 1, evaluate: Math.acos }],
  ["asin", { minArgs: 1, maxArgs: 1, evaluate: Math.asin }],
  ["atan", { minArgs: 1, maxArgs: 1, evaluate: Math.atan }],
  ["ceil", { minArgs: 1, maxArgs: 1, evaluate: Math.ceil }],
  ["cos", { minArgs: 1, maxArgs: 1, evaluate: Math.cos }],
  ["cosh", { minArgs: 1, maxArgs: 1, evaluate: Math.cosh }],
  ["exp", { minArgs: 1, maxArgs: 1, evaluate: Math.exp }],
  ["floor", { minArgs: 1, maxArgs: 1, evaluate: Math.floor }],
  ["log", { minArgs: 1, maxArgs: 1, evaluate: Math.log }],
  ["max", { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, evaluate: Math.max }],
  ["min", { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, evaluate: Math.min }],
  ["pow", { minArgs: 2, maxArgs: 2, evaluate: Math.pow }],
  ["round", { minArgs: 1, maxArgs: 1, evaluate: Math.round }],
  ["sin", { minArgs: 1, maxArgs: 1, evaluate: Math.sin }],
  ["sinh", { minArgs: 1, maxArgs: 1, evaluate: Math.sinh }],
  ["sqrt", { minArgs: 1, maxArgs: 1, evaluate: Math.sqrt }],
  ["tan", { minArgs: 1, maxArgs: 1, evaluate: Math.tan }],
  ["tanh", { minArgs: 1, maxArgs: 1, evaluate: Math.tanh }]
]);

class ExpressionError extends Error {}

class PrattParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  parse(): ExpressionNode {
    const expression = this.parseExpression(0);
    const next = this.peek();

    if (next.type !== "eof") {
      throw new ExpressionError(`Unexpected token near "${tokenLabel(next)}".`);
    }

    return expression;
  }

  private parseExpression(minBindingPower: number): ExpressionNode {
    let left = this.parsePrefix();

    while (true) {
      const token = this.peek();

      if (token.type !== "operator") {
        break;
      }

      const bindingPower = infixBindingPower(token.value);
      if (!bindingPower || bindingPower.left < minBindingPower) {
        break;
      }

      this.consume();
      const right = this.parseExpression(bindingPower.right);

      left = {
        type: "binary",
        operator: token.value,
        left,
        right
      };
    }

    return left;
  }

  private parsePrefix(): ExpressionNode {
    const token = this.consume();

    if (token.type === "number") {
      return { type: "number", value: token.value };
    }

    if (token.type === "identifier") {
      const next = this.peek();
      if (next.type === "paren" && next.value === "(") {
        return this.parseFunctionCall(token.value);
      }

      if (token.value === "t" || token.value === "y") {
        return { type: "variable", name: token.value };
      }

      const constantValue = CONSTANTS.get(token.value);
      if (constantValue !== undefined) {
        return { type: "constant", name: token.value, value: constantValue };
      }

      throw new ExpressionError(
        `Unknown identifier "${token.value}". Use variables "t" and "y" or a supported constant.`
      );
    }

    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      return {
        type: "unary",
        operator: token.value,
        argument: this.parseExpression(7)
      };
    }

    if (token.type === "paren" && token.value === "(") {
      const expression = this.parseExpression(0);
      const closing = this.consume();
      if (closing.type !== "paren" || closing.value !== ")") {
        throw new ExpressionError('Expected ")" to close the current group.');
      }
      return expression;
    }

    throw new ExpressionError(`Unexpected token near "${tokenLabel(token)}".`);
  }

  private parseFunctionCall(name: string): ExpressionNode {
    const definition = FUNCTIONS.get(name);
    if (!definition) {
      throw new ExpressionError(`Unsupported function "${name}".`);
    }

    const argumentsList: ExpressionNode[] = [];
    this.expectParen("(");

    const next = this.peek();
    if (!(next.type === "paren" && next.value === ")")) {
      while (true) {
        argumentsList.push(this.parseExpression(0));

        if (this.peek().type === "comma") {
          this.consume();
          continue;
        }

        break;
      }
    }

    this.expectParen(")");

    if (
      argumentsList.length < definition.minArgs ||
      argumentsList.length > definition.maxArgs
    ) {
      const maxArgsLabel =
        definition.maxArgs === Number.POSITIVE_INFINITY
          ? "many arguments"
          : `${definition.maxArgs} argument(s)`;
      throw new ExpressionError(
        `Function "${name}" expects between ${definition.minArgs} and ${maxArgsLabel}.`
      );
    }

    return { type: "function", name, arguments: argumentsList };
  }

  private expectParen(value: "(" | ")"): void {
    const token = this.consume();
    if (token.type !== "paren" || token.value !== value) {
      throw new ExpressionError(`Expected "${value}".`);
    }
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { type: "eof" };
  }

  private consume(): Token {
    const token = this.tokens[this.index] ?? { type: "eof" };
    this.index += 1;
    return token;
  }
}

export function compileExpression(source: string): CompiledExpression {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    throw new ExpressionError("Enter an expression for the ODE right-hand side.");
  }

  const parser = new PrattParser(normalizedSource);
  const ast = parser.parse();
  const variables = collectVariables(ast);
  const evaluator = (t: number, y: number) => evaluateNode(ast, t, y);
  const isAutonomous = !variables.has("t");

  return {
    source: normalizedSource,
    variables,
    isAutonomous,
    dependsOnY: variables.has("y"),
    latex: renderNodeAsLatex(ast),
    evaluate: evaluator,
    evaluateAutonomous: isAutonomous ? (value: number) => evaluator(0, value) : undefined
  };
}

function renderNodeAsLatex(node: ExpressionNode, parentPrecedence = 0): string {
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
      return wrapLatex(renderBinaryNodeAsLatex(node), latexPrecedence(node), parentPrecedence);
    case "function":
      return renderFunctionNodeAsLatex(node);
  }
}

function evaluateNode(node: ExpressionNode, t: number, y: number): number {
  switch (node.type) {
    case "number":
      return node.value;
    case "constant":
      return node.value;
    case "variable":
      return node.name === "t" ? t : y;
    case "unary": {
      const value = evaluateNode(node.argument, t, y);
      return node.operator === "-" ? -value : value;
    }
    case "binary": {
      const left = evaluateNode(node.left, t, y);
      const right = evaluateNode(node.right, t, y);

      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "^":
          return left ** right;
      }
    }
    case "function": {
      const definition = FUNCTIONS.get(node.name);
      if (!definition) {
        throw new ExpressionError(`Unsupported function "${node.name}".`);
      }

      const values = node.arguments.map((argument) => evaluateNode(argument, t, y));
      return definition.evaluate(...values);
    }
  }
}

function collectVariables(node: ExpressionNode, variables = new Set<VariableName>()): Set<VariableName> {
  switch (node.type) {
    case "variable":
      variables.add(node.name);
      return variables;
    case "unary":
      return collectVariables(node.argument, variables);
    case "binary":
      collectVariables(node.left, variables);
      collectVariables(node.right, variables);
      return variables;
    case "function":
      node.arguments.forEach((argument) => collectVariables(argument, variables));
      return variables;
    default:
      return variables;
  }
}

function renderBinaryNodeAsLatex(node: Extract<ExpressionNode, { type: "binary" }>): string {
  switch (node.operator) {
    case "+":
      return `${renderNodeAsLatex(node.left, 1)} + ${renderNodeAsLatex(node.right, 1)}`;
    case "-":
      return `${renderNodeAsLatex(node.left, 1)} - ${renderSubtractiveRightOperand(node.right)}`;
    case "*":
      return `${renderMultiplicativeOperand(node.left)} \\cdot ${renderMultiplicativeOperand(node.right)}`;
    case "/":
      return `\\frac{${renderNodeAsLatex(node.left)}}{${renderNodeAsLatex(node.right)}}`;
    case "^":
      return `${renderPowerBase(node.left)}^{${renderNodeAsLatex(node.right)}}`;
  }
}

function renderFunctionNodeAsLatex(node: Extract<ExpressionNode, { type: "function" }>): string {
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
  const argumentsLatex = node.arguments.map((argument) => renderNodeAsLatex(argument)).join(", ");
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

function infixBindingPower(operator: Operator): { left: number; right: number } | null {
  switch (operator) {
    case "+":
    case "-":
      return { left: 1, right: 2 };
    case "*":
    case "/":
      return { left: 3, right: 4 };
    case "^":
      return { left: 6, right: 5 };
    default:
      return null;
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const start = index;
      index += 1;

      while (index < source.length && /[0-9.]/.test(source[index])) {
        index += 1;
      }

      if (index < source.length && /[eE]/.test(source[index])) {
        index += 1;
        if (/[+-]/.test(source[index] ?? "")) {
          index += 1;
        }
        while (index < source.length && /[0-9]/.test(source[index])) {
          index += 1;
        }
      }

      const lexeme = source.slice(start, index);
      const value = Number(lexeme);
      if (!Number.isFinite(value)) {
        throw new ExpressionError(`Invalid numeric literal "${lexeme}".`);
      }
      tokens.push({ type: "number", value, lexeme });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
        index += 1;
      }
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "comma", value: "," });
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "^") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    throw new ExpressionError(`Unexpected character "${char}".`);
  }

  tokens.push({ type: "eof" });
  return tokens;
}

function tokenLabel(token: Token): string {
  switch (token.type) {
    case "number":
      return token.lexeme;
    case "identifier":
    case "operator":
    case "paren":
    case "comma":
      return token.value;
    case "eof":
      return "end of expression";
  }
}

export function formatExpressionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "The expression could not be parsed.";
}
