/** Parse quoted CSV/TSV cells, including escaped quotes and multiline values. */
export function delimitedPreview(text: string, delimiter: "," | "\t", maxRows = 100): string {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < text.length && rows.length < maxRows; index++) {
        const character = text[index]!;
        if (character === '"') {
            if (quoted && text[index + 1] === '"') {
                value += '"';
                index++;
            } else if (quoted || !value) quoted = !quoted;
            else value += character;
        } else if (!quoted && character === delimiter) {
            row.push(value);
            value = "";
        } else if (!quoted && (character === "\n" || character === "\r")) {
            if (character === "\r" && text[index + 1] === "\n") index++;
            row.push(value);
            rows.push(row);
            row = [];
            value = "";
        } else value += character;
    }
    if ((value || row.length) && rows.length < maxRows) {
        row.push(value);
        rows.push(row);
    }
    if (!rows.length) return "No rows in this file.";
    const columns = Math.min(50, Math.max(...rows.map(item => item.length)));
    const escaped = rows.map(item =>
        Array.from({ length: columns }, (_, column) =>
            (item[column] ?? "")
                .replace(/\\/g, "\\\\")
                .replace(/\|/g, "\\|")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\r?\n/g, "<br>")
        )
    );
    return (
        escaped
            .flatMap((item, index) => [
                `| ${item.join(" | ")} |`,
                ...(index === 0 ? [`| ${item.map(() => "---").join(" | ")} |`] : []),
            ])
            .join("\n") +
        (rows.length === maxRows
            ? `\n\nPreview limited to ${maxRows} rows. Save the file to read it in full.`
            : "")
    );
}

/** A fence longer than any fence in the file keeps code previews as code. */
export function fencedPreview(text: string, language: string): string {
    const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
    const fence = "`".repeat(longest + 1);
    return `${fence}${language}\n${text}\n${fence}`;
}
