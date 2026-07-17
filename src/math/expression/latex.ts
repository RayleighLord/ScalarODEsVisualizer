import type { ExpressionNode } from "./model";

type BinaryNode = Extract<ExpressionNode, { type: "binary" }>;
type FunctionNode = Extract<ExpressionNode, { type: "function" }>;
type NumberNode = Extract<ExpressionNode, { type: "number" }>;

interface RenderContext {
  parentPrecedence?: number;
  preserveExplicitGrouping?: boolean;
  requiredGroup?: boolean;
}

interface SignExtraction {
  negative: boolean;
  magnitude: ExpressionNode;
}

const SUM_PRECEDENCE = 1;
const PRODUCT_PRECEDENCE = 2;
const SIGN_PRECEDENCE = 3;
const POWER_PRECEDENCE = 4;
const ATOM_PRECEDENCE = 5;

const SUPERSCRIPTABLE_FUNCTIONS = new Set([
  "acos",
  "asin",
  "atan",
  "cos",
  "cosh",
  "log",
  "sin",
  "sinh",
  "tan",
  "tanh"
]);

export function renderNodeAsLatex(
  node: ExpressionNode,
  parentPrecedence = 0
): string {
  return renderNode(node, { parentPrecedence });
}

function renderNode(node: ExpressionNode, context: RenderContext = {}): string {
  const content = renderNodeContent(node);
  const requiredGroup =
    context.requiredGroup === true ||
    visualPrecedence(node) < (context.parentPrecedence ?? 0);
  const explicitGroupDepth =
    context.preserveExplicitGrouping === false ? 0 : (node.explicitGroupDepth ?? 0);

  // One explicit group also satisfies a precedence-required group. Taking the
  // maximum retains deliberate nested groups without producing duplicates.
  return wrapLatex(
    content,
    Math.max(requiredGroup ? 1 : 0, explicitGroupDepth)
  );
}

function renderNodeContent(node: ExpressionNode): string {
  switch (node.type) {
    case "number":
      return formatNumberAsLatex(node);
    case "constant":
      return node.name === "pi" ? "\\pi" : "e";
    case "variable":
      return node.name;
    case "unary":
      return renderUnaryNodeAsLatex(node);
    case "binary":
      return renderBinaryNodeAsLatex(node);
    case "function":
      return renderFunctionNodeAsLatex(node);
  }
}

function renderUnaryNodeAsLatex(
  node: Extract<ExpressionNode, { type: "unary" }>
): string {
  const nestedSign = extractTermSign(node.argument);
  const negative = (node.operator === "-") !== nestedSign.negative;
  const prefix = negative ? "-" : node.operator === "+" ? "+" : "";
  const magnitude = renderNode(nestedSign.magnitude, {
    requiredGroup: isAdditiveNode(nestedSign.magnitude)
  });

  return prefix + magnitude;
}

function renderBinaryNodeAsLatex(node: BinaryNode): string {
  switch (node.operator) {
    case "+":
    case "-":
      return renderAdditiveNodeAsLatex(node);
    case "*":
      return renderProductAsLatex(node.left, node.right);
    case "/":
      return renderQuotientAsLatex(node.left, node.right);
    case "^":
      return renderPowerAsLatex(node.left, node.right);
  }
}

function renderAdditiveNodeAsLatex(node: BinaryNode): string {
  const rightSign = extractTermSign(node.right);
  const operator =
    rightSign.negative === true
      ? node.operator === "+"
        ? "-"
        : "+"
      : node.operator;
  const left = renderNode(node.left, { parentPrecedence: SUM_PRECEDENCE });
  const right = renderNode(rightSign.magnitude, {
    requiredGroup: operator === "-" && isAdditiveNode(rightSign.magnitude)
  });

  return left + " " + operator + " " + right;
}

function renderProductAsLatex(
  leftNode: ExpressionNode,
  rightNode: ExpressionNode
): string {
  const leftSign = extractTermSign(leftNode);
  const rightSign = extractTermSign(rightNode);
  const prefix = leftSign.negative !== rightSign.negative ? "-" : "";
  const left = renderNode(leftSign.magnitude, {
    parentPrecedence: PRODUCT_PRECEDENCE
  });
  const right = renderNode(rightSign.magnitude, {
    parentPrecedence: PRODUCT_PRECEDENCE
  });

  return prefix + left + " \\cdot " + right;
}

function renderQuotientAsLatex(
  numeratorNode: ExpressionNode,
  denominatorNode: ExpressionNode
): string {
  const numerator = extractTermSign(numeratorNode, true);
  const denominator = extractTermSign(denominatorNode, true);
  const prefix = numerator.negative !== denominator.negative ? "-" : "";

  return (
    prefix +
    "\\frac{" +
    renderDelimitedNode(numerator.magnitude) +
    "}{" +
    renderDelimitedNode(denominator.magnitude) +
    "}"
  );
}

function renderPowerAsLatex(base: ExpressionNode, exponent: ExpressionNode): string {
  const exponentLatex = renderDelimitedNode(exponent);
  const ambiguousInverseFunctionPower =
    base.type === "function" &&
    SUPERSCRIPTABLE_FUNCTIONS.has(base.name) &&
    isLiteralNegativeOne(exponent);

  if (
    base.type === "function" &&
    (base.explicitGroupDepth ?? 0) === 0 &&
    SUPERSCRIPTABLE_FUNCTIONS.has(base.name) &&
    !ambiguousInverseFunctionPower
  ) {
    return renderFunctionPowerAsLatex(base, exponentLatex);
  }

  return (
    renderPowerBase(base, ambiguousInverseFunctionPower) +
    "^{" +
    exponentLatex +
    "}"
  );
}

function renderPowerBase(node: ExpressionNode, forceGroup = false): string {
  const isOrdinaryAtom =
    node.type === "variable" ||
    node.type === "constant" ||
    (node.type === "number" && !usesScientificNotation(node)) ||
    (node.type === "function" && node.name !== "pow");

  return renderNode(node, { requiredGroup: forceGroup || !isOrdinaryAtom });
}

function renderFunctionNodeAsLatex(node: FunctionNode): string {
  if (node.name === "abs") {
    return "\\left|" + renderDelimitedNode(node.arguments[0]) + "\\right|";
  }

  if (node.name === "sqrt") {
    return "\\sqrt{" + renderDelimitedNode(node.arguments[0]) + "}";
  }

  if (node.name === "floor") {
    return (
      "\\left\\lfloor " +
      renderDelimitedNode(node.arguments[0]) +
      " \\right\\rfloor"
    );
  }

  if (node.name === "ceil") {
    return (
      "\\left\\lceil " +
      renderDelimitedNode(node.arguments[0]) +
      " \\right\\rceil"
    );
  }

  if (node.name === "pow") {
    return renderPowerAsLatex(node.arguments[0], node.arguments[1]);
  }

  const argumentsLatex = node.arguments.map(renderDelimitedNode).join(", ");
  return latexFunctionName(node.name) + "\\left(" + argumentsLatex + "\\right)";
}

function renderFunctionPowerAsLatex(node: FunctionNode, exponentLatex: string): string {
  const argumentsLatex = node.arguments.map(renderDelimitedNode).join(", ");
  return (
    latexFunctionName(node.name) +
    "^{" +
    exponentLatex +
    "}\\left(" +
    argumentsLatex +
    "\\right)"
  );
}

function renderDelimitedNode(node: ExpressionNode): string {
  // Fraction braces, exponent braces, radicals, and function delimiters carry
  // the source's top-level grouping without needing redundant parentheses.
  return renderNode(node, { preserveExplicitGrouping: false });
}

function latexFunctionName(name: string): string {
  switch (name) {
    case "acos":
      return "\\arccos";
    case "asin":
      return "\\arcsin";
    case "atan":
      return "\\arctan";
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
      return "\\" + name;
    default:
      return "\\operatorname{" + name + "}";
  }
}

function extractTermSign(
  node: ExpressionNode,
  ignoreRootGrouping = false,
  isRoot = true,
  ignoreGroupedUnaryChain = ignoreRootGrouping
): SignExtraction {
  if (
    (node.explicitGroupDepth ?? 0) > 0 &&
    !(ignoreRootGrouping && isRoot) &&
    !(ignoreGroupedUnaryChain && node.type === "unary")
  ) {
    return { negative: false, magnitude: node };
  }

  if (node.type === "unary") {
    const nested = extractTermSign(
      node.argument,
      false,
      false,
      ignoreGroupedUnaryChain
    );
    return {
      negative: (node.operator === "-") !== nested.negative,
      magnitude: nested.magnitude
    };
  }

  if (
    node.type === "binary" &&
    (node.operator === "*" || node.operator === "/")
  ) {
    const left = extractTermSign(node.left, false, false, false);
    const right = extractTermSign(node.right, false, false, false);
    return {
      negative: left.negative !== right.negative,
      magnitude: {
        ...node,
        left: left.magnitude,
        right: right.magnitude
      }
    };
  }

  return { negative: false, magnitude: node };
}

function isAdditiveNode(node: ExpressionNode): boolean {
  return node.type === "binary" && (node.operator === "+" || node.operator === "-");
}

function isLiteralNegativeOne(node: ExpressionNode): boolean {
  let current = node;
  let negative = false;

  while (current.type === "unary") {
    if (current.operator === "-") {
      negative = !negative;
    }
    current = current.argument;
  }

  return negative && current.type === "number" && current.value === 1;
}

function visualPrecedence(node: ExpressionNode): number {
  switch (node.type) {
    case "number":
    case "variable":
    case "constant":
      return ATOM_PRECEDENCE;
    case "function":
      return node.name === "pow" ? POWER_PRECEDENCE : ATOM_PRECEDENCE;
    case "unary":
      return SIGN_PRECEDENCE;
    case "binary":
      switch (node.operator) {
        case "+":
        case "-":
          return SUM_PRECEDENCE;
        case "*":
          return PRODUCT_PRECEDENCE;
        case "/":
          return ATOM_PRECEDENCE;
        case "^":
          return POWER_PRECEDENCE;
      }
  }
}

function wrapLatex(content: string, groupDepth: number): string {
  let grouped = content;
  for (let depth = 0; depth < groupDepth; depth += 1) {
    grouped = "\\left(" + grouped + "\\right)";
  }
  return grouped;
}

function formatNumberAsLatex(node: NumberNode): string {
  const valueText = String(node.value);
  const sourceUsesScientificNotation = /e/i.test(node.sourceLexeme ?? "");

  if (!sourceUsesScientificNotation) {
    return /e/i.test(valueText) ? expandScientificNumber(valueText) : valueText;
  }

  return formatScientificNumber(node.value.toExponential());
}

function formatScientificNumber(text: string): string {
  const scientific = /^(-?)(\d+(?:\.\d+)?)e([+-]?\d+)$/i.exec(text);
  if (!scientific) {
    return text;
  }

  const coefficient = scientific[1] + scientific[2];
  const exponent = String(Number(scientific[3]));
  if (coefficient === "0" || coefficient === "-0") {
    return "0";
  }
  if (coefficient === "1") {
    return "10^{" + exponent + "}";
  }
  if (coefficient === "-1") {
    return "-10^{" + exponent + "}";
  }
  return coefficient + " \\times 10^{" + exponent + "}";
}

function expandScientificNumber(text: string): string {
  const scientific = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text);
  if (!scientific) {
    return text;
  }

  const sign = scientific[1];
  const integerDigits = scientific[2];
  const fractionalDigits = scientific[3] ?? "";
  const digits = integerDigits + fractionalDigits;
  const decimalIndex = integerDigits.length + Number(scientific[4]);

  if (decimalIndex <= 0) {
    return sign + "0." + "0".repeat(-decimalIndex) + digits;
  }
  if (decimalIndex >= digits.length) {
    return sign + digits + "0".repeat(decimalIndex - digits.length);
  }
  return (
    sign +
    digits.slice(0, decimalIndex) +
    "." +
    digits.slice(decimalIndex)
  );
}

function usesScientificNotation(node: NumberNode): boolean {
  return node.value !== 0 && /e/i.test(node.sourceLexeme ?? "");
}
