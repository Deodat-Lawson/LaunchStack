// import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
// import { ChatOpenAI } from "@langchain/openai";
// import { tool } from "@langchain/core/tools";
// import { MemorySaver } from "@langchain/langgraph";
// import { createReactAgent } from "@langchain/langgraph/prebuilt";
// import { TavilySearchAPIRetriever } from "@langchain/community/retrievers/tavily_search_api";

// // Define the tools for the agent to use
// const agentTools = [new TavilySearchResults({ maxResults: 3 })];
// const agentModel = new ChatOpenAI({ temperature: 0 });

// // Initialize memory to persist state between graph runs
// const agentCheckpointer = new MemorySaver();
// const agent = createReactAgent({
//   llm: agentModel,
//   tools: agentTools,
//   checkpointSaver: agentCheckpointer,
// });


// const fetchMenu = tool(
//     async ({ restaurant, location }: { restaurant: string; location: string }) => {
//       const retriever = new TavilySearchAPIRetriever({ k: 3 });
//       // Exclude Yelp, TripAdvisor, Facebook
//       const query = `menu page for ${restaurant} at ${location}`;

  
//       const docsWithMetadata = await retriever.getRelevantDocuments(query);
//       if (!docsWithMetadata?.length) {
//         throw new Error(`No valid menu page URL found for ${restaurant} in ${location}.`);
//       }




//       // Pick the first "clean" result, or fall back to the very first if none remain

//       // console.log("Docs with metadata:", docsWithMetadata);

//       const officialWebsite = await findOfficialWebsite.invoke({ links: docsWithMetadata.map(doc => doc.metadata.source as string) });
//       console.log("Official website:", officialWebsite);
//       const menuUrl = officialWebsite;
  
//       // console.log("Using menu URL:", menuUrl);

//       // // Export/Download the menuUrl to a pdf/image, and process it in Langchain. 
  
//       // const loader = new CheerioWebBaseLoader(menuUrl);
//       // const loadedDocs = await loader.load();
  
//       // // Condense HTML and remove extra whitespace
//       // const condensedMenu = loadedDocs
//       //   .map(d => d.pageContent.replace(/\s{2,}/g, ' ').trim())
//       //   .join('\n');
  
//       return menuUrl;
//     },
//     {
//       name: "fetch_menu",
//       description: "Fetches the restaurant's official menu page HTML and returns raw text",
//       schema: z.object({
//         restaurant: z.string().describe("The restaurant name"),
//         location:   z.string().describe("The restaurant location"),
//       }),
//     }
//   );



// const findOfficialWebsite = tool(
//     async ({ links }: { links: string[] }) => {
//       const llm = new ChatOpenAI({ temperature: 0 });
//       const prompt = `
//       I will give you a list of URLs related to a restaurant. Your job is to:
//       1. Filter out any URLs not on the restaurant’s own domain (ignore Yelp, TripAdvisor, Facebook, etc.).
//       2. From the remaining URLs, select the one whose path clearly indicates it’s the menu or ordering page (e.g. contains “/menu”, “/order”, “/menu.html”, etc.).
//       3. If no specific menu/order URL is found, return the restaurant’s homepage URL.
//       Return exactly one URL—nothing else.
      
//       Example 1:
//       Links:
//       https://www.yelp.com/biz/chipotle-mexican-grill-baltimore-2  
//       https://www.tripadvisor.com/Restaurant_Review-g34515-d148318-Reviews-Chipotle-Baltimore_Maryland.html  
//       https://www.facebook.com/ChipotleTaco/  
//       https://www.chipotle.com/menu  
      
//       Return the official menu/order URL:  
//       https://www.chipotle.com/menu
      
//       Example 2:
//       Links:
//       https://www.yelp.com/search?find_desc=Good+Fortune&find_loc=Baltimore%2C+MD  
//       https://www.laoszechuanbaltimore.com/order 
      
//       Return the official URL (no menu/order path available):  
//       https://www.laoszechuanbaltimore.com/order
      
//       Example 3:
//       Links:
//       https://goodfood.com/  
//       https://goodfood.com/order-online  
//       https://goodfood.com/reservations  
      
//       Return the official menu/order URL:  
//       https://goodfood.com/order-online
      
//       Example 4:
//       Links:
//       https://spicytacos.com/Menu  
//       https://spicytacos.com/contact  
      
//       Return the official menu/order URL:  
//       https://spicytacos.com/Menu
      
//       Example 5:
//       Links:
//       https://noodlehouse.example.org  
//       https://yelp.com/biz/noodle-house-city  
//       https://noodlehouse.example.org/menu.aspx?lang=en  
      
//       Return the official menu/order URL:  
//       https://noodlehouse.example.org/menu.aspx?lang=en
      
//       Here are the links:
//       ${links}
//       `.trim();
      
//       const output = await llm.invoke([{ role: 'user', content: prompt }]);
//       return output.content;
//     },
//     {
//       name: "find_official_website",
//       description: "Finds the official website of the restaurant",
//       schema: z.object({
//         links: z.array(z.string()).describe("A list of links of websites that are related to the restaurant."),
//       }),
//     }
// )
  

// // Define Zod schema for the output of parseMenu
// // Renamed from MenuItemsSchema to MenuItemsArraySchema
// const MenuItemsArraySchema = z.array(z.string()).describe("A list of menu item names extracted from the menu text.");
// // New object schema for structured output
// const StructuredMenuItemsOutputSchema = z.object({
//   menuItems: MenuItemsArraySchema.describe("The extracted list of menu items.")
// });

// const parseMenu = tool(
//     async ({ menu }: { menu: string }) => {
//       const llm = new ChatOpenAI({ temperature: 0 });
//       // Use the new object schema for structured output
//       const structuredLlm = llm.withStructuredOutput(StructuredMenuItemsOutputSchema);
//       //use few shot examples
//       const prompt = 
//         `You are a JSON‐extraction assistant. You'll be shown a restaurant menu and must return a JSON array of all menu item names.

//         Example 1:
//         Menu text:
//         ---
//         Appetizers
//         • Spring Rolls – Crispy vegetable rolls served with sweet chili
//         • Edamame – Steamed soybeans with sea salt
//         Entrées
//         • Pad Thai – Rice noodles with peanuts, egg, and tofu
//         ---

//         Assistant's reasoning:
//         1. Identify "Spring Rolls" (ignore "– Crispy vegetable…").  
//         2. Identify "Edamame" (ignore description).  
//         3. Identify "Pad Thai".  
//         Final output:
//         ["Spring Rolls","Edamame","Pad Thai"]

//         Example 2:
//         Menu text:
//         ---
//         Starters:
//         1. Garlic Bread: Toasted baguette slices with garlic butter
//         2. Bruschetta: Tomato, basil, garlic on grilled bread
//         Main Courses:
//         - Margherita Pizza (tomato, fresh mozzarella, basil)
//         ---

//         Assistant's reasoning:
//         1. "Garlic Bread" from "1. Garlic Bread: …".  
//         2. "Bruschetta" from "2. Bruschetta: …".  
//         3. "Margherita Pizza".  
//         Final output:
//         ["Garlic Bread","Bruschetta","Margherita Pizza"]

//         Now it's your turn. Follow these steps:

//         **1.** Read the menu text below.  
//         **2.** Independently generate THREE separate chains of thought ("Chain 1","Chain 2","Chain 3"), each listing step‐by‐step how you extract items.  
//         **3.** After each chain, give a "Result" array.  
//         **4.** Finally, compare the three Result arrays and output the most consistent JSON array (i.e. the list of items that appears in at least two of your three chains).

//         Output _only_ that final JSON array of strings—nothing else.

//         Menu text:
//         ${menu}

//         Do not answer anything else not in the urls provided.
//         ;`
//       // Extract the array from the object returned by structuredLlm
//       const output = await structuredLlm.invoke([{ role: 'user', content: prompt }]);
//       return output.menuItems;
//     },
//     {
//       name: "parse_menu",
//       description: "Parses menu text and returns a list of item names",
//       schema: z.object({
//         menu: z.string().describe("The raw menu text content"),
//       }),
//     }
//   );
  


// // Define Zod schema for the output of parseIngredients
// // Renamed from IngredientsSchema to IngredientsArraySchema
// const IngredientsArraySchema = z.array(z.string()).describe("A list of ingredients for a specific menu item.");
// // New object schema for structured output
// const StructuredIngredientsOutputSchema = z.object({
//   ingredients: IngredientsArraySchema.describe("The extracted list of ingredients.")
// });

//   const parseIngredients = tool(
//     async ({ menu, item }: { menu: string; item: string }) => {
//       const llm = new ChatOpenAI({ temperature: 0 });
//       // Use the new object schema for structured output
//       const structuredLlm = llm.withStructuredOutput(StructuredIngredientsOutputSchema);
//       const prompt = `From the following menu text:

//         ${menu}

//         Extract a JSON array of ingredient strings for the menu item "${item}". Use your best judgment to infer possible ingredients and return them as a list. If you cannot reasonably infer any ingredients, return an empty array.

//         Example:
//         Menu Text:
//         ---
//         Cheeseburger - Beef patty, cheddar cheese, lettuce, tomato, onion, special sauce, on a sesame seed bun.
//         Fries - Crispy potato fries.
//         Soda - A refreshing carbonated beverage.
//         ---
//         Menu Item: "Cheeseburger"
//         Output: ["Beef patty", "cheddar cheese", "lettuce", "tomato", "onion", "special sauce", "sesame seed bun"]

//         Menu Item: "Fries"
//         Output: ["potato"]

//         Menu Item: "Soda"
//         Output: ["carbonated water", "sweetener", "flavoring"]

//         Menu Item: "Milkshake"
//         Output: ["milk", "sugar"]
//         ---

//         Now, for the provided menu and item:
//         Menu text:
//         ${menu}

//         Menu Item: "${item}"

//         Return _only_ the JSON array of ingredient strings.
//         ;`
//       // Extract the array from the object returned by structuredLlm
//       const output = await structuredLlm.invoke([{ role: 'user', content: prompt }]);
//       return output.ingredients;
//     },
//     {
//       name: "parse_ingredients",
//       description: "Extracts ingredients for a given menu item and returns them as a list of strings.",
//       schema: z.object({
//         menu: z.string().describe("The raw menu text"),
//         item: z.string().describe("The menu item name"),
//       }),
//     }
//   );  

// const restaurant = "Chipotle";
// const location = "3201 St Paul St, Baltimore, MD 21218";

// const restaurant2 = "Tamber's Restaurant";
// const location2 = "3327 St Paul St, Baltimore, MD 21218";

// const restaurant3 = "Lao Sze Chuan";
// const location3 = "3224 St Paul St, Baltimore, MD 21218";


// // Wrap execution in an async function to avoid top-level await
// async function runAgent() {
//   try {
//     // Now it's time to use!

//     const rawMenu = await fetchMenu.invoke({ restaurant: restaurant, location: location });
//     // console.log("Raw menu:", rawMenu);
    
//     // parseMenu now directly returns string[]
//     const menuItems: string[] = await parseMenu.invoke({ menu: rawMenu });

//     console.log("Menu items:", menuItems);

//     if (menuItems.length > 0) {
//       // parseIngredients now directly returns string[]
//       const ingredients: string[] = await parseIngredients.invoke({ menu: rawMenu, item: menuItems[0] });

//       menuItems.map(async (item) => {
//         // console.log("Ingredients for ", item, ":", await parseIngredients.invoke({ menu: rawMenu, item: item }));
//       });
//     } else {
//       // console.log("No menu items found to parse ingredients for.");
//     }

//   } catch (error) {
//     console.error("Error running agent:", error);
//   }
// }

// // Execute the function
// runAgent();