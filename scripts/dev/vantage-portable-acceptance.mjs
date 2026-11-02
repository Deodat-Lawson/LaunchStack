async page => {
    const current = new URL(page.url());
    if (current.hostname !== "127.0.0.1" || !["3177", "3178", "3180", "3181"].includes(current.port)) throw new Error("Unexpected demo origin");
    const origin = current.origin;
    const checks = [];
    const pageErrors = [];
    const badRequests = [];
    const badResponses = [];
    const request = value => { const u = new URL(value.url()); if (u.origin !== origin) badRequests.push(value.url()); };
    const response = value => { if (value.status() >= 400) badResponses.push({ url:value.url(),status:value.status() }); };
    const pageError = error => pageErrors.push(error.message);
    page.on('request',request); page.on('response',response); page.on('pageerror',pageError);
    const ok = (condition, message) => { if (!condition) throw new Error(message); };
    const check = async (name, task) => {
        try { await task(); checks.push({name,pass:true}); }
        catch (error) { checks.push({name,pass:false,error:String(error)}); }
    };
    const screenshot = async name => { await page.waitForTimeout(450); await page.screenshot({path:`test-output/vantage-portable-20261102/${name}.png`}); };
    const home = async () => { await page.goto(origin + '/'); await page.getByRole('heading',{name:'Decisions to make'}).waitFor(); };
    const dialog = () => page.getByRole('dialog').last();
    const close = async () => dialog().getByRole('button',{name:'Close',exact:true}).click();
    const topic = () => page.getByRole('button',{name:/Reconcile QA and Operations deletion results/});
    const context = () => page.getByRole('button',{name:/My context Company profile unreviewed/});
    const nativeLink = name => page.getByRole('navigation',{name:'Vantage screens'}).getByRole('link',{name,exact:true});
    try {
        await page.setViewportSize({width:1440,height:1000});
        await home();
        await check('recorded review and provenance',async()=>{
            ok(await page.getByText('Recorded synthetic demo',{exact:true}).isVisible(),'synthetic banner absent');
            ok(await page.getByText(/recorded replay.*no live AI call/).isVisible(),'replay label absent');
            ok(await page.getByRole('button',{name:'To review 2'}).isVisible(),'expected two topics');
            ok(await page.getByRole('button',{name:'Previous week'}).isDisabled(),'unrecorded previous week is selectable');
            ok(await page.getByRole('button',{name:'Confirm addressed'}).isVisible(),'pending question absent');
            ok(!(await page.getByRole('link',{name:'Alternative saved report'}).count()),'unrecorded alternate report exposed');
        });
        await check('desktop dark and light layouts',async()=>{
            if ((await page.locator('html').getAttribute('data-theme')) !== 'dark') await page.getByRole('button',{name:'Toggle color theme'}).click();
            await screenshot('desktop-dark-final');
            await page.getByRole('button',{name:'Toggle color theme'}).click();
            ok((await page.locator('html').getAttribute('data-theme'))==='light','light theme not selected');
            await screenshot('desktop-light-final');
            ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'desktop horizontal overflow');
        });
        await check('exact source and neutral human decision',async()=>{
            await topic().click();
            const d=dialog();
            for (const name of ['Go','No-go','Needs more evidence']) {
                const control=d.getByRole('button',{name,exact:true});
                ok(await control.isVisible(),`missing ${name}`);
                ok((await control.getAttribute('aria-pressed'))!=='true',`${name} is preselected`);
            }
            await screenshot('desktop-light-decision-final');
            await d.getByRole('button',{name:/Workspace document 16 doc:/}).click();
            const source=await dialog().innerText();
            ok(source.includes('doc:workspace-document/16@16'),'exact source ref missing');
            ok(source.includes('3 of 3 sample accounts were deleted'),'source text missing');
            ok(source.includes('no live version or access check'),'snapshot authority not disclosed');
            await screenshot('desktop-light-source-final');
            await close();
            await d.getByRole('button',{name:'Needs more evidence',exact:true}).click();
            const review=dialog();
            ok(await review.getByRole('radio',{name:'Needs more evidence'}).isChecked(),'explicit choice not selected');
            await review.getByRole('textbox',{name:'Decision note (optional)'}).fill('Portable demo review only.');
            await review.getByRole('button',{name:'Save decision'}).click();
            await d.getByText('Portable demo review only.').waitFor();
            ok(await d.getByText('Needs more evidence',{exact:true}).count()>0,'local choice missing');
            await close();
            await page.getByRole('button',{name:'Refresh saved weekly review'}).click();
            await page.getByRole('button',{name:'Decided 1'}).waitFor();
            ok(await page.getByRole('button',{name:'Confirm addressed'}).isVisible(),'decision closed historical question');
            await page.reload();
            await page.getByRole('button',{name:'Decided 0'}).waitFor();
        });
        await check('local role, star, pending review and reset',async()=>{
            await context().click();
            let d=dialog();
            ok(await d.getByText("Company profile isn't reviewed yet").isVisible(),'unreviewed profile label missing');
            await screenshot('desktop-light-context-final');
            await d.getByRole('checkbox',{name:'Product'}).check();
            await d.getByRole('button',{name:'Make primary : Product'}).click();
            await d.getByRole('button',{name:'Save roles'}).click();
            await d.getByRole('button',{name:'Primary perspective : Product'}).waitFor();
            const star=d.getByRole('button',{name:'Star Workspace document 16'});
            await star.click();
            await d.getByRole('button',{name:'Unstar Workspace document 16'}).waitFor();
            await d.getByRole('button',{name:'Inspect profile'}).click();
            const profile=await dialog().innerText();
            ok(profile.includes('unreviewed'),'profile review state missing');
            ok(profile.includes('no live version or access check'),'profile source authority not disclosed');
            await close();
            d=dialog(); await d.getByRole('button',{name:'Done'}).click();
            await page.getByRole('button',{name:'Confirm addressed'}).click();
            await page.getByText('Questions from earlier reviews 0').waitFor();
            await page.getByRole('button',{name:'Reset demo'}).click();
            await page.getByRole('button',{name:'Confirm addressed'}).waitFor();
            await context().click(); d=dialog();
            ok(!(await d.getByRole('checkbox',{name:'Product'}).isChecked()),'role did not reset');
            ok(await d.getByRole('button',{name:'Star Workspace document 16'}).isVisible(),'star did not reset');
            await d.getByRole('button',{name:'Done'}).click();
        });
        await check('recorded navigation and unsupported action',async()=>{
            await nativeLink('Actions').click(); await page.getByText('Weekly Actions').waitFor();
            await page.getByRole('button',{name:'Add an action'}).click();
            const d=dialog(); await d.getByRole('textbox',{name:'Action',exact:true}).fill('Synthetic action');
            await d.getByRole('textbox',{name:'Owner',exact:true}).fill('Synthetic person');
            await d.getByRole('textbox',{name:'The test',exact:true}).fill('Synthetic check');
            await d.getByRole('button',{name:'Add',exact:true}).click();
            await d.getByText('This operation is unavailable in the recorded demo. No work was created.').waitFor();
            await d.getByRole('button',{name:'Cancel',exact:true}).click();
            await nativeLink('Evidence').click(); await page.getByText('Everything the week can cite').waitFor();
            ok(await page.getByText('Recorded synthetic doc:workspace-document/16@16').count()>0,'recorded evidence list missing');
            await nativeLink('Metrics').click(); await page.getByText('0 metrics \u00b7 0 numbers recorded').waitFor();
            await nativeLink('Weekly Review').click(); await page.getByRole('heading',{name:'Decisions to make'}).waitFor();
        });
        await check('mobile light and dark',async()=>{
            await page.setViewportSize({width:390,height:844});
            if ((await page.locator('html').getAttribute('data-theme')) !== 'light') await page.getByRole('button',{name:'Toggle color theme'}).click();
            ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'mobile light overflow');
            await screenshot('mobile-light-final');
            await topic().click();
            const light=await dialog().boundingBox();
            ok(light&&light.x>=0&&light.x+light.width<=390,'mobile light dialog overflows');
            await screenshot('mobile-light-decision-final'); await close();
            await page.getByRole('button',{name:'Toggle color theme'}).click();
            ok((await page.locator('html').getAttribute('data-theme'))==='dark','dark theme not selected');
            ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'mobile dark overflow');
            await screenshot('mobile-dark-final');
            await topic().click();
            const dark=await dialog().boundingBox();
            ok(dark&&dark.x>=0&&dark.x+dark.width<=390,'mobile dark dialog overflows');
            await screenshot('mobile-dark-decision-final'); await close();
        });
        await check('no external requests or page errors',async()=>{
            ok(!pageErrors.length,`page errors: ${pageErrors.join('; ')}`);
            ok(!badRequests.length,`external requests: ${badRequests.join('; ')}`);
            ok(!badResponses.length,`HTTP errors: ${JSON.stringify(badResponses)}`);
        });
    } finally {
        page.off('request',request); page.off('response',response); page.off('pageerror',pageError);
    }
    return {origin,kind:'recorded synthetic browser UI',checks,pageErrors,badRequests,badResponses};
}
