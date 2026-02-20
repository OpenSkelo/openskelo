import { parse as parseExpression } from "acorn";

// Safe expression evaluator for gate.expr and edge transforms.
// Supports literals, logical/binary/unary expressions, conditionals,
// array/object literals, and member access rooted at allowed identifiers.
// Disallows function calls, assignments, constructors, and global access.
export function evaluateSafeExpression(expression: string, scope: Record<string, unknown>): unknown {
  const program = parseExpression(expression, { ecmaVersion: 2020 }) as unknown as {
    type: string;
    body?: Array<Record<string, unknown>>;
  };

  if (program.type !== "Program" || !Array.isArray(program.body) || program.body.length !== 1) {
    throw new Error("Expression must be a single expression");
  }

  const stmt = program.body[0] as Record<string, unknown>;
  if (stmt.type !== "ExpressionStatement") {
    throw new Error("Expression statement required");
  }

  return evalNode((stmt.expression as Record<string, unknown>), scope);
}

function evalNode(node: Record<string, unknown>, scope: Record<string, unknown>): unknown {
  const type = String(node.type ?? "");

  switch (type) {
    case "Literal":
      return node.value;

    case "Identifier": {
      const name = String(node.name ?? "");
      if (!(name in scope)) throw new Error(`Unknown identifier: ${name}`);
      return scope[name];
    }

    case "MemberExpression": {
      const obj = evalNode(node.object as Record<string, unknown>, scope);
      if (obj === null || obj === undefined) return undefined;
      const computed = Boolean(node.computed);
      const key = computed
        ? evalNode(node.property as Record<string, unknown>, scope)
        : String((node.property as Record<string, unknown>).name ?? "");
      if (typeof key !== "string" && typeof key !== "number") throw new Error("Invalid member key");
      return (obj as Record<string, unknown>)[String(key)];
    }

    case "UnaryExpression": {
      const op = String(node.operator ?? "");
      const arg = evalNode(node.argument as Record<string, unknown>, scope);
      if (op === "!") return !arg;
      if (op === "+") return Number(arg);
      if (op === "-") return -Number(arg);
      throw new Error(`Unsupported unary operator: ${op}`);
    }

    case "LogicalExpression": {
      const op = String(node.operator ?? "");
      if (op === "&&") return evalNode(node.left as Record<string, unknown>, scope) && evalNode(node.right as Record<string, unknown>, scope);
      if (op === "||") return evalNode(node.left as Record<string, unknown>, scope) || evalNode(node.right as Record<string, unknown>, scope);
      if (op === "??") {
        const left = evalNode(node.left as Record<string, unknown>, scope);
        return left ?? evalNode(node.right as Record<string, unknown>, scope);
      }
      throw new Error(`Unsupported logical operator: ${op}`);
    }

    case "BinaryExpression": {
      const op = String(node.operator ?? "");
      const left = evalNode(node.left as Record<string, unknown>, scope) as unknown;
      const right = evalNode(node.right as Record<string, unknown>, scope) as unknown;
      switch (op) {
        case "==": return left == right; // eslint-disable-line eqeqeq
        case "!=": return left != right; // eslint-disable-line eqeqeq
        case "===": return left === right;
        case "!==": return left !== right;
        case ">": return (left as number) > (right as number);
        case ">=": return (left as number) >= (right as number);
        case "<": return (left as number) < (right as number);
        case "<=": return (left as number) <= (right as number);
        case "+": return (left as number) + (right as number);
        case "-": return (left as number) - (right as number);
        case "*": return (left as number) * (right as number);
        case "/": return (left as number) / (right as number);
        case "%": return (left as number) % (right as number);
        default: throw new Error(`Unsupported binary operator: ${op}`);
      }
    }

    case "ConditionalExpression":
      return evalNode(node.test as Record<string, unknown>, scope)
        ? evalNode(node.consequent as Record<string, unknown>, scope)
        : evalNode(node.alternate as Record<string, unknown>, scope);

    case "ArrayExpression":
      return ((node.elements as Array<Record<string, unknown> | null>) ?? []).map((el) => (el ? evalNode(el, scope) : null));

    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      const props = (node.properties as Array<Record<string, unknown>>) ?? [];
      for (const p of props) {
        if (String(p.type) !== "Property") throw new Error("Unsupported object property");
        const keyNode = p.key as Record<string, unknown>;
        const key = keyNode.type === "Identifier" ? String(keyNode.name ?? "") : String(keyNode.value ?? "");
        out[key] = evalNode(p.value as Record<string, unknown>, scope);
      }
      return out;
    }

    case "TemplateLiteral": {
      const quasis = (node.quasis as Array<Record<string, unknown>>) ?? [];
      const exprs = (node.expressions as Array<Record<string, unknown>>) ?? [];
      let result = "";
      for (let i = 0; i < quasis.length; i++) {
        result += String((quasis[i].value as Record<string, unknown>)?.cooked ?? "");
        if (exprs[i]) result += String(evalNode(exprs[i], scope));
      }
      return result;
    }

    case "CallExpression":
    case "NewExpression":
    case "AssignmentExpression":
    case "UpdateExpression":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      throw new Error(`Disallowed expression node: ${type}`);

    default:
      throw new Error(`Unsupported expression node: ${type}`);
  }
}
