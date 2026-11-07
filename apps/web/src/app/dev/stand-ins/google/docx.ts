/**
 * The stand-in's Word export of a Doc. A stand-in Doc is Markdown text; Google
 * exports a real Doc's own formatting, which the stand-in does not have, so
 * this keeps only what the text says: `#` headings as Word's Heading 1–3
 * styles, `- ` lines as bullets, the rest as paragraphs. Enough for the
 * connector to store a .docx and for the preview to lay it out as pages.
 */

import JSZip from "jszip";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function paragraph(text: string, style?: string): string {
    const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
    return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function bodyXml(markdown: string): string {
    return markdown
        .split("\n")
        .filter(line => line.trim() !== "")
        .map(line => {
            const heading = /^(#{1,3})\s+(.*)$/.exec(line);
            if (heading) return paragraph(heading[2]!, `Heading${heading[1]!.length}`);
            const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
            if (bullet) return paragraph(`• ${bullet[1]!}`);
            return paragraph(line);
        })
        .join("");
}

function headingStyle(level: number, halfPoints: number): string {
    return (
        `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
        `<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/>` +
        `<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${halfPoints}"/></w:rPr></w:style>`
    );
}

export async function docxFromMarkdown(markdown: string): Promise<Uint8Array<ArrayBuffer>> {
    const zip = new JSZip();
    zip.file(
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
            "</Types>"
    );
    zip.file(
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            "</Relationships>"
    );
    zip.file(
        "word/_rels/document.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            "</Relationships>"
    );
    zip.file(
        "word/styles.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD_NS}">` +
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
            '<w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
            headingStyle(1, 40) +
            headingStyle(2, 32) +
            headingStyle(3, 28) +
            "</w:styles>"
    );
    zip.file(
        "word/document.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_NS}">` +
            `<w:body>${bodyXml(markdown)}` +
            '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
            "</w:body></w:document>"
    );
    return zip.generateAsync({ type: "uint8array" }) as Promise<Uint8Array<ArrayBuffer>>;
}
