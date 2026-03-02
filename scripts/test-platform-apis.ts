/**
 * Test script for Marketing Pipeline Platform API integrations
 * 
 * Usage:
 *   npx tsx scripts/test-platform-apis.ts
 * 
 * Required env vars:
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
 *   TWITTER_BEARER_TOKEN  
 *   LINKEDIN_ACCESS_TOKEN
 *   BLUESKY_HANDLE, BLUESKY_APP_PASSWORD
 */

import "dotenv/config";

// Skip the full env validation so we don't need DB/Clerk/Inngest keys
process.env.SKIP_ENV_VALIDATION = "true";

import { redditClient } from "~/lib/tools/marketing-pipeline/clients/reddit";
import { twitterClient } from "~/lib/tools/marketing-pipeline/clients/twitter";
import { linkedinClient } from "~/lib/tools/marketing-pipeline/clients/linkedin";
import { blueskyClient } from "~/lib/tools/marketing-pipeline/clients/bluesky";
import { researchPlatformTrends } from "~/lib/tools/marketing-pipeline/research";
import type { MarketingPlatform } from "~/lib/tools/marketing-pipeline/types";

async function testRedditAPI() {
    console.log("\n🔴 Testing Reddit API...");
    try {
        const results = await redditClient.searchTrendingPosts("AI technology", 5);
        console.log(`✅ Reddit: Found ${results.length} trending posts`);
        if (results.length > 0 && results[0]) {
            console.log(`   📝 Sample: "${results[0].title}"`);
        }
        return true;
    } catch (error) {
        console.log(`❌ Reddit failed: ${error instanceof Error ? error.message : error}`);
        return false;
    }
}

async function testTwitterAPI() {
    console.log("\n🐦 Testing Twitter/X API...");
    try {
        const results = await twitterClient.searchTrendingTweets("AI trends", 5);
        console.log(`✅ Twitter: Found ${results.length} trending tweets`);
        if (results.length > 0 && results[0]) {
            console.log(`   📝 Sample: "${results[0].title}"`);
        }
        return true;
    } catch (error) {
        console.log(`❌ Twitter failed: ${error instanceof Error ? error.message : error}`);
        return false;
    }
}

async function testLinkedInAPI() {
    console.log("\n💼 Testing LinkedIn API...");
    try {
        const results = await linkedinClient.searchTrendingPosts("business technology", 5);
        console.log(`✅ LinkedIn: Found ${results.length} trending posts`);
        if (results.length > 0 && results[0]) {
            console.log(`   📝 Sample: "${results[0].title}"`);
        }
        return results.length > 0; // LinkedIn might return 0 due to API restrictions
    } catch (error) {
        console.log(`⚠️  LinkedIn failed: ${error instanceof Error ? error.message : error}`);
        console.log("   Note: LinkedIn API has strict access requirements");
        return false;
    }
}

async function testBlueskyAPI() {
    console.log("\n🦋 Testing Bluesky API...");
    try {
        const results = await blueskyClient.searchTrendingPosts("technology", 5);
        console.log(`✅ Bluesky: Found ${results.length} trending posts`);
        if (results.length > 0 && results[0]) {
            console.log(`   📝 Sample: "${results[0].title}"`);
        }
        return true;
    } catch (error) {
        console.log(`❌ Bluesky failed: ${error instanceof Error ? error.message : error}`);
        return false;
    }
}

async function testIntegratedPipeline() {
    console.log("\n🔄 Testing Integrated Marketing Pipeline...");
    
    const platforms: MarketingPlatform[] = ["reddit", "x", "linkedin", "bluesky"];
    let successCount = 0;
    
    for (const platform of platforms) {
        try {
            console.log(`\n   Testing ${platform} integration...`);
            const results = await researchPlatformTrends({
                platform,
                prompt: "AI marketing tools",
                companyName: "TechCorp",
                maxResults: 3,
            });
            
            console.log(`   ✅ ${platform}: ${results.length} results (${results.length > 0 ? 'API' : 'fallback'} mode)`);
            successCount++;
        } catch (error) {
            console.log(`   ❌ ${platform}: ${error instanceof Error ? error.message : error}`);
        }
    }
    
    console.log(`\n📊 Integration Results: ${successCount}/${platforms.length} platforms working`);
}

async function main() {
    console.log("🚀 Testing Marketing Pipeline Platform APIs\n");
    console.log("=" .repeat(50));
    
    // Test individual platform APIs
    const redditOk = await testRedditAPI();
    const twitterOk = await testTwitterAPI();
    const linkedinOk = await testLinkedInAPI();
    const blueskyOk = await testBlueskyAPI();
    
    // Test integrated pipeline
    await testIntegratedPipeline();  
    
    console.log("\n" + "=".repeat(50));
    console.log("📋 Summary:");
    console.log(`   Reddit API: ${redditOk ? '✅' : '❌'}`);
    console.log(`   Twitter API: ${twitterOk ? '✅' : '❌'}`);
    console.log(`   LinkedIn API: ${linkedinOk ? '✅' : '⚠️ '} ${linkedinOk ? '' : '(Limited access)'}`);
    console.log(`   Bluesky API: ${blueskyOk ? '✅' : '❌'}`);
    
    const workingAPIs = [redditOk, twitterOk, linkedinOk, blueskyOk].filter(Boolean).length;
    console.log(`\n🎯 ${workingAPIs}/4 platform APIs are working!`);
    
    if (workingAPIs === 0) {
        console.log("\n❗ No APIs are working. Check your API credentials in .env");
        process.exit(1);
    } else if (workingAPIs < 4) {
        console.log("\n⚠️  Some APIs need setup. See setup instructions above.");
    } else {
        console.log("\n🎉 All platform APIs are working perfectly!");
    }
}

main().catch((err) => {
    console.error("💥 Test failed:", err);
    process.exit(1);
});