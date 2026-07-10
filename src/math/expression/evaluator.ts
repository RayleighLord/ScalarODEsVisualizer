import { FUNCTIONS } from "./catalog";
import { ExpressionError, type ExpressionNode, type VariableName } from "./model";

export type NodeEvaluator = (t: number, y: number) => number;

/** Compiles the AST once into allocation-light numerical closures. */
export function compileNodeEvaluator(node: ExpressionNode): NodeEvaluator {
  switch (node.type) {
    case "number":
    case "constant": {
      const value = node.value;
      return () => value;
    }
    case "variable":
      return node.name === "t" ? (t) => t : (_t, y) => y;
    case "unary": {
      const argument = compileNodeEvaluator(node.argument);
      return node.operator === "-"
        ? (t, y) => -argument(t, y)
        : (t, y) => argument(t, y);
    }
    case "binary": {
      const left = compileNodeEvaluator(node.left);
      const right = compileNodeEvaluator(node.right);

      switch (node.operator) {
        case "+":
          return (t, y) => left(t, y) + right(t, y);
        case "-":
          return (t, y) => left(t, y) - right(t, y);
        case "*":
          return (t, y) => left(t, y) * right(t, y);
        case "/":
          return (t, y) => left(t, y) / right(t, y);
        case "^":
          return (t, y) => left(t, y) ** right(t, y);
      }
    }
    case "function": {
      const definition = FUNCTIONS.get(node.name);
      if (!definition) {
        throw new ExpressionError(`Unsupported function "${node.name}".`);
      }

      const argumentsList = node.arguments.map(compileNodeEvaluator);
      if (argumentsList.length === 1) {
        const first = argumentsList[0];
        return (t, y) => definition.evaluate(first(t, y));
      }

      if (argumentsList.length === 2) {
        const first = argumentsList[0];
        const second = argumentsList[1];
        return (t, y) => definition.evaluate(first(t, y), second(t, y));
      }

      if (node.name === "min" || node.name === "max") {
        const choose = node.name === "min" ? Math.min : Math.max;
        return (t, y) => {
          let value = argumentsList[0](t, y);
          for (let index = 1; index < argumentsList.length; index += 1) {
            value = choose(value, argumentsList[index](t, y));
          }
          return value;
        };
      }

      return (t, y) => {
        const values = new Array<number>(argumentsList.length);
        for (let index = 0; index < argumentsList.length; index += 1) {
          values[index] = argumentsList[index](t, y);
        }
        return definition.evaluate(...values);
      };
    }
  }
}

/** A conservative symbolic proof used for autonomous and equilibrium metadata. */
export function isStaticallyZero(node: ExpressionNode): boolean {
  switch (node.type) {
    case "number":
    case "constant":
      return node.value === 0;
    case "variable":
      return false;
    case "unary":
      return isStaticallyZero(node.argument);
    case "binary": {
      switch (node.operator) {
        case "+":
          return (
            (isStaticallyZero(node.left) && isStaticallyZero(node.right)) ||
            nodesAreAdditiveInverses(node.left, node.right)
          );
        case "-":
          return (
            structurallyEqual(node.left, node.right) ||
            (isStaticallyZero(node.left) && isStaticallyZero(node.right))
          );
        case "*":
          return isStaticallyZero(node.left) || isStaticallyZero(node.right);
        case "/": {
          const denominator = evaluateConstantNode(node.right);
          return (
            isStaticallyZero(node.left) &&
            denominator !== null &&
            Number.isFinite(denominator) &&
            denominator !== 0
          );
        }
        case "^": {
          const exponent = evaluateConstantNode(node.right);
          return isStaticallyZero(node.left) && exponent !== null && exponent > 0;
        }
      }
    }
    case "function": {
      const value = evaluateConstantNode(node);
      return value !== null && value === 0;
    }
  }
}

export function nodesAreAdditiveInverses(
  left: ExpressionNode,
  right: ExpressionNode
): boolean {
  return (
    (left.type === "unary" &&
      left.operator === "-" &&
      structurallyEqual(left.argument, right)) ||
    (right.type === "unary" &&
      right.operator === "-" &&
      structurallyEqual(left, right.argument))
  );
}

export function structurallyEqual(left: ExpressionNode, right: ExpressionNode): boolean {
  if (left.type !== right.type) {
    return false;
  }

  switch (left.type) {
    case "number":
      return right.type === "number" && left.value === right.value;
    case "constant":
      return right.type === "constant" && left.name === right.name;
    case "variable":
      return right.type === "variable" && left.name === right.name;
    case "unary":
      return (
        right.type === "unary" &&
        left.operator === right.operator &&
        structurallyEqual(left.argument, right.argument)
      );
    case "binary":
      return (
        right.type === "binary" &&
        left.operator === right.operator &&
        structurallyEqual(left.left, right.left) &&
        structurallyEqual(left.right, right.right)
      );
    case "function":
      return (
        right.type === "function" &&
        left.name === right.name &&
        left.arguments.length === right.arguments.length &&
        left.arguments.every((argument, index) =>
          structurallyEqual(argument, right.arguments[index])
        )
      );
  }
}

export function evaluateConstantNode(node: ExpressionNode): number | null {
  const variables = collectVariables(node);
  if (variables.size > 0) {
    return null;
  }

  const value = compileNodeEvaluator(node)(0, 0);
  return Number.isFinite(value) ? value : null;
}

export function collectSemanticVariables(
  node: ExpressionNode,
  variables = new Set<VariableName>()
): Set<VariableName> {
  // Algebraically canceled terms can be ignored only when evaluating the
  // subtree cannot itself fail. This makes `t-t` and `0*t` autonomous without
  // erasing the time-domain hole in expressions such as `0/t` or `0*(1/t)`.
  if (isStaticallyZero(node) && !hasDomainRestriction(node)) {
    return variables;
  }

  switch (node.type) {
    case "variable":
      variables.add(node.name);
      return variables;
    case "unary":
      return collectSemanticVariables(node.argument, variables);
    case "binary":
      collectSemanticVariables(node.left, variables);
      collectSemanticVariables(node.right, variables);
      return variables;
    case "function":
      node.arguments.forEach((argument) => collectSemanticVariables(argument, variables));
      return variables;
    default:
      return variables;
  }
}

function hasDomainRestriction(node: ExpressionNode): boolean {
  switch (node.type) {
    case "unary":
      return hasDomainRestriction(node.argument);
    case "binary":
      return (
        node.operator === "/" ||
        (node.operator === "^" && powerHasDomainRestriction(node.right)) ||
        hasDomainRestriction(node.left) ||
        hasDomainRestriction(node.right)
      );
    case "function":
      return (
        node.name === "log" ||
        node.name === "sqrt" ||
        node.name === "asin" ||
        node.name === "acos" ||
        node.name === "tan" ||
        (node.name === "pow" && powerHasDomainRestriction(node.arguments[1])) ||
        node.arguments.some(hasDomainRestriction)
      );
    default:
      return false;
  }
}

function powerHasDomainRestriction(exponentNode: ExpressionNode): boolean {
  const exponent = evaluateConstantNode(exponentNode);
  return exponent !== null && exponent !== 0 && (exponent < 0 || !Number.isInteger(exponent));
}

function collectVariables(
  node: ExpressionNode,
  variables = new Set<VariableName>()
): Set<VariableName> {
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
