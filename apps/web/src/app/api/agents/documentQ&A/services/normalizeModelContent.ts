/**
 * Converts LaTeX standard delimiters \[ \] and \( \) to dollar sign notation
 * This handles AI responses that use standard LaTeX math delimiters.
 */
function convertLatexDelimitersToDollarSigns(text: string): string {
  // Convert display math: \[ ... \] → $$ ... $$
  text = text.replace(/\\\[/g, '$$');
  text = text.replace(/\\\]/g, '$$');
  
  // Convert inline math: \( ... \) → $ ... $
  text = text.replace(/\\\(/g, '$');
  text = text.replace(/\\\)/g, '$');
  
  return text;
}

/**
 * Converts LaTeX parentheses notation ( ... ) to dollar sign notation $ ... $
 * This handles AI responses that use parentheses for inline equations.
 */
function convertParenthesesNotationToLatex(text: string): string {
  // Pattern to match LaTeX equations in parentheses
  // Looks for ( followed by LaTeX content (backslashes, subscripts, superscripts) and closing )
  // Must contain LaTeX indicators to avoid converting regular text like "func(x, y)"
  
  // First, handle nested parentheses (like domain ranges) before single parentheses
  // Pattern: (( content )) where content contains numbers, commas, or math
  // Preserve the inner parentheses in the output
  text = text.replace(/\(\(([^()]+)\)\)/g, (_match, equation: string) => {
    return `$(${equation.trim()})$`;
  });
  
  // Match parentheses containing LaTeX syntax or equations
  // Examples: (C_n), (a = 0), (\sum...)
  // Pattern: ( followed by either:
  //   - Backslash commands: \sum, \frac, etc.
  //   - Subscripts/superscripts: C_n, x^2
  //   - Equations with =: a = 0
  // Exclude commas to avoid function calls like func(x, y)
  text = text.replace(/\(([^(),]*(?:\\[a-zA-Z]+|[_^=])[^(),]*)\)/g, (_match, equation: string) => {
    return `$${equation.trim()}$`;
  });
  
  // Handle single letter variables in parentheses: (x), (a), (n)
  // But NOT function calls like func(x) - check that there's no word character before the (
  text = text.replace(/(?<![a-zA-Z])\(([a-zA-Z])\)(?!\w)/g, (_match, letter: string) => {
    return `$${letter}$`;
  });
  
  return text;
}

/**
 * Converts LaTeX bracket notation [ ... ] to dollar sign notation $ ... $ or $$ ... $$
 * This handles AI responses that use square brackets for equations instead of dollar signs.
 */
function convertBracketNotationToLatex(text: string): string {
  // Pattern to match LaTeX equations in square brackets
  // Looks for [ followed by LaTeX content (backslashes, math symbols, etc.) and closing ]
  // Must have space after opening bracket and before closing bracket to avoid matching array access like arr[0]
  
  // First, handle display equations (on their own line or with newlines)
  // Pattern: newline or start, optional whitespace, [, content, ], optional whitespace, newline or end
  text = text.replace(/(\n|^)\s*\[\s*(\\[a-zA-Z]+|[^\[\]]*(?:\\[a-zA-Z]+|[_^{}])[^\[\]]*)\s*\]\s*(?=\n|$)/g, 
    (_match, _prefix, equation: string) => {
      return `$$${equation.trim()}$$`;
    }
  );
  
  // Then handle inline equations (with spaces around brackets to avoid array access)
  // Pattern: [ space, content with LaTeX, space ]
  text = text.replace(/\[\s+((?:\\[a-zA-Z]+|[^\[\]]*(?:\\[a-zA-Z]+|[_^{}])[^\[\]]*)+)\s+\]/g, 
    (_match, equation: string) => {
      return `$${equation.trim()}$`;
    }
  );
  
  return text;
}

export function normalizeModelContent(content: unknown): string {
  if (typeof content === "string") {
    // Apply conversions in order: LaTeX delimiters first, then brackets, then parentheses
    let result = convertLatexDelimitersToDollarSigns(content);
    result = convertBracketNotationToLatex(result);
    result = convertParenthesesNotationToLatex(result);
    return result;
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) =>
        typeof part === "string" ? part : JSON.stringify(part)
      )
      .join("");
    // Apply conversions in order: LaTeX delimiters first, then brackets, then parentheses
    let result = convertLatexDelimitersToDollarSigns(joined);
    result = convertBracketNotationToLatex(result);
    result = convertParenthesesNotationToLatex(result);
    return result;
  }

  if (content == null) {
    return "";
  }

  // Fallback: best-effort stringification for other structures
  try {
    return JSON.stringify(content);
  } catch {
    return Object.prototype.toString.call(content);
  }
}

export default normalizeModelContent;

