import type { Metadata } from "next";
import React from "react";
import { LandingClient } from "./_components/LandingClient";
import { LANDING_FAQS } from "./_components/landingContent";
import { GITHUB_REPO, SITE_URL } from "~/config/site";

export const metadata: Metadata = {
    title: "Launchstack — The Open-Source Startup Operating System",
    description:
        "Your knowledge, decisions, and next moves in one focused workspace. The open-source startup operating system for founders. Free to self-host.",
    alternates: { canonical: "/" },
};

// Truthful SoftwareApplication facts only — no ratings, review counts, or
// aggregate metrics (ADR-006 §4).
const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Launchstack",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description:
        "Launchstack is a free, open-source AI platform that turns uploaded documents, recordings, and repository imports into a cited knowledge graph. Self-host with your own API keys.",
    url: SITE_URL,
    downloadUrl: GITHUB_REPO,
    offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
    },
    creator: { "@type": "Organization", name: "Launchstack", url: SITE_URL },
    featureList:
        "Document RAG with cited answers, Audio/video transcription, OCR document conversion, Predictive document analysis, DOCX redlining, Marketing pipeline, Self-hosting",
    // Served by the file-convention app/opengraph-image.tsx. The previous value
    // here was `${SITE_URL}/og-image.png`, which has never existed in public/.
    screenshot: `${SITE_URL}/opengraph-image`,
    license: "https://www.apache.org/licenses/LICENSE-2.0",
};

const organizationLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Launchstack",
    url: SITE_URL,
    // Not favicon.ico: Google's Organization.logo wants a raster image it can
    // crop, and .ico is not among the formats it reads. logo-512.png is the
    // same mark, rendered from public/icon.svg.
    logo: `${SITE_URL}/logo-512.png`,
    description:
        "Launchstack builds free, open-source tools that help tech founders grow their products.",
    sameAs: [GITHUB_REPO],
};

const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: LANDING_FAQS.map(faq => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
};

export default function HomePage() {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
            />
            <LandingClient />
        </>
    );
}
