/**
 * Post-process LLM chat responses into clean markdown.
 *
 * Several LangChain providers return `AIMessageChunk.content` as either a
 * string or an array of content parts (text + tool use + images). This
 * helper flattens that to a string, then normalizes LaTeX equation
 * delimiters into dollar-sign notation so downstream markdown renderers
 * (react-markdown + remark-math) pick them up consistently.
 *
 * Lifted from apps/web's documentQ&A services so features can import it
 * directly from core without reaching back into apps/web.
 */

function convertLatexDelimitersToDollarSigns(text: string): string {
  text = text.replace(/\\\[/g, "$$");
  text = text.replace(/\\\]/g, "$$");
  text = text.replace(/\\\(/g, "$");
  text = text.replace(/\\\)/g, "$");
  return text;
}

function convertParenthesesNotationToLatex(text: string): string {
  text = text.replace(/\(\(([^()]+)\)\)/g, (_match, equation: string) => {
    return `$(${equation.trim()})$`;
  });

  text = text.replace(
    /\(([^(),]*(?:\\[a-zA-Z]+|[_^=])[^(),]*)\)/g,
    (_match, equation: string) => {
      return `$${equation.trim()}$`;
    },
  );

  text = text.replace(
    /(?<![a-zA-Z])\(([a-zA-Z])\)(?!\w)/g,
    (_match, letter: string) => {
      return `$${letter}$`;
    },
  );

  return text;
}

function convertBracketNotationToLatex(text: string): string {
  text = text.replace(
    /(\n|^)\s*\[\s*(\\[a-zA-Z]+|[^\[\]]*(?:\\[a-zA-Z]+|[_^{}])[^\[\]]*)\s*\]\s*(?=\n|$)/g,
    (_match, _prefix, equation: string) => {
      return `$$${equation.trim()}$$`;
    },
  );

  text = text.replace(
    /\[\s+((?:\\[a-zA-Z]+|[^\[\]]*(?:\\[a-zA-Z]+|[_^{}])[^\[\]]*)+)\s+\]/g,
    (_match, equation: string) => {
      return `$${equation.trim()}$`;
    },
  );

  return text;
}

export function normalizeModelContent(content: unknown): string {
  if (typeof content === "string") {
    let result = convertLatexDelimitersToDollarSigns(content);
    result = convertBracketNotationToLatex(result);
    result = convertParenthesesNotationToLatex(result);
    return result;
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("");
    let result = convertLatexDelimitersToDollarSigns(joined);
    result = convertBracketNotationToLatex(result);
    result = convertParenthesesNotationToLatex(result);
    return result;
  }

  if (content == null) {
    return "";
  }

  try {
    return JSON.stringify(content);
  } catch {
    return Object.prototype.toString.call(content);
  }
}
