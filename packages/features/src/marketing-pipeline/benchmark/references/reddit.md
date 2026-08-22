# Reddit — Marketing Post Evaluation Reference

Fed **verbatim** to the LLM judge as the platform standard for Reddit. The judge
reads the GOOD and BAD examples below — each with the company context it was
written from — and uses them as the calibration bar when scoring a candidate post.
The judge SCORES ONLY; it never rewrites.

> **Curation rules**: real, public
> **marketing / advertisement** posts (a minor feature update shared as an ad
> counts) — **NOT** brand-new product-launch announcements. Target **10 good +
> 3–5 bad** posts drawn from **>3 big companies** (AppLovin, Cursor, Perplexity,
> General Translation, PostHog, …). Keep excerpts short and attributed.
> Reddit is community-first — the best "marketing" posts rarely read as ads.

## Company-context format (mirror of the generation pipeline)

Each example carries the **same company-context window the generator sees**
(`buildCompanyKnowledgeContext` / `buildMetadataContext` in
[../../context.ts](../../context.ts)), so groundedness is judged against the same
facts the post was written from. Fill this block for every example. For Reddit,
also note the **subreddit** (the generator takes `platformMeta.subreddit`):

```text
Company Name:            # company table (companies)
Company Description:     # company table
Industry / Sector:       # company table
Employee Count Range:    # company table
Company Categories:      # category table (per company)
Knowledge Base Signals:  # RAG over the company's document embeddings (top snippets)
Subreddit:               # target community context (platformMeta.subreddit)
# Optional metadata block (present only when company_metadata JSONB exists):
# === Services & Products ===
# === Projects & Outcomes ===
# === Markets ===
```

> **DB provenance** (matches what generation reads): identity fields come from the
> `company` and `category` tables; _Knowledge Base Signals_ come from the RAG index
> over the company's uploaded documents; the optional `=== … ===` sections come
> from the `company_metadata` JSONB.

## Reddit platform norms

<!-- fill: authentic community voice, no hashtags, no corporate-speak, value/story
     first, discloses affiliation, fits the target subreddit's culture, invites
     discussion rather than pitching -->

---

## GOOD examples

### good-1

**Company:** <!-- e.g. Cursor -->
**Company context:**

```text
Company Name:
Company Description:
Industry / Sector:
Employee Count Range:
Company Categories:
Knowledge Base Signals:
Subreddit:
```

**Post:**

```text

```

**Why it's good:** <!-- one line -->

### good-2

**Company:**
**Company context:**

```text
Company Name:
Company Description:
Industry / Sector:
Employee Count Range:
Company Categories:
Knowledge Base Signals:
Subreddit:
```

**Post:**

```text

```

**Why it's good:**

<!-- Repeat good-3 … good-10 (target 10, spread across >3 companies). -->

---

## BAD examples

### bad-1

**Company:**
**Company context:**

```text
Company Name:
Company Description:
Industry / Sector:
Employee Count Range:
Company Categories:
Knowledge Base Signals:
Subreddit:
```

**Post:**

```text

```

**Why it's bad:** <!-- one line: reads like an ad / corporate tone / breaks subreddit norms / ungrounded claim -->

<!-- Repeat bad-2 … bad-5 (target 3–5). -->
