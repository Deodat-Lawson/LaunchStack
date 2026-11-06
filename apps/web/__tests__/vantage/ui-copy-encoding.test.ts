import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

const roots = ["src/app/employer/tools/vantage", "src/components/vantage-context"];
function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(file) : /\.(tsx?|css)$/.test(file) ? [file] : [];
    });
}

it("keeps Vantage source copy valid UTF-8 without replacement characters or known mojibake", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const file of roots.flatMap(root => sourceFiles(path.resolve(root)))) {
        const text = decoder.decode(readFileSync(file));
        expect({ file, corrupt: /[\ufffd\u00c2\u00c3]|\u00e2[\u0080\u20ac]/.test(text) }).toEqual({
            file,
            corrupt: false,
        });
    }
});

it("does not regress the known replay and saved-report separator substitutions", () => {
    const source = readFileSync(
        path.resolve("src/app/employer/tools/vantage/_screens/ContextDemoScreen.tsx"),
        "utf8"
    );
    expect(source).not.toContain("Sample report ? recorded replay ? no live AI call");
    expect(source).not.toContain("Saved report ? suggestions for human review");
});
