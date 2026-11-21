// Deterministic fictional workspace. Reads source documents and manifest only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export async function generateLongDocuments(
    destination = resolve(root, "docs/samples/vantage/harborlight-long")
) {
    const source = resolve(root, "docs/samples/vantage/harborlight-release");
    const original = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
    let state = 20261121;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
    };
    const categories = [
        "specs",
        "meetings",
        "qa",
        "security",
        "customers",
        "finance",
        "roadmap",
        "hiring",
        "office",
    ];
    const documents = original.documents.map(doc => ({ ...doc }));
    for (let index = documents.length; index < 50; index++) {
        const category = categories[index % categories.length];
        const key =
            index === 12
                ? "finance-decoy"
                : index === 13
                  ? "restricted-security"
                  : `${category}-${index}`;
        documents.push({
            key,
            title: `Harborlight ${category} working record ${index}`,
            category,
            restricted: index === 13,
            versions: [{ file: `${key}.md`, versionNumber: 1, createdAt: "2026-11-12T12:00:00Z" }],
        });
    }
    for (const key of ["qa-retest", "security-review"]) {
        const doc = documents.find(document => document.key === key);
        doc.versions = [
            ...doc.versions,
            { file: `${key}-v2.md`, versionNumber: 2, createdAt: "2026-11-14T12:00:00Z" },
        ];
    }
    await mkdir(destination, { recursive: true });
    for (const doc of documents) {
        for (const version of doc.versions.filter(
            version =>
                !(["qa-retest", "security-review"].includes(doc.key) && version.versionNumber === 2)
        )) {
            let evidence;
            if (original.documents.some(item => item.key === doc.key)) {
                evidence = await readFile(
                    resolve(
                        source,
                        original.documents
                            .find(item => item.key === doc.key)
                            .versions.find(item => item.versionNumber === version.versionNumber)
                            ?.file ??
                            original.documents.find(item => item.key === doc.key).versions.at(-1)
                                .file
                    ),
                    "utf8"
                );
            } else if (doc.key === "finance-decoy") {
                evidence =
                    "Booked contract value is $480,000 including unsigned proposals. This metric is not recognized recurring revenue.\n";
            } else if (doc.restricted) {
                evidence =
                    "CONFIDENTIAL RESTRICTED: security exception investigation belongs to a separate customer.\n";
            } else {
                evidence = `Working notes for ${doc.category}. Discuss scheduling and housekeeping with the team. No Atlas launch authorization is recorded here.\n`;
            }
            const target = 26000 + (random() % 7000);
            let filler = "";
            while (filler.length < target) {
                filler += `Record ${random() % 100000}: routine ${doc.category} work, archived logistics and fictional operational detail. This paragraph records background activity only.\n`;
            }
            const prefixLength = Math.floor(target * 0.55);
            const header = `# ${doc.title}\n\n`;
            const text =
                header +
                filler.slice(0, prefixLength - header.length) +
                "\n" +
                evidence +
                "\n" +
                filler.slice(prefixLength, target - evidence.length - 2);
            await writeFile(resolve(destination, version.file), text, "utf8");
        }
    }
    for (const key of ["qa-retest", "security-review"]) {
        const doc = documents.find(document => document.key === key);
        const text = await readFile(resolve(destination, doc.versions[0].file), "utf8");
        await writeFile(
            resolve(destination, doc.versions[1].file),
            text.replace("Record ", "Updated record "),
            "utf8"
        );
    }
    const manifest = {
        ...original,
        corpusId: "harborlight-long-weekly-2026-11-16",
        seed: 20261121,
        suggestedRequiredKeys: ["weekly-priorities"],
        suggestedStarKeys: ["finance-definitions"],
        documents,
    };
    await writeFile(
        resolve(destination, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n"
    );
    return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    await generateLongDocuments();
}
