#!/usr/bin/env node
/**
 * Local Finance browser evidence. Uses an isolated in-memory Playwright CLI session
 * and the actual Better Auth UI. Credentials stay in memory and are never logged.
 */
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = resolve(root, "test-output/vantage-finance-m1/browser");
const runtimeFile = resolve(root, "test-output/vantage-finance-m1-20261105/runtime.json");
const cliFile = resolve(
    process.env.APPDATA ?? "",
    "npm/node_modules/@playwright/cli/playwright-cli.js"
);
const session = "vantage-finance-m1-ui";
const origin = "http://localhost:3186";
const command = process.argv[2] ?? "open";
mkdirSync(evidence, { recursive: true });
if (!existsSync(cliFile)) throw new Error("Installed Playwright CLI was not found.");
if (!existsSync(runtimeFile)) throw new Error("Isolated runtime configuration was not found.");
const config = JSON.parse(readFileSync(runtimeFile, "utf8"));
const owner = config.accounts?.[0]?.email;
const secret = config.loginPassword;
if (typeof owner !== "string" || typeof secret !== "string")
    throw new Error("Synthetic owner credentials are unavailable in the isolated runtime.");
function redact(text) {
    return String(text).split(secret).join("[REDACTED]").split(owner).join("[SYNTHETIC OWNER]");
}
function cli(args) {
    const result = spawnSync(process.execPath, [cliFile, "-s=" + session, "--raw", ...args], {
        cwd: evidence,
        encoding: "utf8",
        timeout: 120000,
        windowsHide: true,
    });
    const output = redact((result.stdout ?? "") + (result.stderr ?? ""));
    if (result.error || result.status !== 0) {
        throw new Error("Playwright CLI failed: " + redact(result.error?.message ?? output));
    }
    if (output.trim()) {
        console.log(output.trim());
        appendFileSync(resolve(evidence, "steps.log"), "[" + command + "] " + output.trim() + "\n");
    }
    return output;
}
function run(code) {
    return cli(["run-code", code]);
}
function shot(name) {
    cli(["screenshot", "--filename=" + resolve(evidence, name)]);
}
function snap(name) {
    cli(["snapshot", "--filename=" + resolve(evidence, name)]);
}
if (command === "open") {
    cli(["open", origin + "/employer/vantage/finance"]);
    run(
        "async page => { await page.getByLabel('Email', {exact:true}).waitFor({timeout:60000}); return {url:page.url(), signinForm:true}; }"
    );
} else if (command === "login") {
    const code =
        "async page => {" +
        "await page.getByLabel('Email', {exact:true}).fill(" +
        JSON.stringify(owner) +
        ");" +
        "await page.getByLabel('Password', {exact:true}).fill(" +
        JSON.stringify(secret) +
        ");" +
        "const [response] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/auth/sign-in/email') && r.request().method() === 'POST', {timeout:60000}), page.getByRole('button',{name:'Sign in',exact:true}).click()]);" +
        "if (!response.ok()) throw new Error('Better Auth sign-in HTTP ' + response.status());" +
        "await page.getByRole('heading',{name:'Weekly revenue review'}).waitFor({timeout:60000});" +
        "return {betterAuthStatus:response.status(),url:page.url()}; }";
    run(code);
    snap("01-authenticated.yaml");
} else if (command === "context") {
    run(
        "async page => {" +
            "const section=page.getByRole('region',{name:'Company context review'});" +
            "const details=section.locator('details');" +
            "if (await details.getAttribute('open')===null) await details.locator('summary').click();" +
            "const text=await section.innerText();" +
            "for(const pattern of [/Synthetic Finance Milestone/,/source-extracted-unreviewed/,/Document [0-9]+ . version [0-9]+/,/Unknowns/,/Omitted facts:/]) if(!pattern.test(text)) throw new Error('Missing context review evidence: '+pattern);" +
            "return {authorizedFactsSourcesUnknownsVisible:true}; }"
    );
    shot("01-company-context.png");
    snap("01-company-context.yaml");
    run(
        "async page => {" +
            "const writes=[]; const watch=r=>{if(r.url().endsWith('/api/vantage/contextual/architecture') && r.method()==='POST') writes.push(r.url());}; page.on('request',watch);" +
            "await page.getByRole('button',{name:/Review company context/}).click();" +
            "await page.getByRole('dialog',{name:'Confirm company context review'}).waitFor();" +
            "page.off('request',watch); if(writes.length) throw new Error('Context changed before confirmation');" +
            "return {contextConfirmationVisible:true,writesBeforeConfirmation:writes.length}; }"
    );
    shot("01-context-confirm.png");
    run(
        "async page => {" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/contextual/architecture') && r.request().method()==='POST',{timeout:60000}),page.getByRole('button',{name:'Confirm context review'}).click()]);" +
            "const payload=JSON.parse(response.request().postData()||'{}');" +
            "if(!response.ok()) throw new Error('Context review HTTP '+response.status()+' '+await response.text());" +
            "if(!Number.isInteger(payload.expectedRevision) || !/^[0-9a-f]{64}$/.test(payload.expectedProjectionFingerprint) || !['reviewed','unknowns-marked'].includes(payload.state)) throw new Error('Context review binding missing');" +
            "await page.getByText('Company context review saved for this exact projection.').waitFor({timeout:30000});" +
            "return {status:response.status(),expectedRevision:payload.expectedRevision,state:payload.state,projectionBinding:true}; }"
    );
} else if (command === "prepare") {
    run(
        "async page => {" +
            "await page.getByText('Deterministic simulated generation').waitFor({timeout:60000});" +
            "const button=page.getByRole('button',{name:'Prepare simulated review'});" +
            "if (await button.isVisible()) {" +
            " const [response]=await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/vantage/contextual') && r.request().method()==='POST',{timeout:60000}),button.click()]);" +
            " if (!response.ok()) throw new Error('Prepare HTTP '+response.status()+' '+(await response.text()));" +
            " const body=await response.json(); if(!body.report?.id) throw new Error('Prepared report ID missing');" +
            " return {prepared:true,status:response.status(),reportId:body.report.id,version:body.report.version}; }" +
            "return {prepared:false,existingReport:true}; }"
    );
    run(
        "async page => {" +
            "await page.getByText('Reconcile October revenue definitions',{exact:true}).first().waitFor({timeout:60000});" +
            "const text=await page.locator('main').innerText();" +
            "for(const pattern of [/12,000/,/18,000/,/refunds (unreconciled|not reconciled)/i,/unsigned opportunities/i]) if(!pattern.test(text)) throw new Error('Missing qualified Finance/Sales evidence: '+pattern);" +
            "return {amountsAndQualificationsVisible:true}; }"
    );
    shot("02-review.png");
    snap("02-review.yaml");
} else if (command === "sources") {
    for (const [key, text] of [
        ["finance", "October revenue is USD 12,000, provisional; refunds not reconciled."],
        ["sales", "October revenue is USD 18,000; includes unsigned opportunities."],
    ]) {
        const label = key === "finance" ? "Finance provisional" : "Sales incl. unsigned";
        run(
            "async page => {" +
                "const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/source?') && r.request().method()==='GET',{timeout:60000}),page.locator('article').filter({hasText:" +
                JSON.stringify(label) +
                "}).getByRole('button',{name:/^Open /}).click()]);" +
                "if (!response.ok()) throw new Error('Source HTTP '+response.status());" +
                "await page.getByRole('dialog').getByText(" +
                JSON.stringify(text) +
                ",{exact:true}).waitFor({timeout:30000});" +
                "return {source:" +
                JSON.stringify(key) +
                ",status:response.status(),exactBodyVisible:true}; }"
        );
        shot("03-source-" + key + ".png");
        run(
            "async page => {await page.getByRole('dialog').getByRole('button',{name:'Close'}).click(); return 'source closed';}"
        );
    }
} else if (command === "decision") {
    run(
        "async page => {" +
            "await page.getByRole('button',{name:/Reconcile October revenue definitions/}).click();" +
            "const writes=[]; const watch=r=>{if(r.url().includes('/api/vantage/contextual/reports/') && r.method()==='PATCH') writes.push(r.url());}; page.on('request',watch);" +
            "await page.getByRole('dialog').getByRole('button',{name:'Needs more evidence',exact:true}).click();" +
            "await page.getByRole('dialog',{name:'Confirm your decision'}).waitFor();" +
            "await page.getByLabel('Decision note (optional)').fill('Reconcile the Finance and Sales definitions before selecting a figure.');" +
            "page.off('request',watch); if(writes.length) throw new Error('Review changed before confirmation');" +
            "return {explicitConfirmationVisible:true,writesBeforeConfirmation:writes.length}; }"
    );
    shot("04-confirm.png");
    run(
        "async page => {" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/vantage/contextual/reports/') && r.request().method()==='PATCH',{timeout:60000}),page.getByRole('button',{name:'Confirm and save decision'}).click()]);" +
            "const payload=JSON.parse(response.request().postData()||'{}');" +
            "if (!response.ok()) throw new Error('Review PATCH HTTP '+response.status()+' '+await response.text());" +
            "if (!Number.isInteger(payload.expectedVersion) || payload.decision?.value!=='needs-more-evidence') throw new Error('Expected version or explicit decision missing');" +
            "const body=await response.json(); if(!body.report?.id || body.report.version!==payload.expectedVersion+1) throw new Error('Saved report version missing or wrong');" +
            "await page.getByText('Your recorded decision').waitFor({timeout:30000});" +
            "return {status:response.status(),reportId:body.report.id,expectedVersion:payload.expectedVersion,savedVersion:body.report.version,decision:payload.decision.value}; }"
    );
    shot("05-saved.png");
    run(
        "async page => {" +
            "await page.getByRole('dialog').getByRole('button',{name:'Close'}).click();" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/vantage/contextual/reports/') && r.request().method()==='GET',{timeout:60000}),page.getByRole('button',{name:'Reload saved review'}).click()]);" +
            "if(!response.ok()) throw new Error('Report reload HTTP '+response.status());" +
            "const body=await response.json(); if(!body.report?.id || !body.report.topics.some(t=>t.decision?.value==='needs-more-evidence')) throw new Error('Saved decision absent from report readback');" +
            "await page.getByRole('button',{name:/Reconcile October revenue definitions/}).click({timeout:60000});" +
            "await page.getByText('Your recorded decision').waitFor({timeout:60000});" +
            "await page.getByText('Reconcile the Finance and Sales definitions before selecting a figure.',{exact:true}).waitFor();" +
            "return {reportGetStatus:response.status(),reportId:body.report.id,version:body.report.version,decision:'needs-more-evidence',persistedAfterSavedReload:true}; }"
    );
    run(
        "async page => {" +
            "await page.reload();" +
            "await page.getByRole('button',{name:/Reconcile October revenue definitions/}).click({timeout:60000});" +
            "await page.getByText('Your recorded decision').waitFor({timeout:60000});" +
            "await page.getByText('Reconcile the Finance and Sales definitions before selecting a figure.',{exact:true}).waitFor();" +
            "return {persistedAfterBrowserReload:true}; }"
    );
    shot("06-reloaded.png");
    snap("06-reloaded.yaml");
} else if (command === "mobile") {
    run(
        "async page => {await page.getByRole('dialog').getByRole('button',{name:'Close'}).click();}"
    );
    cli(["resize", "390", "844"]);
    run(
        "async page => {" +
            "const size=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth}));" +
            "if(size.content>size.viewport) throw new Error('Horizontal overflow: '+JSON.stringify(size));" +
            "return {mobileViewport:size.viewport,horizontalOverflow:false}; }"
    );
    shot("07-mobile.png");
    snap("07-mobile.yaml");
    cli(["resize", "1280", "720"]);
} else if (command === "requests") {
    const output = cli(["requests", "--static"]);
    writeFileSync(resolve(evidence, "requests.txt"), redact(output));
} else if (command === "audit-secrets") {
    // The browser returns cookie values to this process only; never log or save them.
    const result = spawnSync(
        process.execPath,
        [
            cliFile,
            "-s=" + session,
            "--raw",
            "run-code",
            "async page => (await page.context().cookies()).filter(c => /session|token/i.test(c.name)).map(c => c.value)",
        ],
        { cwd: evidence, encoding: "utf8", timeout: 120000, windowsHide: true }
    );
    if (result.error || result.status !== 0)
        throw new Error("Could not inspect the synthetic session in memory.");
    let cookies;
    try {
        cookies = JSON.parse(result.stdout);
    } catch {
        throw new Error("Could not parse the in-memory synthetic session check.");
    }
    const values = [secret, ...cookies].filter(
        value => typeof value === "string" && value.length >= 16
    );
    if (!cookies.length) throw new Error("No session token was found for the in-memory scan.");
    function filesIn(directory) {
        return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const path = resolve(directory, entry.name);
            return entry.isDirectory() ? filesIn(path) : entry.isFile() ? [path] : [];
        });
    }
    const files = filesIn(evidence);
    const leaks = files.filter(file => {
        const bytes = readFileSync(file);
        return values.some(
            value =>
                bytes.includes(Buffer.from(value)) ||
                bytes.includes(Buffer.from(encodeURIComponent(value)))
        );
    });
    if (leaks.length)
        throw new Error("Credential or session-token match found in local evidence files.");
    const output = JSON.stringify({
        filesScanned: files.length,
        sessionTokensChecked: cookies.length,
        credentialMatches: 0,
    });
    console.log(output);
    appendFileSync(resolve(evidence, "steps.log"), "[audit-secrets] " + output + "\n");
} else if (command === "close") {
    cli(["close"]);
} else {
    throw new Error("Unknown browser stage: " + command);
}
