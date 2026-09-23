import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.LANDING_TEST_URL ?? "http://127.0.0.1:3011";
const home = await fetch(new URL("/", origin));
const html = await home.text();

test("homepage serves the startup OS with one semantic main heading", () => {
    assert.equal(home.status, 200);
    assert.match(html, /The Open-Source Startup Operating System/);
    assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1);
    assert.match(html, /<main id="main"/);
    assert.match(html, /href="#main"[^>]*>Skip to content/);
    assert.match(html, /Sample workspace/);
});

test("structured FAQ questions and answers match the actual page", () => {
    const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map(m => JSON.parse(m[1]));
    const faq = blocks.find(item => item["@type"] === "FAQPage");
    assert.ok(faq);
    assert.equal(faq.mainEntity.length, 5);
    const decode = text =>
        text.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
    for (const item of faq.mainEntity) {
        assert.ok(decode(html).includes(item.name), item.name);
        assert.ok(decode(html).includes(item.acceptedAnswer.text), item.name);
    }
    const organization = blocks.find(item => item["@type"] === "Organization");
    assert.ok(organization.logo.endsWith("/logo-512.png"));
});

test("every homepage fragment link has a target", () => {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]), match[1]);
});

test("account CTAs keep the configured app origin", () => {
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.launchstack.app";
    assert.ok(html.includes(`href="${appOrigin}/signup"`));
    assert.ok(html.includes(`href="${appOrigin}/signin"`));
    assert.ok(!html.includes('href="/signup"'));
});

test("brand images are local, valid SVG files", async () => {
    const images = [...new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]))];
    assert.equal(images.length, 4);
    await Promise.all(
        images.map(async path => {
            assert.ok(path.startsWith("/brands/"), path);
            const response = await fetch(new URL(path, origin));
            assert.equal(response.status, 200, path);
            assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
            const svg = await response.text();
            assert.match(svg, /<svg/);
            assert.match(svg, /viewBox=/);
            assert.doesNotMatch(svg, /<script/);
        })
    );
});

test("navigation destinations and discoverability routes respond", async () => {
    await Promise.all(
        [
            "/pricing",
            "/contact",
            "/deployment",
            "/robots.txt",
            "/sitemap.xml",
            "/icon.svg",
            "/logo-512.png",
        ].map(async path => {
            const response = await fetch(new URL(path, origin));
            assert.equal(response.status, 200, path);
        })
    );
});

test("social preview renders as an actual PNG", async () => {
    const response = await fetch(new URL("/opengraph-image", origin));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/png/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint32(16), 1200);
    assert.equal(view.getUint32(20), 630);
});

test("deployment sections render directly, with current commands and working fragment targets", async () => {
    const sections = [
        "main",
        "docker",
        "production",
        "local-dev",
        "ai-providers",
        "storage",
        "auth",
        "workers",
        "processing",
        "connections",
        "capabilities",
        "operations",
        "vercel",
    ];
    for (const section of sections) {
        const response = await fetch(new URL(`/deployment?section=${section}`, origin));
        assert.equal(response.status, 200, section);
        const page = await response.text();
        assert.equal([...page.matchAll(/<h1[\s>]/g)].length, 1, section);
        assert.match(page, /id="guide-content"/);
        assert.doesNotMatch(page, /@launchstack\/core/);
        const ids = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
        for (const fragment of page.matchAll(/href="#([^"]+)"/g))
            assert.ok(ids.has(fragment[1]), `${section}: ${fragment[1]}`);
        if (section === "local-dev")
            assert.match(page, /pnpm --filter @launchstack\/web db:migrate/);
        if (section === "connections") assert.match(page, /GMAIL_CONNECTOR_ENABLED=true/);
        if (section === "production") assert.match(page, /docker-compose\.prod\.yml/);
    }
});

test("legacy deployment URLs show the replacement guide on first render", async () => {
    for (const [section, heading] of [
        ["vercel-blob", "Files &amp; object storage"],
        ["inngest", "Workers &amp; scheduled jobs"],
        ["ocr-azure", "Documents, audio &amp; editing"],
        ["voice", "Documents, audio &amp; editing"],
    ]) {
        const response = await fetch(new URL(`/deployment?section=${section}`, origin));
        assert.equal(response.status, 200);
        const page = await response.text();
        assert.ok(page.includes(`<h1>${heading}</h1>`), section);
    }
});

test("deployment social preview is a real 1200 by 630 PNG", async () => {
    const response = await fetch(new URL("/deployment/opengraph-image", origin));
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint32(16), 1200);
    assert.equal(view.getUint32(20), 630);
});
