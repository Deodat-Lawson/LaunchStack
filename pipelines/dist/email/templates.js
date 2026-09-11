export const SEED_TEMPLATES = [
    {
        id: "intro",
        name: "Cold intro",
        description: "First touch. Leads with why you are writing to this specific recipient, then one concrete proof point.",
        template: {
            subject: "{{ownerCompany}} — a quick thought for {{recipientCompany}}",
            body: [
                "Hi {{firstName}},",
                "",
                "I'm reaching out from {{ownerCompany}}. {{valueProp}}",
                "",
                "The reason I thought of {{recipientCompany}}: {{contextNotes}}",
                "",
                "One thing we can point at: {{proofPoint}}",
                "",
                "If it's worth a look, everything is here: {{ctaLink}}",
                "",
                "If not, no hard feelings — I won't follow up twice.",
                "",
                "{{senderIdentity}}",
                "Unsubscribe: {{unsubscribeUrl}}",
            ].join("\n"),
            variables: [
                "ownerCompany",
                "recipientCompany",
                "firstName",
                "valueProp",
                "contextNotes",
                "proofPoint",
                "ctaLink",
                "senderIdentity",
                "unsubscribeUrl",
            ],
        },
    },
    {
        id: "follow-up",
        name: "Single follow-up",
        description: "One polite follow-up. Restates the offer in a sentence and makes it easy to decline.",
        template: {
            subject: "Following up — {{ownerCompany}}",
            body: [
                "Hi {{firstName}},",
                "",
                "I wrote last week about {{ownerCompany}} and didn't want to let it drop without one more note.",
                "",
                "The short version: {{valueProp}}",
                "",
                "If it's useful, here's where to start: {{ctaLink}}",
                "",
                "If it isn't, just reply \"no thanks\" and I'll close the loop.",
                "",
                "{{senderIdentity}}",
                "Unsubscribe: {{unsubscribeUrl}}",
            ].join("\n"),
            variables: [
                "ownerCompany",
                "firstName",
                "valueProp",
                "ctaLink",
                "senderIdentity",
                "unsubscribeUrl",
            ],
        },
    },
];
export function seedTemplate(id) {
    return SEED_TEMPLATES.find(t => t.id === id);
}
//# sourceMappingURL=templates.js.map