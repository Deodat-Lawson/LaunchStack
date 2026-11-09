import type { ApplicationSource } from "@launchstack/pipelines/accelerators";

/**
 * Accepted YC applications whose authors or YC published them, plus copies on
 * collection sites whose originals could not be checked. Each entry is checked
 * by hand; the collector refuses a page whose start anchor has moved.
 *
 * Never add a page on ycombinator.com to `extract`: YC's Terms of Use forbid
 * scraping its site, so YC-hosted applications are kept as links only.
 */
const GET_INTO_YC = { startAt: "Status: Successful", endBefore: "Get notified" };
const SHIZUNE = {
    startAt: "Show more",
    endBefore: "Trusted by 3,000+ startups",
    removeText: ["More responses"],
};
const UNVERIFIED =
    "A collection site's copy. The founders' original could not be opened to confirm the wording.";

export const YC_APPLICATION_SOURCES: ApplicationSource[] = [
    {
        companySlug: "dropbox",
        provenance: "original",
        url: "https://www.ycombinator.com/apply/dropbox",
        statedBatch: "Summer 2007",
        note: "YC publishes Dropbox's original application on its own site.",
        caveats: ["Kept as a link: YC's terms do not allow copying its site."],
    },
    {
        companySlug: "gitlab",
        provenance: "original",
        url: "https://about.gitlab.com/blog/gitlabs-application-for-y-combinator-winter-2015/",
        statedBatch: "Winter 2015",
        note: "GitLab released its Winter 2015 application on its company blog.",
        caveats: [
            "Some answers are redacted.",
            "The publisher added 2016 notes beside some answers.",
        ],
        extract: { startAt: "Company name:", endBefore: "Start your free" },
    },
    {
        companySlug: "openphone",
        provenance: "original",
        url: "https://www.quo.com/blog/openphone-y-combinator-application/",
        appliedAs: "OpenPhone",
        statedBatch: "Summer 2018",
        note: "The co-founder published the application that got OpenPhone into YC.",
        caveats: [
            "Republished after the rename to Quo, so some answers show the new name and URLs.",
        ],
        extract: { startAt: "Company name:", endBefore: "Hope this helps you craft" },
    },
    {
        companySlug: "the-muse",
        provenance: "original",
        url: "https://www.themuse.com/advice/the-muses-successful-application-to-y-combinator-w12",
        appliedAs: "The Daily Muse",
        statedBatch: "Winter 2012",
        note: "The founder published the application accepted into Winter 2012.",
        extract: {
            startAt: "What is your company going to make?",
            endBefore: "Kathryn Minshew is the Founder",
        },
    },
    {
        companySlug: "apptimize",
        provenance: "original",
        url: "https://www.nancyhua.com/2014/10/08/successful-y-combinator-s13-application/",
        statedBatch: "Summer 2013",
        note: "The co-founder published the Summer 2013 application.",
        caveats: ["Selected questions, as published by the founder."],
        extract: { startAt: "What is your company going to make?", endBefore: "Share this:" },
    },
    {
        companySlug: "mixpanel",
        provenance: "original",
        url: "https://suhaild.medium.com/mixpanels-y-combinator-application-in-2009-34b5d30dbc12",
        statedBatch: "Summer 2009",
        note: "The co-founder published the Summer 2009 application form.",
        caveats: [
            "Video, contact and equity details are redacted.",
            "Kept as a link: Medium refuses automated requests for this page.",
        ],
    },
    {
        companySlug: "standard-treasury",
        provenance: "original",
        url: "https://blog.zactownsend.com/our-yc-s13-application",
        appliedAs: "bedrock",
        statedBatch: "Summer 2013",
        note: "The co-founder published the application he and his co-founder sent to YC.",
        caveats: [
            "One prompt in the published form says summer 2014, conflicting with the S13 title.",
        ],
        extract: { startAt: "What is your company going to make?", endBefore: "Up vote" },
    },
    {
        companySlug: "proxino",
        provenance: "original",
        url: "https://ethanfast.com/2011/10/deconstructing-a-successful-yc-application/",
        appliedAs: "Taazr",
        statedBatch: "Summer 2010",
        note: "The co-founder quoted the successful application answer by answer.",
        caveats: [
            "Partial: about 11 answers, with the founder's commentary between them.",
            "The author says it was written in summer 2010; YC lists the company in Summer 2011.",
        ],
        extract: {
            startAt: "What is your company going to make?",
            endBefore: "Concluding thoughts",
            extraPrompts: ["Robert Morris: Why should I believe that this will work?"],
        },
    },
    {
        companySlug: "sketchdeck",
        provenance: "original",
        url: "https://sketchdeck.com/blog/yc-w14-application/",
        statedBatch: "Winter 2014",
        note: "The company published the original answers it sent at the end of 2013.",
        caveats: ["The founders' commentary follows each answer."],
        extract: { startAt: "What is your company going to make?", endBefore: "Good luck!" },
    },
    {
        companySlug: "clearly-ai",
        provenance: "original",
        url: "https://choigreene.com/guides/our-yc-application",
        statedBatch: "Summer 2024",
        note: "The founder published the full, unedited application, including both founder profiles.",
        caveats: ["The founder's corrections appear as commentary beside some answers."],
        extract: {
            startAt: "YC Application: Clearly AI",
            endBefore: "‹ Building a Company during a Family Emergency",
            extraPrompts: [
                "List any competitions/awards you have won, or papers you’ve published",
                "Tell us about things you’ve built before. For example apps you’ve built, websites, open source contributions. Include URLs if possible.",
                "Please tell us in one or two sentences about the most impressive thing other than this startup that you have built or achieved.",
                "Please tell us in one or two sentences about the most impressive thing other than",
            ],
            dropLines: ["Emily's Founder Profile", "Joe's Founder Profile"],
        },
    },
    {
        companySlug: "ownlocal",
        provenance: "original",
        url: "https://www.scribd.com/doc/111078156/Yc-Application",
        appliedAs: "Seeing Interactive",
        statedBatch: "Winter 2010",
        note: "The applicant named in the form uploaded the Winter 2010 application to Scribd.",
        caveats: [
            "Scribd shows only a preview of the six-page document, so answers may be cut off.",
        ],
        extract: {
            startAt: "Y Combinator Funding Application Winter 2010",
            endBefore: "You might also like",
        },
    },
    {
        companySlug: "eat-blueprint",
        provenance: "original",
        url: "https://jefftangx.substack.com/p/open-sourcing-my-y-combinator-winter",
        appliedAs: "Athens Research",
        statedBatch: "Winter 2021",
        note: "The founder published his application and marked where it ends.",
        extract: {
            startAt: "Company name:",
            endBefore: "That was the end of my original application.",
        },
    },
    {
        companySlug: "command-ai",
        provenance: "unverified_copy",
        url: "https://getintoyc.com/company/commandbar/",
        originalUrl: "https://www.commandbar.com/blog/grading-commandbars-yc-application/",
        appliedAs: "Foobar",
        statedBatch: "Summer 2020",
        note: UNVERIFIED,
        caveats: ["Partial: about 13 answers."],
        extract: GET_INTO_YC,
    },
    {
        companySlug: "paystack",
        provenance: "unverified_copy",
        url: "https://getintoyc.com/company/paystack/",
        originalUrl: "https://paystack.com/blog/company-news/paystacks-y-combinator-application",
        statedBatch: "Winter 2016",
        note: UNVERIFIED,
        extract: GET_INTO_YC,
    },
    {
        companySlug: "slite",
        provenance: "unverified_copy",
        url: "https://getintoyc.com/company/slite/",
        originalUrl: "https://hackernoon.com/nail-your-yc-application-29ed0fedf2cd",
        statedBatch: "Winter 2018",
        note: UNVERIFIED,
        extract: GET_INTO_YC,
    },
    {
        companySlug: "mimir",
        provenance: "unverified_copy",
        url: "https://getintoyc.com/company/mimir/",
        statedBatch: "Summer 2015",
        note: UNVERIFIED,
        caveats: ["Partial, with redactions."],
        extract: GET_INTO_YC,
    },
    {
        companySlug: "magicbell",
        provenance: "unverified_copy",
        url: "https://shizune.co/yc-application-examples/magicbell",
        statedBatch: "Winter 2021",
        note: UNVERIFIED,
        extract: SHIZUNE,
    },
    {
        companySlug: "nimbus-3",
        provenance: "unverified_copy",
        url: "https://shizune.co/yc-application-examples/dendron",
        appliedAs: "Dendron",
        statedBatch: "Winter 2021",
        note: UNVERIFIED,
        caveats: ["Partial."],
        extract: SHIZUNE,
    },
    {
        companySlug: "hyperbrowser",
        provenance: "unverified_copy",
        url: "https://shizune.co/yc-application-examples/metlo",
        appliedAs: "Supernote",
        statedBatch: "Summer 2021",
        note: UNVERIFIED,
        caveats: ["The application is for Supernote, before the company pivoted."],
        extract: SHIZUNE,
    },
];
