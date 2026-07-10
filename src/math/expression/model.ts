export type VariableName = "t" | "y";

export type Operator = "+" | "-" | "*" | "/" | "^";

export type Token =
  | { type: "number"; value: number; lexeme: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: Operator }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma"; value: "," }
  | { type: "eof" };

export type ExpressionNode =
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

export interface NumericInterval {
  min: number;
  max: number;
}

export class ExpressionError extends Error {}
