export type VariableName = "t" | "y";

export type Operator = "+" | "-" | "*" | "/" | "^";

export type Token =
  | { type: "number"; value: number; lexeme: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: Operator }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma"; value: "," }
  | { type: "eof" };

interface ExpressionPresentation {
  /** Source grouping used only when presenting the expression back to the user. */
  explicitGroupDepth?: number;
}

type PresentedNode<Node> = Node & ExpressionPresentation;

export type ExpressionNode =
  | PresentedNode<{ type: "number"; value: number; sourceLexeme?: string }>
  | PresentedNode<{ type: "variable"; name: VariableName }>
  | PresentedNode<{ type: "constant"; name: string; value: number }>
  | PresentedNode<{
      type: "unary";
      operator: "+" | "-";
      argument: ExpressionNode;
    }>
  | PresentedNode<{
      type: "binary";
      operator: Operator;
      left: ExpressionNode;
      right: ExpressionNode;
    }>
  | PresentedNode<{
      type: "function";
      name: string;
      arguments: ExpressionNode[];
    }>;

export interface NumericInterval {
  min: number;
  max: number;
}

export class ExpressionError extends Error {}
