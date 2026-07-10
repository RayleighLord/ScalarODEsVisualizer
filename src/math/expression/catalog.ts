interface FunctionDefinition {
  minArgs: number;
  maxArgs: number;
  evaluate: (...args: number[]) => number;
}

export const CONSTANTS = new Map<string, number>([
  ["pi", Math.PI],
  ["e", Math.E]
]);

/**
 * The single source of truth for supported functions, their arity, and their
 * numerical implementation. Syntax validation and evaluator compilation both
 * consume this catalog.
 */
export const FUNCTIONS = new Map<string, FunctionDefinition>([
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
