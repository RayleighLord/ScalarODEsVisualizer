import { CONSTANTS, FUNCTIONS } from "./catalog";
import {
  ExpressionError,
  type ExpressionNode,
  type Operator,
  type Token
} from "./model";

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
      return { type: "number", value: token.value, sourceLexeme: token.lexeme };
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
        // Exponentiation binds more tightly than a leading sign (`-y^2` is
        // `-(y^2)`), while the exponent's right binding power still permits a
        // signed exponent (`y^-2`).
        argument: this.parseExpression(5)
      };
    }

    if (token.type === "paren" && token.value === "(") {
      const expression = this.parseExpression(0);
      const closing = this.consume();
      if (closing.type !== "paren" || closing.value !== ")") {
        throw new ExpressionError('Expected ")" to close the current group.');
      }
      return {
        ...expression,
        explicitGroupDepth: (expression.explicitGroupDepth ?? 0) + 1
      };
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

export function parseExpression(source: string): ExpressionNode {
  return new PrattParser(source).parse();
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
