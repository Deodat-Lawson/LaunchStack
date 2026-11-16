/** Strict comma-separated records, including quoted newlines. No trimming of evidence. */
export type CsvRecord = { cells: string[]; recordNumber: number; startLine: number };

export function parseCsv(input: string): CsvRecord[] {
    const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
    const records: CsvRecord[] = [];
    let cells: string[] = [];
    let field = "";
    let state: "start" | "plain" | "quoted" | "closed" = "start";
    let touched = false;
    let line = 1;
    let startLine = 1;
    const endField = () => {
        cells.push(field);
        field = "";
        state = "start";
    };
    const endRecord = () => {
        if (touched) {
            endField();
            records.push({ cells, recordNumber: records.length + 1, startLine });
        }
        cells = [];
        field = "";
        state = "start";
        touched = false;
    };
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (state === "quoted") {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else state = "closed";
            } else {
                field += char;
                if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
            }
            continue;
        }
        if (char === ",") {
            touched = true;
            endField();
        } else if (char === "\n" || char === "\r") {
            endRecord();
            if (char === "\r" && text[i + 1] === "\n") i++;
            line++;
            startLine = line;
        } else if (char === '"' && state === "start") {
            touched = true;
            state = "quoted";
        } else {
            if (char === '"' || state === "closed")
                throw new Error(`Malformed CSV quoting at line ${line}.`);
            touched = true;
            state = "plain";
            field += char;
        }
    }
    if (state === "quoted")
        throw new Error(`Unclosed CSV quote starting in record at line ${startLine}.`);
    endRecord();
    return records;
}
