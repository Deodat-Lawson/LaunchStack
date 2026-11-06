#!/usr/bin/env node
/** Authenticated local M2 browser checks. Credentials stay in memory; no interception or trace export. */
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
const evidence = resolve(root, "test-output/vantage-role-m2/browser");
const runtimeFile = resolve(root, "test-output/vantage-role-m2-20261106/runtime.json");
const cliFile = resolve(
    process.env.APPDATA ?? "",
    "npm/node_modules/@playwright/cli/playwright-cli.js"
);
const session = "vantage-role-m2-ui";
const origin = "http://localhost:3187";
const stage = process.argv[2] ?? "open";
mkdirSync(evidence, { recursive: true });
if (!existsSync(cliFile) || !existsSync(runtimeFile))
    throw new Error("Installed CLI or isolated runtime configuration is unavailable.");
const config = JSON.parse(readFileSync(runtimeFile, "utf8").replace(/^\uFEFF/, ""));
const owner = config.accounts?.[0]?.email;
const secret = config.loginPassword;
if (typeof owner !== "string" || typeof secret !== "string")
    throw new Error("Synthetic owner credentials are unavailable.");
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
    if (result.error || result.status !== 0)
        throw new Error("Playwright CLI failed: " + redact(result.error?.message ?? output));
    if (output.trim()) {
        console.log(output.trim());
        appendFileSync(resolve(evidence, "steps.log"), "[" + stage + "] " + output.trim() + "\n");
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
function capture(name, code) {
    const output = run(code);
    let result;
    try {
        result = JSON.parse(output);
    } catch {
        throw new Error("Could not parse browser evidence result.");
    }
    writeFileSync(resolve(evidence, name), JSON.stringify(result, null, 2));
    return result;
}
const savePrimary = name =>
    "async page => {" +
    "const target=" +
    JSON.stringify(name) +
    ", targetId=" +
    JSON.stringify(name === "Partnerships Lead" ? "partnerships-lead" : "security-engineer") +
    ";" +
    "const other=" +
    JSON.stringify(name === "Partnerships Lead" ? "Security Engineer" : "Partnerships Lead") +
    ", otherId=" +
    JSON.stringify(name === "Partnerships Lead" ? "security-engineer" : "partnerships-lead") +
    ";" +
    "const button=page.getByRole('button',{name:'Save primary role'});" +
    "const generationWrites=[];const watch=r=>{if(r.url().endsWith('/api/vantage/role-contextual')&&r.method()==='POST')generationWrites.push(r.url());};page.on('request',watch);" +
    "async function save(label,id){await page.getByRole('radio',{name:label}).check();const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual/personal')&&r.request().method()==='PATCH',{timeout:60000}),button.click()]);" +
    "const payload=JSON.parse(response.request().postData()||'{}');if(!response.ok())throw new Error('Role preference PATCH HTTP '+response.status()+' '+await response.text());" +
    "if(payload.primaryRoleId!==id||!Number.isInteger(payload.expectedRevision)||JSON.stringify([...payload.roleIds].sort())!==JSON.stringify(['partnerships-lead','security-engineer']))throw new Error('Invalid role preference payload');" +
    "const body=await response.json();if(body.state.roles?.primaryRoleId!==id||body.state.revision!==payload.expectedRevision+1)throw new Error('Role preference readback mismatch');" +
    "await page.getByText('Saved primary: '+label,{exact:false}).waitFor({timeout:30000});return {status:response.status(),primaryRoleId:id,expectedRevision:payload.expectedRevision,savedRevision:body.state.revision};}" +
    "await page.getByRole('radio',{name:target}).check();let priming=null;if(!(await button.isEnabled()))priming=await save(other,otherId);" +
    "const saved=await save(target,targetId);page.off('request',watch);if(generationWrites.length)throw new Error('Role switch triggered generation');" +
    "return {...saved,primingRole:priming?.primaryRoleId??null,generationWrites:0}; }";
const generate = (roleId, firstTitle) =>
    "async page => {" +
    "const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual') && r.request().method()==='POST',{timeout:90000}),page.getByRole('button',{name:'Prepare report for primary role'}).click()]);" +
    "const payload=JSON.parse(response.request().postData()||'{}'); if(JSON.stringify(Object.keys(payload))!==JSON.stringify(['weekStart'])) throw new Error('Generation request contains unexpected fields');" +
    "if(!response.ok()) throw new Error('Prepare HTTP '+response.status()+' '+await response.text());" +
    "const body=await response.json(), report=body.report; if(!report?.id || report.roleSelection?.primaryRoleId!==" +
    JSON.stringify(roleId) +
    ") throw new Error('Generated primary role mismatch');" +
    "if(report.weekStart!=='2026-10-26' || report.topics[0]?.title!==" +
    JSON.stringify(firstTitle) +
    ") throw new Error('Role-specific topic order mismatch');" +
    "if(!report.sourceSetHash || !report.historyHash || !report.contextKey) throw new Error('Frozen baseline identity missing');" +
    "await page.getByRole('region',{name:'Frozen report perspective'}).getByRole('heading',{name:" +
    JSON.stringify(roleId === "partnerships-lead" ? "Partnerships Lead" : "Security Engineer") +
    "}).waitFor({timeout:60000});" +
    "const brief=page.getByText('Read full brief');if(!(await brief.evaluate(e=>e.closest('details').open)))await brief.click();const text=await page.locator('main').innerText();" +
    "if(!/proposed in a draft without an accepted invitation/.test(text)||!/access review is due November 5 without recorded completion or sign-off/.test(text))throw new Error('Event qualifications missing from full brief');" +
    "return {status:response.status(),reportId:report.id,version:report.version,weekStart:report.weekStart,roleSelection:report.roleSelection,sourceSetHash:report.sourceSetHash,historyHash:report.historyHash,contextKey:report.contextKey,topicOrder:report.topics.map(t=>t.title),eventQualificationsVisible:true,generationPayload:payload}; }";
const openSource = (topicTitle, requiredText) =>
    "async page => {" +
    "const row=page.locator('article').filter({hasText:" +
    JSON.stringify(topicTitle) +
    "}); await row.getByRole('button').click();" +
    "const sheet=page.locator('[data-slot=sheet-content]');" +
    "const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/source?') && r.request().method()==='GET',{timeout:60000}),sheet.getByRole('button',{name:/Document/}).first().click()]);" +
    "if(!response.ok()) throw new Error('Exact source HTTP '+response.status()); const body=await response.json();" +
    "if(!body.body.includes(" +
    JSON.stringify(requiredText) +
    ")) throw new Error('Expected exact source content missing');" +
    "const dialog=page.locator('[data-slot=dialog-content]'); await dialog.getByText(body.body,{exact:true}).waitFor({timeout:30000});" +
    "return {status:response.status(),source:body.source,exactBodyVisible:true}; }";

if (stage === "open") {
    cli(["open", origin + "/employer/vantage/roles"]);
    run(
        "async page => {await page.getByLabel('Email',{exact:true}).waitFor({timeout:60000}); return {url:page.url(),signinForm:true};}"
    );
} else if (stage === "login") {
    run(
        "async page => {" +
            "await page.getByLabel('Email',{exact:true}).fill(" +
            JSON.stringify(owner) +
            ");" +
            "await page.getByLabel('Password',{exact:true}).fill(" +
            JSON.stringify(secret) +
            ");" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/auth/sign-in/email') && r.request().method()==='POST',{timeout:60000}),page.getByRole('button',{name:'Sign in',exact:true}).click()]);" +
            "if(!response.ok())throw new Error('Better Auth HTTP '+response.status());" +
            "await page.getByRole('heading',{name:'Weekly role review'}).waitFor({timeout:60000});" +
            "return {betterAuthStatus:response.status(),url:page.url()}; }"
    );
    snap("01-authenticated.yaml");
} else if (stage === "baseline") {
    capture(
        "baseline-reports.json",
        "async page => {" +
            "const section=page.getByRole('region',{name:'Saved role reports'});await section.waitFor({timeout:60000});" +
            "const rows=await section.locator('li').allTextContents();" +
            "const reports=rows.map(text=>{const id=text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];const version=Number(text.match(/version[^0-9]*([0-9]+)/i)?.[1]);if(!id||!Number.isInteger(version))throw new Error('Could not identify a saved report');return {id,version};});" +
            "return {reports}; }"
    );
    snap("01-baseline-reports.yaml");
} else if (stage === "context") {
    run(
        "async page => {" +
            "const section=page.getByRole('region',{name:'Company context review'}); await section.getByText(/Projection:/).waitFor({timeout:60000});" +
            "const details=section.locator('details'); if(await details.getAttribute('open')===null)await details.locator('summary').click();" +
            "const text=await section.innerText(); for(const p of [/CampusLoop/,/source-extracted-unreviewed/,/Document [0-9]+ . version [0-9]+/,/Unknowns/,/Omitted facts:/,/Projection: available/,/(unknowns marked|reviewed)/])if(!p.test(text))throw new Error('Missing reviewed context evidence: '+p);" +
            "return {authorizedFactsSourcesUnknownsVisible:true,priorReviewVisible:true,contextWrites:0}; }"
    );
    shot("02-company-context.png");
    snap("02-company-context.yaml");
} else if (stage === "a") {
    run(savePrimary("Partnerships Lead"));
    const a = capture(
        "pair-a.json",
        generate("partnerships-lead", "Check readiness for the proposed pitch")
    );
    if (!a.reportId) throw new Error("Partnerships report was not captured.");
    snap("03-partnerships.yaml");
    run(
        openSource(
            "Check readiness for the proposed pitch",
            "We still need to finish the impact and budget slides."
        )
    );
    shot("03-partnerships-source.png");
    run(
        "async page => {await page.locator('[data-slot=dialog-content]').getByRole('button',{name:'Close'}).click();await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Close'}).click();}"
    );
} else if (stage === "b") {
    const a = JSON.parse(readFileSync(resolve(evidence, "pair-a.json"), "utf8"));
    run(savePrimary("Security Engineer"));
    run(
        "async page => {" +
            "await page.getByRole('region',{name:'Frozen report perspective'}).getByRole('heading',{name:'Partnerships Lead'}).waitFor();" +
            "if(!(await page.getByRole('radio',{name:'Security Engineer'}).isChecked()))throw new Error('Current preference was not retained');" +
            "return {preferenceSwitchedWithoutRelabeling:true}; }"
    );
    const b = capture(
        "pair-b.json",
        generate("security-engineer", "Prepare the shared-admin access review")
    );
    if (
        a.reportId === b.reportId ||
        a.sourceSetHash !== b.sourceSetHash ||
        a.historyHash !== b.historyHash ||
        a.contextKey === b.contextKey ||
        a.roleSelection.mappingVersion !== b.roleSelection.mappingVersion ||
        a.roleSelection.revision === b.roleSelection.revision
    )
        throw new Error("Paired frozen-control comparison failed.");
    const comparison = {
        differentReportIds: true,
        sameSourceSet: true,
        sameHistory: true,
        sameMapping: true,
        differentContextKeys: true,
        differentRoleRevisions: true,
    };
    console.log(JSON.stringify(comparison));
    appendFileSync(resolve(evidence, "steps.log"), "[b] " + JSON.stringify(comparison) + "\n");
    const baseline = JSON.parse(readFileSync(resolve(evidence, "baseline-reports.json"), "utf8"));
    run(
        "async page => {" +
            "const baseline=" +
            JSON.stringify(baseline.reports) +
            ";" +
            "const section=page.getByRole('region',{name:'Saved role reports'});" +
            "for(const item of baseline){const button=section.getByRole('button',{name:item.id});await button.waitFor();const text=await button.innerText();if(!text.includes('version '+item.version))throw new Error('Existing report version changed');}" +
            "return {existingReportsStillListed:baseline.length,existingVersionsPreserved:true}; }"
    );
    snap("04-security.yaml");
    run(
        openSource(
            "Prepare the shared-admin access review",
            "The current checklist does not include a completed review or final sign-off."
        )
    );
    shot("04-security-source.png");
    run(
        "async page => {await page.locator('[data-slot=dialog-content]').getByRole('button',{name:'Close'}).click();await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Close'}).click();}"
    );
} else if (stage === "recover-b") {
    const index = process.argv[3];
    if (!/^[0-9]+$/.test(index ?? ""))
        throw new Error("Provide the recorded Security POST request number.");
    function recorded(command) {
        const result = spawnSync(
            process.execPath,
            [cliFile, "-s=" + session, "--raw", command, index],
            {
                cwd: evidence,
                encoding: "utf8",
                timeout: 30000,
                windowsHide: true,
            }
        );
        if (result.error || result.status !== 0)
            throw new Error("Recorded request body is unavailable.");
        try {
            return JSON.parse(result.stdout);
        } catch {
            throw new Error("Recorded request body is not valid JSON.");
        }
    }
    const payload = recorded("request-body"),
        original = recorded("response-body"),
        report = original.report;
    const a = JSON.parse(readFileSync(resolve(evidence, "pair-a.json"), "utf8"));
    if (
        JSON.stringify(payload) !== JSON.stringify({ weekStart: "2026-10-26" }) ||
        !report?.id ||
        report.roleSelection?.primaryRoleId !== "security-engineer" ||
        report.topics[0]?.title !== "Prepare the shared-admin access review" ||
        report.sourceSetHash !== a.sourceSetHash ||
        report.historyHash !== a.historyHash ||
        report.contextKey === a.contextKey ||
        report.id === a.reportId ||
        report.roleSelection.revision === a.roleSelection.revision ||
        report.roleSelection.mappingVersion !== a.roleSelection.mappingVersion
    )
        throw new Error("Recorded Security response or frozen-control comparison failed.");
    const b = {
        status: 200,
        reportId: report.id,
        version: report.version,
        weekStart: report.weekStart,
        roleSelection: report.roleSelection,
        sourceSetHash: report.sourceSetHash,
        historyHash: report.historyHash,
        contextKey: report.contextKey,
        topicOrder: report.topics.map(topic => topic.title),
        generationPayload: payload,
        recoveredFromRecordedResponse: true,
    };
    run(
        "async page => {" +
            "const writes=[];const watch=r=>{if(r.url().endsWith('/api/vantage/role-contextual')&&r.method()==='POST')writes.push(r.url());};page.on('request',watch);" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual/reports/" +
            report.id +
            "')&&r.request().method()==='GET',{timeout:60000}),page.getByRole('button',{name:'Reload saved review'}).click()]);" +
            "if(!response.ok())throw new Error('Security readback HTTP '+response.status());const body=await response.json();" +
            "if(body.report?.id!==" +
            JSON.stringify(report.id) +
            "||body.report.roleSelection.primaryRoleId!=='security-engineer')throw new Error('Security readback changed');" +
            "await page.getByRole('region',{name:'Frozen report perspective'}).getByRole('heading',{name:'Security Engineer'}).waitFor();" +
            "const brief=page.getByText('Read full brief');if(!(await brief.evaluate(e=>e.closest('details').open)))await brief.click();const text=await page.locator('main').innerText();" +
            "if(!/proposed in a draft without an accepted invitation/.test(text)||!/access review is due November 5 without recorded completion or sign-off/.test(text))throw new Error('Event qualifications missing from full brief');" +
            "page.off('request',watch);if(writes.length)throw new Error('Recovery generated another report');return {status:response.status(),reportId:body.report.id,eventQualificationsVisible:true,recoveryGenerationWrites:0}; }"
    );
    writeFileSync(resolve(evidence, "pair-b.json"), JSON.stringify(b, null, 2));
    const baseline = JSON.parse(readFileSync(resolve(evidence, "baseline-reports.json"), "utf8"));
    run(
        "async page => {const baseline=" +
            JSON.stringify(baseline.reports) +
            ";const section=page.getByRole('region',{name:'Saved role reports'});" +
            "for(const item of baseline){const button=section.getByRole('button',{name:item.id});await button.waitFor();const text=await button.innerText();if(!text.includes('version '+item.version))throw new Error('Existing report version changed');}" +
            "return {existingReportsStillListed:baseline.length,existingVersionsPreserved:true}; }"
    );
    const comparison = {
        differentReportIds: true,
        sameSourceSet: true,
        sameHistory: true,
        sameMapping: true,
        differentContextKeys: true,
        differentRoleRevisions: true,
    };
    console.log(JSON.stringify(comparison));
    appendFileSync(
        resolve(evidence, "steps.log"),
        "[recover-b] " +
            JSON.stringify({
                reportId: report.id,
                version: report.version,
                roleRevision: report.roleSelection.revision,
                generationPayload: payload,
                ...comparison,
            }) +
            "\n"
    );
    writeFileSync(
        resolve(evidence, "browser-helper-failure.txt"),
        "Observed after the Security POST succeeded: Error: Event qualifications missing from full brief.\n" +
            "The brief disclosure remained open from the previous report; the helper clicked it closed before checking.\n" +
            "Recovery read the original request/response and reloaded that same saved report by GET; no second generation was issued.\n"
    );
    snap("04-security.yaml");
    run(
        openSource(
            "Prepare the shared-admin access review",
            "The current checklist does not include a completed review or final sign-off."
        )
    );
    shot("04-security-source.png");
    run(
        "async page => {await page.locator('[data-slot=dialog-content]').getByRole('button',{name:'Close'}).click();await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Close'}).click();}"
    );
} else if (stage === "history") {
    const a = JSON.parse(readFileSync(resolve(evidence, "pair-a.json"), "utf8"));
    run(
        "async page => {" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual/reports/" +
            a.reportId +
            "') && r.request().method()==='GET',{timeout:60000}),page.getByRole('region',{name:'Saved role reports'}).getByRole('button',{name:" +
            JSON.stringify(a.reportId) +
            "}).click()]);" +
            "if(!response.ok())throw new Error('Historical report GET HTTP '+response.status());const body=await response.json();" +
            "if(body.report?.id!==" +
            JSON.stringify(a.reportId) +
            "||body.report.roleSelection.primaryRoleId!=='partnerships-lead')throw new Error('Historical report role changed');" +
            "await page.getByRole('region',{name:'Frozen report perspective'}).getByRole('heading',{name:'Partnerships Lead'}).waitFor();" +
            "if(!(await page.getByRole('radio',{name:'Security Engineer'}).isChecked()))throw new Error('Current primary preference changed');" +
            "return {status:response.status(),reportId:body.report.id,frozenRole:body.report.roleSelection.primaryRoleId,currentPrimary:'security-engineer',historicalReadPreserved:true}; }"
    );
    shot("05-historical-report.png");
    snap("05-historical-report.yaml");
} else if (stage === "decision") {
    const a = JSON.parse(readFileSync(resolve(evidence, "pair-a.json"), "utf8"));
    run(
        "async page => {" +
            "await page.locator('article').filter({hasText:'Check readiness for the proposed pitch'}).getByRole('button').click();" +
            "const writes=[];const watch=r=>{if(r.url().includes('/api/vantage/role-contextual/reports/')&&r.method()==='PATCH')writes.push(r.url());};page.on('request',watch);" +
            "await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Needs more evidence',exact:true}).click();" +
            "const dialog=page.getByRole('dialog',{name:'Confirm your decision'});await dialog.waitFor();" +
            "if(await dialog.locator('input[type=radio]:checked').count())throw new Error('Decision was preselected');" +
            "if(await dialog.getByRole('button',{name:'Confirm and save decision'}).isEnabled())throw new Error('Decision can save before selection');" +
            "await dialog.getByRole('radio',{name:'Needs more evidence'}).check();" +
            "await dialog.getByLabel('Decision note (optional)').fill('Confirm the invitation and the unfinished impact and budget slides.');" +
            "page.off('request',watch);if(writes.length)throw new Error('Decision changed before confirmation');" +
            "return {initiallyUnselected:true,saveInitiallyDisabled:true,writesBeforeConfirmation:0}; }"
    );
    shot("06-decision-confirm.png");
    run(
        "async page => {" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/vantage/role-contextual/reports/')&&r.request().method()==='PATCH',{timeout:60000}),page.getByRole('button',{name:'Confirm and save decision'}).click()]);" +
            "const payload=JSON.parse(response.request().postData()||'{}');if(!response.ok())throw new Error('Review PATCH HTTP '+response.status()+' '+await response.text());" +
            "const body=await response.json();if(body.report?.id!==" +
            JSON.stringify(a.reportId) +
            "||body.report.version!==payload.expectedVersion+1||payload.decision?.value!=='needs-more-evidence')throw new Error('Decision save mismatch');" +
            "await page.getByText('Your recorded decision').waitFor();return {status:response.status(),reportId:body.report.id,expectedVersion:payload.expectedVersion,savedVersion:body.report.version,decision:payload.decision.value}; }"
    );
    run(
        "async page => {" +
            "await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Close'}).click();" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual/reports/" +
            a.reportId +
            "')&&r.request().method()==='GET',{timeout:60000}),page.getByRole('button',{name:'Reload saved review'}).click()]);" +
            "if(!response.ok())throw new Error('Report reload HTTP '+response.status());const body=await response.json();if(!body.report?.topics.some(t=>t.decision?.value==='needs-more-evidence'))throw new Error('Decision missing on reload');" +
            "await page.locator('article').filter({hasText:'Check readiness for the proposed pitch'}).getByRole('button').click();await page.getByText('Your recorded decision').waitFor();" +
            "return {reportId:body.report.id,version:body.report.version,decision:'needs-more-evidence',savedReload:true}; }"
    );
    run(
        "async page => {" +
            "await page.reload();await page.getByRole('region',{name:'Saved role reports'}).getByRole('button',{name:" +
            JSON.stringify(a.reportId) +
            "}).click({timeout:60000});" +
            "if(!(await page.getByRole('radio',{name:'Security Engineer'}).isChecked()))throw new Error('Primary preference did not persist');" +
            "await page.locator('article').filter({hasText:'Check readiness for the proposed pitch'}).getByRole('button').click({timeout:60000});" +
            "await page.getByText('Your recorded decision').waitFor();await page.getByText('Confirm the invitation and the unfinished impact and budget slides.',{exact:true}).waitFor();" +
            "return {browserReload:true,frozenRole:'partnerships-lead',currentPrimary:'security-engineer'}; }"
    );
    shot("07-reloaded-decision.png");
    snap("07-reloaded-decision.yaml");
} else if (stage === "decision-b") {
    const b = JSON.parse(readFileSync(resolve(evidence, "pair-b.json"), "utf8"));
    run(
        "async page => {" +
            "await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Close'}).click();" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual/reports/" +
            b.reportId +
            "')&&r.request().method()==='GET',{timeout:60000}),page.getByRole('region',{name:'Saved role reports'}).getByRole('button',{name:" +
            JSON.stringify(b.reportId) +
            "}).click()]);" +
            "if(!response.ok())throw new Error('Security report GET HTTP '+response.status());" +
            "await page.getByRole('region',{name:'Frozen report perspective'}).getByRole('heading',{name:'Security Engineer'}).waitFor();" +
            "await page.locator('article').filter({hasText:'Prepare the shared-admin access review'}).getByRole('button').click();" +
            "const writes=[];const watch=r=>{if(r.url().includes('/api/vantage/role-contextual/reports/')&&r.method()==='PATCH')writes.push(r.url());};page.on('request',watch);" +
            "await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Needs more evidence',exact:true}).click();" +
            "const dialog=page.getByRole('dialog',{name:'Confirm your decision'});await dialog.waitFor();" +
            "if(await dialog.locator('input[type=radio]:checked').count())throw new Error('Security decision was preselected');" +
            "if(await dialog.getByRole('button',{name:'Confirm and save decision'}).isEnabled())throw new Error('Security decision can save before selection');" +
            "await dialog.getByRole('radio',{name:'Needs more evidence'}).check();" +
            "await dialog.getByLabel('Decision note (optional)').fill('Review the checklist and confirm completion and final sign-off.');" +
            "page.off('request',watch);if(writes.length)throw new Error('Security decision changed before confirmation');" +
            "return {initiallyUnselected:true,saveInitiallyDisabled:true,writesBeforeConfirmation:0}; }"
    );
    shot("08-security-decision-confirm.png");
    run(
        "async page => {" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/vantage/role-contextual/reports/')&&r.request().method()==='PATCH',{timeout:60000}),page.getByRole('button',{name:'Confirm and save decision'}).click()]);" +
            "const payload=JSON.parse(response.request().postData()||'{}');if(!response.ok())throw new Error('Security review PATCH HTTP '+response.status()+' '+await response.text());" +
            "const body=await response.json();if(body.report?.id!==" +
            JSON.stringify(b.reportId) +
            "||body.report.version!==payload.expectedVersion+1||payload.decision?.value!=='needs-more-evidence')throw new Error('Security decision save mismatch');" +
            "await page.getByText('Your recorded decision').waitFor();return {status:response.status(),reportId:body.report.id,expectedVersion:payload.expectedVersion,savedVersion:body.report.version,decision:payload.decision.value}; }"
    );
    run(
        "async page => {" +
            "await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Close'}).click();" +
            "const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual/reports/" +
            b.reportId +
            "')&&r.request().method()==='GET',{timeout:60000}),page.getByRole('button',{name:'Reload saved review'}).click()]);" +
            "if(!response.ok())throw new Error('Security reload HTTP '+response.status());const body=await response.json();if(!body.report?.topics.some(t=>t.decision?.value==='needs-more-evidence'))throw new Error('Security decision missing on reload');" +
            "await page.locator('article').filter({hasText:'Prepare the shared-admin access review'}).getByRole('button').click();await page.getByText('Your recorded decision').waitFor();" +
            "return {reportId:body.report.id,version:body.report.version,decision:'needs-more-evidence',savedReload:true}; }"
    );
    run(
        "async page => {" +
            "await page.reload();await page.getByRole('region',{name:'Saved role reports'}).getByRole('button',{name:" +
            JSON.stringify(b.reportId) +
            "}).click({timeout:60000});" +
            "if(!(await page.getByRole('radio',{name:'Security Engineer'}).isChecked()))throw new Error('Security primary preference did not persist');" +
            "await page.locator('article').filter({hasText:'Prepare the shared-admin access review'}).getByRole('button').click({timeout:60000});" +
            "await page.getByText('Your recorded decision').waitFor();await page.getByText('Review the checklist and confirm completion and final sign-off.',{exact:true}).waitFor();" +
            "return {browserReload:true,frozenRole:'security-engineer',currentPrimary:'security-engineer'}; }"
    );
    shot("09-security-reloaded-decision.png");
    snap("09-security-reloaded-decision.yaml");
} else if (stage === "final-readback") {
    const a = JSON.parse(readFileSync(resolve(evidence, "pair-a.json"), "utf8"));
    const b = JSON.parse(readFileSync(resolve(evidence, "pair-b.json"), "utf8"));
    const baseline = JSON.parse(readFileSync(resolve(evidence, "baseline-reports.json"), "utf8"));
    capture(
        "final-pair-readback.json",
        "async page => {" +
            "await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'Close'}).click();" +
            "async function open(id){const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/vantage/role-contextual/reports/'+id)&&r.request().method()==='GET',{timeout:60000}),page.getByRole('region',{name:'Saved role reports'}).getByRole('button',{name:id}).click()]);if(!response.ok())throw new Error('Final report GET HTTP '+response.status());return (await response.json()).report;}" +
            "const a=await open(" +
            JSON.stringify(a.reportId) +
            "), b=await open(" +
            JSON.stringify(b.reportId) +
            ");" +
            "for(const [report,role,note] of [[a,'partnerships-lead','Confirm the invitation and the unfinished impact and budget slides.'],[b,'security-engineer','Review the checklist and confirm completion and final sign-off.']]){" +
            "if(report.version!==2||report.roleSelection.primaryRoleId!==role||!report.topics.some(t=>t.decision?.value==='needs-more-evidence'&&t.decision.text===note))throw new Error('Final role decision readback mismatch');}" +
            "const baseline=" +
            JSON.stringify(baseline.reports) +
            ";const section=page.getByRole('region',{name:'Saved role reports'});for(const item of baseline){const button=section.getByRole('button',{name:item.id});await button.waitFor();if(!(await button.innerText()).includes('version '+item.version))throw new Error('Earlier report version changed');}" +
            "return {a:{reportId:a.id,version:a.version,primaryRoleId:a.roleSelection.primaryRoleId,decision:'needs-more-evidence'},b:{reportId:b.id,version:b.version,primaryRoleId:b.roleSelection.primaryRoleId,decision:'needs-more-evidence'},earlierReportVersionsPreserved:baseline.length}; }"
    );
    run("async page => {await page.evaluate(()=>window.scrollTo(0,0));}");
    shot("10-pair-desktop.png");
    snap("10-pair-desktop.yaml");
} else if (stage === "mobile") {
    run(
        "async page => {const sheet=page.locator('[data-slot=sheet-content]');if(await sheet.count())await sheet.getByRole('button',{name:'Close'}).click();}"
    );
    cli(["resize", "390", "844"]);
    run(
        "async page => {const s=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth}));if(s.content>s.viewport)throw new Error('Horizontal overflow');return {viewport:s.viewport,horizontalOverflow:false};}"
    );
    shot("11-mobile.png");
    snap("11-mobile.yaml");
    cli(["resize", "1280", "720"]);
} else if (stage === "requests") {
    const output = cli(["requests", "--static"]);
    writeFileSync(resolve(evidence, "requests.txt"), redact(output));
} else if (stage === "audit-secrets") {
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
        throw new Error("Could not parse the in-memory session check.");
    }
    const values = [secret, ...cookies].filter(v => typeof v === "string" && v.length >= 16);
    if (!cookies.length) throw new Error("No session token found for the in-memory scan.");
    function filesIn(directory) {
        return readdirSync(directory, { withFileTypes: true }).flatMap(e => {
            const p = resolve(directory, e.name);
            return e.isDirectory() ? filesIn(p) : e.isFile() ? [p] : [];
        });
    }
    const files = filesIn(evidence),
        leaks = files.filter(file => {
            const bytes = readFileSync(file);
            return values.some(
                v =>
                    bytes.includes(Buffer.from(v)) ||
                    bytes.includes(Buffer.from(encodeURIComponent(v)))
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
} else if (stage === "close") {
    cli(["close"]);
} else throw new Error("Unknown browser stage: " + stage);
