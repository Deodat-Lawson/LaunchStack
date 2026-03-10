/**
 * Quick smoke-test for the trend search pipeline.
 * Calls the real OpenAI + Tavily APIs — no DB, no auth, no Inngest.
 *
 * Usage:
 *   npx tsx scripts/test-trend-search.ts
 *
 * Required env vars (reads from .env automatically via dotenv):
 *   OPENAI_API_KEY
 *   TAVILY_API_KEY
 * 
 *
 *   ┌─────────────────────────────────────────────────────────────────────────────┐
 *   │  Running `npx tsx scripts/test-trend-search.ts`                             │
 *   │                                                                             │
 *   │  Required env vars:                                                         │
 *   │   - OPENAI_API_KEY                                                          │
 *   │   - TAVILY_API_KEY                                                          │
 *   │                                                                             │
 *   │  Sample output:                                                             │
 *   └─────────────────────────────────────────────────────────────────────────────┘
 *
─── Input ───
{
  "query": "latest AI trends in retail marketing",
  "companyContext": "We are a mid-size fashion retailer focused on Gen Z customers in the US market.",
  "categories": [
    "fashion",
    "tech"
  ]
}

Running pipeline (plan → search → synthesize)…

  ⏳ stage: searching
  ⏳ stage: synthesizing
─── Output ───
{
  "results": [
    {
      "sourceUrl": "https://www.businessoffashion.com/articles/technology/fashion-retail-synthetic-consumer-research/",
      "summary": "AI-generated focus groups are transforming consumer research in fashion retail.",
      "description": "This article discusses how AI-generated focus groups are being utilized by fashion retailers to gain insights into consumer preferences. For a mid-size fashion retailer targeting Gen Z, understanding consumer sentiment through innovative AI methods can enhance marketing strategies and product offerings."
    },
    {
      "sourceUrl": "https://www.businessoffashion.com/opinions/technology/opinion-online-shopping-could-be-ais-next-victim/",
      "summary": "AI-assisted shopping tools are reshaping online retail experiences.",
      "description": "The introduction of AI tools like OpenAI's Instant Checkout is revolutionizing how consumers shop online, allowing for a seamless purchasing experience. This trend is particularly relevant for fashion retailers aiming to attract Gen Z customers who value convenience and personalization in their shopping experiences."
    },
    {
      "sourceUrl": "https://www.retailtouchpoints.com/features/executive-viewpoints/ai-isnt-the-end-of-in-store",
      "summary": "AI enhances in-store shopping experiences through personalization.",
      "description": "This article highlights how fashion retailers are using AI to create personalized in-store experiences, such as virtual try-ons. For a fashion retailer focused on Gen Z, leveraging AI to enhance the shopping experience can drive engagement and sales."
    },
    {
      "sourceUrl": "https://www.consultancy.eu/news/amp/13240/ecommerce-braces-for-new-era-of-agentic-ai-shopping",
      "summary": "The rise of agentic AI is changing how products are marketed and sold online.",
      "description": "As AI becomes more integral to e-commerce, brands must adapt their marketing strategies to ensure their products are easily understood by AI systems. This trend is crucial for fashion retailers looking to maintain visibility and appeal to tech-savvy Gen Z consumers."
    },
    {
      "sourceUrl": "https://www.businessoffashion.com/briefings/sustainability/fashion-searches-for-a-new-climate-solution-tapestry-carbon-capture-textile-recycling-eu-ban/?int_medium=homepage&int_source=recirculation-bottom&int_campaign=professional-curated",
      "summary": "Sustainability in fashion is increasingly driven by technological advancements.",
      "description": "This article discusses the intersection of technology and sustainability in fashion, which is becoming a significant concern for Gen Z consumers. As a fashion retailer, aligning marketing strategies with sustainable practices can enhance brand loyalty among this demographic."
    }
  ],
  "metadata": {
    "query": "latest AI trends in retail marketing",
    "companyContext": "We are a mid-size fashion retailer focused on Gen Z customers in the US market.",
    "categories": [
      "fashion",
      "tech"
    ],
    "createdAt": "2026-02-23T08:41:22.609Z"
  }
}
 */

import "dotenv/config";

// Skip the full env validation so we don't need DB/Clerk/Inngest keys
process.env.SKIP_ENV_VALIDATION = "true";

import { runTrendSearch } from "~/lib/tools/trend-search/index";

async function main() {
    const input = {
        query: "latest AI trends in retail marketing",
        companyContext:
            "We are a mid-size fashion retailer focused on Gen Z customers in the US market.",
        categories: ["fashion", "tech"] as ("fashion" | "tech")[],
    };

    console.log("─── Input ───");
    console.log(JSON.stringify(input, null, 2));
    console.log("\nRunning pipeline (plan → search → synthesize)…\n");

    const output = await runTrendSearch(input, {
        onStageChange: (stage) => console.log(`  ⏳ stage: ${stage}`),
    });

    console.log("─── Output ───");
    console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
    console.error("Pipeline failed:", err);
    process.exit(1);
});

