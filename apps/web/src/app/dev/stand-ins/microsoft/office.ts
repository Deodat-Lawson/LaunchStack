/**
 * Real, small file payloads for the Microsoft stand-in, built synchronously so
 * the world can be seeded in one pass: Word and Excel files (stored, i.e.
 * uncompressed, zip packages with the minimum parts each format needs), a
 * one-page PDF, and OneDrive's quickXorHash.
 *
 * The Word parts follow ../google/docx.ts: `#` headings become Heading 1–3,
 * `- ` lines become bullets, everything else a paragraph.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function utf8(text: string): Bytes {
    return encoder.encode(text);
}

// ── Zip (stored entries only) ──────────────────────────────────────────────

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** 1 January 2026, 00:00 — a fixed stamp, so the same parts give the same bytes. */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zip(parts: [name: string, body: string][]): Bytes {
    const entries = parts.map(([name, body]) => {
        const data = utf8(body);
        return { name: utf8(name), data, crc: crc32(data) };
    });
    const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
    const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let at = 0;
    const offsets: number[] = [];

    for (const e of entries) {
        offsets.push(at);
        view.setUint32(at, 0x04034b50, true);
        view.setUint16(at + 4, 20, true); // version needed
        view.setUint16(at + 10, 0, true); // time
        view.setUint16(at + 12, DOS_DATE, true);
        view.setUint32(at + 14, e.crc, true);
        view.setUint32(at + 18, e.data.length, true);
        view.setUint32(at + 22, e.data.length, true);
        view.setUint16(at + 26, e.name.length, true);
        out.set(e.name, at + 30);
        out.set(e.data, at + 30 + e.name.length);
        at += 30 + e.name.length + e.data.length;
    }
    const centralStart = at;
    entries.forEach((e, i) => {
        view.setUint32(at, 0x02014b50, true);
        view.setUint16(at + 4, 20, true); // version made by
        view.setUint16(at + 6, 20, true); // version needed
        view.setUint16(at + 14, DOS_DATE, true);
        view.setUint32(at + 16, e.crc, true);
        view.setUint32(at + 20, e.data.length, true);
        view.setUint32(at + 24, e.data.length, true);
        view.setUint16(at + 28, e.name.length, true);
        view.setUint32(at + 42, offsets[i]!, true);
        out.set(e.name, at + 46);
        at += 46 + e.name.length;
    });
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 8, entries.length, true);
    view.setUint16(at + 10, entries.length, true);
    view.setUint32(at + 12, centralSize, true);
    view.setUint32(at + 16, centralStart, true);
    return out;
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function contentTypes(overrides: [part: string, type: string][]): string {
    return (
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join("") +
        "</Types>"
    );
}

function relationships(rels: [type: string, target: string][]): string {
    return (
        `${XML}<Relationships xmlns="${PACKAGE_RELS}">` +
        rels
            .map(
                ([type, target], i) =>
                    `<Relationship Id="rId${i + 1}" Type="${OFFICE_RELS}/${type}" Target="${target}"/>`
            )
            .join("") +
        "</Relationships>"
    );
}

// ── Word ───────────────────────────────────────────────────────────────────

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WORD_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml";

function paragraph(text: string, style?: string): string {
    const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
    return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function headingStyle(level: number, halfPoints: number): string {
    return (
        `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
        `<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/>` +
        `<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${halfPoints}"/></w:rPr></w:style>`
    );
}

export function docxFromMarkdown(markdown: string): Bytes {
    const body = markdown
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
    return zip([
        [
            "[Content_Types].xml",
            contentTypes([
                ["/word/document.xml", `${WORD_TYPE}.document.main+xml`],
                ["/word/styles.xml", `${WORD_TYPE}.styles+xml`],
            ]),
        ],
        ["_rels/.rels", relationships([["officeDocument", "word/document.xml"]])],
        ["word/_rels/document.xml.rels", relationships([["styles", "styles.xml"]])],
        [
            "word/styles.xml",
            `${XML}<w:styles xmlns:w="${WORD_NS}">` +
                '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
                '<w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
                headingStyle(1, 40) +
                headingStyle(2, 32) +
                headingStyle(3, 28) +
                "</w:styles>",
        ],
        [
            "word/document.xml",
            `${XML}<w:document xmlns:w="${WORD_NS}"><w:body>${body}` +
                '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
                '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
                "</w:body></w:document>",
        ],
    ]);
}

// ── Excel ──────────────────────────────────────────────────────────────────

const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const SHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml";

function columnName(index: number): string {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
}

/** One worksheet; numbers stay numbers, everything else is an inline string. */
export function xlsxFromRows(rows: (string | number)[][], sheetName = "Sheet1"): Bytes {
    const sheet = rows
        .map((row, r) => {
            const cells = row
                .map((value, c) => {
                    const ref = `${columnName(c)}${r + 1}`;
                    return typeof value === "number"
                        ? `<c r="${ref}"><v>${value}</v></c>`
                        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
                })
                .join("");
            return `<row r="${r + 1}">${cells}</row>`;
        })
        .join("");
    return zip([
        [
            "[Content_Types].xml",
            contentTypes([
                ["/xl/workbook.xml", `${SHEET_TYPE}.sheet.main+xml`],
                ["/xl/worksheets/sheet1.xml", `${SHEET_TYPE}.worksheet+xml`],
            ]),
        ],
        ["_rels/.rels", relationships([["officeDocument", "xl/workbook.xml"]])],
        ["xl/_rels/workbook.xml.rels", relationships([["worksheet", "worksheets/sheet1.xml"]])],
        [
            "xl/workbook.xml",
            `${XML}<workbook xmlns="${SHEET_NS}" xmlns:r="${OFFICE_RELS}">` +
                `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        ],
        [
            "xl/worksheets/sheet1.xml",
            `${XML}<worksheet xmlns="${SHEET_NS}"><sheetData>${sheet}</sheetData></worksheet>`,
        ],
    ]);
}

// ── PDF ────────────────────────────────────────────────────────────────────

/** A one-page Letter PDF in Helvetica, one text line per entry (ASCII only). */
export function pdfFromLines(lines: string[]): Bytes {
    const text = lines
        .map(line => line.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, c => `\\${c}`))
        .map(line => `(${line}) Tj T*`)
        .join("\n");
    const stream = `BT\n/F1 11 Tf\n72 720 Td\n15 TL\n${text}\nET`;
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
            "/Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ];
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return utf8(out);
}

/** A 1×1 transparent PNG — the logo in an email signature. */
export function tinyPng(): Bytes {
    return Uint8Array.from(
        Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            "base64"
        )
    );
}

// ── quickXorHash ───────────────────────────────────────────────────────────

/**
 * OneDrive for Business's file hash: each byte is XORed into a 160-bit ring,
 * 11 bits further along than the one before, and the length is XORed into the
 * last eight bytes. Base64 of the 20 bytes, as Graph reports it.
 */
export function quickXorHash(data: Uint8Array): string {
    const bits = 160;
    const ring = new Uint8Array(bits / 8);
    for (let i = 0; i < data.length; i++) {
        const byte = data[i]!;
        const start = (i * 11) % bits;
        for (let k = 0; k < 8; k++) {
            if ((byte >> k) & 1) {
                const position = (start + k) % bits;
                ring[position >> 3]! ^= 1 << (position & 7);
            }
        }
    }
    let length = BigInt(data.length);
    for (let i = 0; i < 8; i++) {
        ring[12 + i]! ^= Number(length & 0xffn);
        length >>= 8n;
    }
    return Buffer.from(ring).toString("base64");
}
