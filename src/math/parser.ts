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

export type EvaluationStatus = "ok" | "near-singular" | "invalid";

export interface EvaluationOptions {
  domainTolerance?: number;
  derivativeMagnitudeLimit?: number;
  segmentSampleCount?: number;
}

export interface EvaluationDiagnostics {
  value: number;
  status: EvaluationStatus;
  reason?: string;
}

export interface SegmentDomainCheck {
  ok: boolean;
  status: EvaluationStatus;
  reason?: string;
}

interface NormalizedEvaluationOptions {
  domainTolerance: number;
  derivativeMagnitudeLimit?: number;
  segmentSampleCount: number;
}

interface DomainSignal {
  key: string;
  evaluate: (t: number, y: number) => number;
  classify: (value: number, tolerance: number) => EvaluationDiagnostics;
}

const DEFAULT_DOMAIN_TOLERANCE = 1e-8;
const DEFAULT_SEGMENT_SAMPLE_COUNT = 8;

export interface CompiledExpression {
  source: string;
  variables: Set<VariableName>;
  isAutonomous: boolean;
  dependsOnY: boolean;
  latex: string;
  evaluate: (t: number, y: number) => number;
  evaluateWithDiagnostics: (
    t: number,
    y: number,
    options?: EvaluationOptions
  ) => EvaluationDiagnostics;
  checkSegmentDomain: (
    start: { t: number; y: number },
    end: { t: number; y: number },
    options?: EvaluationOptions
  ) => SegmentDomainCheck;
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
  const domainSignals = collectDomainSignals(ast);
  const evaluateWithDiagnostics = (
    t: number,
    y: number,
    options: EvaluationOptions = {}
  ): EvaluationDiagnostics => {
    const normalizedOptions = normalizeEvaluationOptions(options);
    const domainDiagnostics = evaluateDomainSignals(
      domainSignals,
      t,
      y,
      normalizedOptions
    );
    if (domainDiagnostics.status === "invalid") {
      return domainDiagnostics;
    }

    return finalizeDiagnostics(
      evaluator(t, y),
      domainDiagnostics.status,
      normalizedOptions,
      domainDiagnostics.reason
    );
  };
  const isAutonomous = !variables.has("t");

  return {
    source: normalizedSource,
    variables,
    isAutonomous,
    dependsOnY: variables.has("y"),
    latex: renderNodeAsLatex(ast),
    evaluate: evaluator,
    evaluateWithDiagnostics,
    checkSegmentDomain: (start, end, options = {}) =>
      checkSegmentDomain(domainSignals, start, end, normalizeEvaluationOptions(options)),
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

function collectDomainSignals(
  node: ExpressionNode,
  path = "root",
  signals: DomainSignal[] = []
): DomainSignal[] {
  switch (node.type) {
    case "unary":
      return collectDomainSignals(node.argument, `${path}.arg`, signals);
    case "binary":
      collectDomainSignals(node.left, `${path}.left`, signals);
      collectDomainSignals(node.right, `${path}.right`, signals);
      if (node.operator === "/") {
        signals.push({
          key: `${path}.denominator`,
          evaluate: (t, y) => evaluateNode(node.right, t, y),
          classify: (value, tolerance) => classifyNonzeroBoundary(value, tolerance)
        });
      }
      return signals;
    case "function":
      node.arguments.forEach((argument, index) => {
        collectDomainSignals(argument, `${path}.argument${index}`, signals);
      });
      collectFunctionDomainSignals(node, path, signals);
      return signals;
    default:
      return signals;
  }
}

function collectFunctionDomainSignals(
  node: Extract<ExpressionNode, { type: "function" }>,
  path: string,
  signals: DomainSignal[]
): void {
  const argument = node.arguments[0];

  switch (node.name) {
    case "log":
      signals.push({
        key: `${path}.log-argument`,
        evaluate: (t, y) => evaluateNode(argument, t, y),
        classify: (value, tolerance) =>
          classifyLowerBoundary(
            value,
            true,
            tolerance,
            "log is undefined for non-positive values."
          )
      });
      break;
    case "sqrt":
      signals.push({
        key: `${path}.sqrt-argument`,
        evaluate: (t, y) => evaluateNode(argument, t, y),
        classify: (value, tolerance) =>
          classifyLowerBoundary(
            value,
            false,
            tolerance,
            "sqrt is undefined for negative values."
          )
      });
      break;
    case "asin":
    case "acos":
      signals.push(
        {
          key: `${path}.${node.name}-lower-bound`,
          evaluate: (t, y) => evaluateNode(argument, t, y) + 1,
          classify: (value, tolerance) =>
            classifyLowerBoundary(
              value,
              false,
              tolerance,
              `${node.name} is undefined outside [-1, 1].`
            )
        },
        {
          key: `${path}.${node.name}-upper-bound`,
          evaluate: (t, y) => 1 - evaluateNode(argument, t, y),
          classify: (value, tolerance) =>
            classifyLowerBoundary(
              value,
              false,
              tolerance,
              `${node.name} is undefined outside [-1, 1].`
            )
        }
      );
      break;
    case "tan":
      signals.push({
        key: `${path}.tan-cosine`,
        evaluate: (t, y) => Math.cos(evaluateNode(argument, t, y)),
        classify: (value, tolerance) =>
          classifyNonzeroBoundary(value, tolerance, "tan is singular where cos is zero.")
      });
      break;
  }
}

function evaluateDomainSignals(
  signals: DomainSignal[],
  t: number,
  y: number,
  options: NormalizedEvaluationOptions
): EvaluationDiagnostics {
  for (const signal of signals) {
    const diagnostics = signal.classify(signal.evaluate(t, y), options.domainTolerance);
    if (diagnostics.status !== "ok") {
      return diagnostics;
    }
  }

  return { value: Number.NaN, status: "ok" };
}

function checkSegmentDomain(
  signals: DomainSignal[],
  start: { t: number; y: number },
  end: { t: number; y: number },
  options: NormalizedEvaluationOptions
): SegmentDomainCheck {
  if (signals.length === 0) {
    return { ok: true, status: "ok" };
  }

  let previousValues: number[] | null = null;

  for (let index = 0; index <= options.segmentSampleCount; index += 1) {
    const progress = index / options.segmentSampleCount;
    const t = start.t + (end.t - start.t) * progress;
    const y = start.y + (end.y - start.y) * progress;
    const currentValues: number[] = [];

    for (let signalIndex = 0; signalIndex < signals.length; signalIndex += 1) {
      const signal = signals[signalIndex];
      const value = signal.evaluate(t, y);
      const diagnostics = signal.classify(value, options.domainTolerance);

      if (diagnostics.status !== "ok") {
        return {
          ok: false,
          status: diagnostics.status,
          reason: diagnostics.reason ?? "The step approaches a point where the ODE is undefined."
        };
      }

      if (
        previousValues &&
        crossesBoundary(previousValues[signalIndex], value, options.domainTolerance)
      ) {
        return {
          ok: false,
          status: "near-singular",
          reason: "The step crosses a point where the ODE is undefined."
        };
      }

      currentValues.push(value);
    }

    previousValues = currentValues;
  }

  return { ok: true, status: "ok" };
}

function normalizeEvaluationOptions(options: EvaluationOptions): NormalizedEvaluationOptions {
  return {
    domainTolerance: options.domainTolerance ?? DEFAULT_DOMAIN_TOLERANCE,
    derivativeMagnitudeLimit: options.derivativeMagnitudeLimit,
    segmentSampleCount: Math.max(
      1,
      Math.round(options.segmentSampleCount ?? DEFAULT_SEGMENT_SAMPLE_COUNT)
    )
  };
}

function finalizeDiagnostics(
  value: number,
  status: EvaluationStatus,
  options: NormalizedEvaluationOptions,
  reason?: string
): EvaluationDiagnostics {
  if (!Number.isFinite(value)) {
    return {
      value,
      status: "invalid",
      reason: reason ?? "The expression evaluates to a non-finite value."
    };
  }

  if (
    options.derivativeMagnitudeLimit !== undefined &&
    Math.abs(value) > options.derivativeMagnitudeLimit
  ) {
    return {
      value,
      status: mergeStatuses(status, "near-singular"),
      reason: reason ?? "The derivative is too large to step through reliably."
    };
  }

  return { value, status, reason };
}

function mergeStatuses(...statuses: EvaluationStatus[]): EvaluationStatus {
  if (statuses.includes("invalid")) {
    return "invalid";
  }

  if (statuses.includes("near-singular")) {
    return "near-singular";
  }

  return "ok";
}

function classifyNonzeroBoundary(
  value: number,
  tolerance: number,
  nearReason = "A denominator is close to zero."
): EvaluationDiagnostics {
  if (!Number.isFinite(value)) {
    return {
      value,
      status: "invalid",
      reason: "A domain boundary evaluated to a non-finite value."
    };
  }

  if (value === 0) {
    return {
      value,
      status: "invalid",
      reason: nearReason
    };
  }

  if (Math.abs(value) <= tolerance) {
    return {
      value,
      status: "near-singular",
      reason: nearReason
    };
  }

  return { value, status: "ok" };
}

function classifyLowerBoundary(
  value: number,
  isStrict: boolean,
  tolerance: number,
  invalidReason: string
): EvaluationDiagnostics {
  if (!Number.isFinite(value)) {
    return {
      value,
      status: "invalid",
      reason: "A domain boundary evaluated to a non-finite value."
    };
  }

  if (isStrict ? value <= 0 : value < 0) {
    return {
      value,
      status: "invalid",
      reason: invalidReason
    };
  }

  if (value <= tolerance) {
    return {
      value,
      status: "near-singular",
      reason: invalidReason
    };
  }

  return { value, status: "ok" };
}

function crossesBoundary(left: number, right: number, tolerance: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return true;
  }

  if (Math.abs(left) <= tolerance || Math.abs(right) <= tolerance) {
    return true;
  }

  return (left < 0 && right > 0) || (left > 0 && right < 0);
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
