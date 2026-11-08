import { describe, expect, it } from "vitest";

import {
    emailForPerson,
    extractPeople,
    personNameFromMailbox,
    linkedinFromSearch,
    linkedinLoginWall,
    linkedinMentions,
    linkedinPageConfirms,
    linkedinSlugCandidates,
    linkedinSlugUrl,
    linkedinTitleMatches,
    linkedinUrlForPerson,
    organisationBeside,
    personFromLinkedInTitle,
} from "./people";

describe("extractPeople", () => {
    it("reads a name written before its title", () => {
        const people = extractPeople(
            "Our team Anne Saxelby, Founder Benoit Breal – Wholesale Manager Call us today.",
            "Saxelby Cheesemongers"
        );
        expect(people.map(p => [p.name, p.title])).toEqual([
            ["Anne Saxelby", "Founder"],
            ["Benoit Breal", "Wholesale Manager"],
        ]);
    });

    it("reads a title written before the name, and prose like 'is our'", () => {
        const people = extractPeople(
            "Owner: Jane Doe. Maria Lopez is our head buyer and has been with us since 2015."
        );
        expect(people.map(p => [p.name, p.title])).toEqual([
            ["Jane Doe", "Owner"],
            ["Maria Lopez", "Head Buyer"],
        ]);
    });

    it("keeps the two words beside the title, not a heading before them", () => {
        const [person] = extractPeople("Meet Anne Saxelby, Founder of the shop.");
        expect(person?.name).toBe("Anne Saxelby");
    });

    it("ignores places, page words and the company's own name", () => {
        expect(
            extractPeople(
                "New York Manager wanted. Read More Director. Saxelby Cheesemongers Owner.",
                "Saxelby Cheesemongers"
            )
        ).toEqual([]);
    });

    it("reads headings and honorifics beside a title as headings, not people", () => {
        expect(
            extractPeople(
                "Macro Trends — CEO. Houston Construction Director. Attorney John, Partner. Women Business Owners."
            )
        ).toEqual([]);
    });

    it("lists each person once", () => {
        const people = extractPeople("Jane Doe, Owner. Contact Jane Doe, Owner, for orders.");
        expect(people).toHaveLength(1);
    });
});

describe("linkedin", () => {
    it("reads a name and title written beside a profile link", () => {
        const [person] = linkedinMentions(
            "Leadership. Anne Saxelby, Founder (https://www.linkedin.com/in/anne-saxelby)."
        );
        expect(person).toMatchObject({
            name: "Anne Saxelby",
            title: "Founder",
            url: "https://www.linkedin.com/in/anne-saxelby",
        });
    });

    it("reads a public profile title and ignores a login wall", () => {
        expect(personFromLinkedInTitle("Jane Doe - Head Buyer - Acme | LinkedIn")).toMatchObject({
            name: "Jane Doe",
            title: "Head Buyer",
        });
        expect(personFromLinkedInTitle("LinkedIn")).toBeNull();
        expect(linkedinLoginWall("Sign in to LinkedIn to see this profile. Join LinkedIn.")).toBe(
            true
        );
        expect(
            linkedinLoginWall(
                "Rob Ammons, Partner. Agree & Join. New to LinkedIn",
                "Rob Ammons - Ammons Law Firm | LinkedIn"
            )
        ).toBe(false);
    });

    it("accepts a public profile when the title names the person", () => {
        expect(linkedinSlugCandidates("Cecilia Corral")).toEqual([
            "https://www.linkedin.com/in/ceciliacorral/",
            "https://www.linkedin.com/in/cecilia-corral/",
        ]);
        expect(linkedinSlugUrl("Rob Ammons")).toBe("https://www.linkedin.com/in/rob-ammons/");
        expect(linkedinSlugUrl("Rob")).toBeNull();
        expect(linkedinTitleMatches("Rob Ammons - Ammons Law Firm | LinkedIn", "Rob Ammons")).toBe(
            true
        );
        expect(linkedinTitleMatches("Rob Ammons - Partner | LinkedIn", "Rob Ammons")).toBe(true);
        expect(linkedinTitleMatches("Jane Doe - Ammons Law Firm | LinkedIn", "Rob Ammons")).toBe(
            false
        );
    });

    it("reads the profile address published for that surname", () => {
        expect(
            linkedinUrlForPerson(
                "Sam Brasch, Partner. View on LinkedIn (https://www.linkedin.com/in/sambrasch74/).",
                "Sam Brasch"
            )
        ).toBe("https://www.linkedin.com/in/sambrasch74");
        expect(
            linkedinUrlForPerson(
                "Andrew Principe (http://www.linkedin.com/pub/andrew-principe/2/242/901/en).",
                "Andrew Principe"
            )
        ).toBe("https://www.linkedin.com/pub/andrew-principe/2/242/901");
        expect(
            linkedinUrlForPerson(
                "Rob Ammons. Profiles https://www.linkedin.com/in/someone-else-999/.",
                "Rob Ammons"
            )
        ).toBeNull();
        expect(
            linkedinUrlForPerson(
                "Sam Brasch (https://www.linkedin.com/in/sambrasch/) and again Sam Brasch (https://www.linkedin.com/in/sambrasch74/).",
                "Sam Brasch"
            )
        ).toBeNull();
    });

    it("keeps a search hit only when the name and the organisation agree", () => {
        const orgs = ["CareMessage", "HealthQuest Capital"];
        expect(
            linkedinFromSearch(
                [
                    {
                        url: "https://www.linkedin.com/in/sambrasch74",
                        title: "Sam Brasch - Partner",
                        content: "Partner at HealthQuest Capital.",
                    },
                ],
                "Sam Brasch",
                orgs
            )
        ).toBe("https://www.linkedin.com/in/sambrasch74");
        expect(
            linkedinFromSearch(
                [
                    {
                        url: "https://www.linkedin.com/in/sambrasch",
                        title: "Sam Brasch - Reporter",
                        content: "Sam Brasch covers climate for Colorado Public Radio.",
                    },
                ],
                "Sam Brasch",
                orgs
            )
        ).toBeNull();
        expect(
            linkedinFromSearch(
                [
                    {
                        url: "https://www.linkedin.com/in/sambrasch74",
                        title: "Sam Brasch - Partner at HealthQuest Capital",
                        content: "HealthQuest Capital",
                    },
                    {
                        url: "https://www.linkedin.com/in/sambrasch",
                        title: "Sam Brasch - HealthQuest Capital",
                        content: "Another Sam Brasch at HealthQuest Capital.",
                    },
                ],
                "Sam Brasch",
                orgs
            )
        ).toBeNull();
        expect(
            linkedinPageConfirms("Rob Ammons - Partner | LinkedIn", "Rob Ammons", [
                "The Ammons Law Firm",
            ])
        ).toBe(false);
        expect(
            linkedinPageConfirms("Rob Ammons - Ammons Law Firm | LinkedIn", "Rob Ammons", [
                "The Ammons Law Firm",
            ])
        ).toBe(true);
    });

    it("reads the other organisation in the same heading", () => {
        expect(
            organisationBeside(
                "Sam Brasch | Partner, HealthQuest Capital, has spent years here.",
                "Sam Brasch",
                "CareMessage"
            )
        ).toBe("HealthQuest Capital");
        expect(
            organisationBeside(
                "Kevin Bromer | Executive Director for Data & Technology Investment, Ballmer Group.",
                "Kevin Bromer",
                "CareMessage"
            )
        ).toBe("Ballmer Group");
        expect(
            organisationBeside(
                "Cecilia Corral, Co-founder, Chief Innovation Officer. Cecilia grew up in Texas.",
                "Cecilia Corral",
                "CareMessage"
            )
        ).toBeNull();
    });
});

describe("personNameFromMailbox", () => {
    it("reads a given name and drops department inboxes", () => {
        expect(personNameFromMailbox("jan.devries")).toBe("jan devries");
        expect(personNameFromMailbox("jan")).toBe("jan");
        expect(personNameFromMailbox("suppliers")).toBeNull();
        expect(personNameFromMailbox("sales")).toBeNull();
        expect(personNameFromMailbox("press")).toBeNull();
        expect(personNameFromMailbox("careers")).toBeNull();
        expect(personNameFromMailbox("info")).toBeNull();
    });
});

describe("emailForPerson", () => {
    const emails = ["info@shop.com", "anne@shop.com", "b.breal@shop.com", "jdoe@shop.com"];

    it("matches the common address shapes", () => {
        expect(emailForPerson("Anne Saxelby", emails)).toBe("anne@shop.com");
        expect(emailForPerson("Jane Doe", emails)).toBe("jdoe@shop.com");
        expect(emailForPerson("Benoit Breal", emails)).toBe("b.breal@shop.com");
    });

    it("never hands a person the shared inbox", () => {
        expect(emailForPerson("Maria Lopez", emails)).toBeNull();
    });
});
