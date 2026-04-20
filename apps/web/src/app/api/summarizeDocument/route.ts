// import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
// import {  ChatOpenAI, OpenAIEmbeddings} from "@langchain/openai";
// import { MemoryVectorStore } from "langchain/vectorstores/memory";
// import { LLMChain } from "langchain/chains";
// import fetch from "node-fetch";
// import fs from "fs/promises";
// import path from "path";
// import OpenAI from "openai";
// import { NextResponse } from "next/server";
// import {PromptTemplate} from "@langchain/core/prompts";
//
// export async function POST(request: Request) {
//     try {
//         // 1) Fetch the remote PDF file
//         const {url} = await request.json();
//
//         const pdfUrl = url;
//         const response = await fetch(pdfUrl);
//
//         if (!response.ok) {
//             throw new Error(
//                 `Unable to fetch PDF from ${pdfUrl}: ${response.status} ${response.statusText}`
//             );
//         } else {
//             console.log("PDF fetched successfully");
//         }
//
//         // 2) Convert response to a Buffer
//         const pdfArrayBuffer = await response.arrayBuffer();
//         const pdfBuffer = Buffer.from(pdfArrayBuffer);
//
//         // 3) Write to a temp file in your server environment
//         const tempFilePath = path.join(process.cwd(), "temp.pdf");
//         await fs.writeFile(tempFilePath, pdfBuffer);
//
//         // 4) Use PDFLoader on that temp file
//         const loader = new PDFLoader(tempFilePath);
//         const docs = await loader.load();
//
//         // --- LangChain Logic ---
//         const textSplitter = new RecursiveCharacterTextSplitter({
//             chunkSize: 1000,
//             chunkOverlap: 200,
//         });
//         const allSplits = await textSplitter.splitDocuments(docs);
//
//         // 3. Create an LLM instance (OpenAI here, can be any supported LLM)
//         const llm = new OpenAI({
//             openAIApiKey: process.env.OPENAI_API_KEY,
//             temperature: 0,
//         });
//
//         // 4. Create a prompt for summarizing each chunk into a short paragraph
//         const summarizeChunkPrompt = new PromptTemplate({
//             inputVariables: ["chunk"],
//             template: `
//               You are a helpful assistant that summarizes text.
//               Please provide a concise paragraph summarizing the following text:
//
//               {chunk}
//             `,
//         });
//
//         const summarizeChunkChain = new LLMChain({
//             llm,
//             prompt: summarizeChunkPrompt,
//         });
//         const chunkSummaries: string[] = [];
//         for (const doc of chunks) {
//             // doc.pageContent is the raw text for that chunk
//             const summary = await summarizeChunkChain.call({
//                 chunk: doc.pageContent,
//             });
//             chunkSummaries.push(summary.text.trim());
//         }
//
//         // 7. Combine all chunk-level summaries into one paragraph
//         const mergePrompt = new PromptTemplate({
//             inputVariables: ["summaries"],
//             template: `
//       You have the following partial summaries of a larger document:
//
//       {summaries}
//
//       Please combine these partial summaries into a single cohesive paragraph
//       that captures the essence of the entire document.
//     `,
//         });
//
//         // 8. Chain to merge all chunk-level summaries into one
//         const mergeChain = new LLMChain({
//             llm,
//             prompt: mergePrompt,
//         });
//
//         // Convert array of summaries into a single string
//         const combinedSummary = await mergeChain.call({
//             summaries: chunkSummaries.join("\n\n"),
//         });
//
//         return combinedSummary.text.trim();
//
//
//     }
//     catch (error) {
//         console.error("API Error:", error);
//         return NextResponse.json(
//             { error: "An error occurred while processing your request." },
//             { status: 500 }
//         );
//     }
// }
