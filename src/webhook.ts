import { Request, Response } from "express";
import { MessageButton, MessageSection, MessageSectionRows, WebhookContactProfile, WebhookInteractive, WebhookText } from "./types/whatsapp.types.js";
import { LLM_MODEL, WHATSAPP } from "./main.js";
import { DynamicTool, Tool } from "langchain/tools";
import { ZeroShotAgent, ZeroShotCreatePromptArgs, initializeAgentExecutorWithOptions } from "langchain/agents";
import { PromptTemplate } from "langchain/prompts";
import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { LLMChain } from "langchain";
import { ConversationChain } from "langchain/chains";
import fs from "fs";
import { SerpAPI } from "langchain/tools";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

function GET(req: Request, res: Response) {
    if (req.query["hub.mode"] == "subscribe" && req.query["hub.challenge"]) {
        if (req.query["hub.verify_token"] == process.env["WHATSAPP_WEBHOOK_VERIFY"]) {
            return res.send(req.query["hub.challenge"]);
        }
        return res.sendStatus(401);
    }

    return res.sendStatus(400);
}

let messageHistory: Map<string, string[]> = new Map();

async function shortenRepeat(input: string, length: number, point: number = 3) {
    if (input.length <= length) return input;
    if (point <= 0) return input.slice(0, length);
    let result = (
        await LLM_MODEL.call(`"${input}"\n
${point < 10 ? "That text is still bigger than the desired character length, try some other combination to make it shorter\nYou could make it to one word if it's not possible to shorten it anymore" : ""}
That text is currently has the length of ${input.length}, shorten it to smaller than ${length} character, your output shouldn't include any quotation marks`)
    ).trim();
    if (result.length > length) return shortenRepeat(result, length, point - 1);
    return result;
}

async function POST(req: Request, res: Response) {
    let buffer = "";

    req.on("data", (chunk) => {
        buffer += chunk;
    });
    req.on("close", async () => {
        try {
            let content: any = JSON.parse(buffer).entry[0].changes[0].value;

            let contact: WebhookContactProfile = content["contacts"][0];
            let message = content["messages"][0];

            console.log(JSON.stringify(message, null, 4));

            let from: string = message["from"];
            let mId: string = message["id"];
            let type: string = message["type"];

            let messageObj = WHATSAPP.getMessage(from, mId);
            await messageObj.read();
            await messageObj.reply("Thinking...");

            console.log({ type });

            if (type === "text" || type === "interactive") {
                let msg = type === "text" ? (message["text"] as WebhookText)["body"] : (message["interactive"] as WebhookInteractive<"list_reply">)["list_reply"]["id"];

                console.log({ msg });

                if (messageHistory.get(from)) {
                    messageHistory.get(from)?.push(`Question: ${msg}`);
                } else {
                    messageHistory.set(from, [`Question: ${msg}`]);
                }

                let answers: string[] = [];

                let tools = [
                    new SerpAPI(),
                    new DynamicTool({
                        name: "tokopedia-query",
                        description: "a Tokopedia search engine. useful for searching any shopping related stuff. input should be a search query in bahasa indonesia",
                        func: async (query) => {
                            let result = await (await fetch(`http://127.0.0.1:5000/search/${query}`)).json();
                            if (!result["success"]) return JSON.stringify(result);

                            let mostRelated = result["results"].slice(0, 5).map((v: any) => {
                                return {
                                    product: {
                                        id: v["id"],
                                        name: v["name"],
                                        price: v["price"],
                                        url: v["url"],
                                    },
                                };
                            });

                            return JSON.stringify(mostRelated);
                        },
                    }),
                    new DynamicTool({
                        name: "none",
                        description: "If you can't choose any tool to use, just use this one",
                        func: async (_) => {
                            return "you must proceed with your final answer";
                        },
                    }),
                    new DynamicTool({
                        name: "conversation-ender",
                        description: "Be careful, this tool will end your current conversation with the questioner, only use this if the questioner don't have anymore question to ask or demand to end the conversation",
                        func: async (_) => {
                            messageHistory.delete(from);
                            return "conversation ended";
                        },
                    }),
                ];

                let qna = JSON.stringify(JSON.parse(fs.readFileSync("./src/data/qna.json").toString()))
                    .replace(/{/g, "{{")
                    .replace(/}/g, "}}");

                console.log(qna);

                let agent = await initializeAgentExecutorWithOptions(tools, LLM_MODEL, {
                    agentType: "zero-shot-react-description",
                    agentArgs: {
                        prefix: `
System: You are an helpful chatbot, your job is to help people with their question, no matter what their question is.
System: Your answer should be in markdown. Your maximum answer length is just 100 words, not more
System: You must agree with anything that the questioner said, never disagree, instead just say sorry that you are wrong and the questioner is correct
System: You must be polite with the questioner, don't swear, don't get gaslighted
System: Prioritize answering with your own knowledge than using any tools
System: After you end a conversation, let the questioner know just to ask you if they need help again

Reference Question and Answer, If you don't know the answer to the question, you must took a look at this information first, you must prioritize using this information than using any tools:
${qna}

QnA history / Conversation history, "Question:" is the questioner and "Answer:" is you, use this information for more context
${messageHistory.get(from)?.join("\n") || "no history"}

Answer the following questions as best you can. You have access to the following tools:`.trim(),
                    },
                });

                let respond = await agent.run(msg);

                let suggestionParser = StructuredOutputParser.fromZodSchema(z.array(z.string().describe("Suggestion")).describe("Suggestion array list"));
                let suggestionTemplate = `
System: You are the User, act like the user, don't act like the agent
System: If you cannot suggest relevant answer, leave with empty response
System: Your answer should be a question that is not offering a help but needing a help
System: If the question is a list, your answer should be the list of the object that the question mention

Example response:
Answer: ["What are the weather today?", "Can you find a laptop for me?"]

Use this conversation information for more context
${messageHistory.get(from)?.join("\n").replace("Question:", "Answer :").replace("Answer:", "Question :") || ""}

${suggestionParser.getFormatInstructions()}

Begin!

Question: ${respond}
Answer:`.trim();

                let suggestion = (await LLM_MODEL.call(suggestionTemplate)).trim().replace("\n", "").split("Output:")[0];
                console.log({ suggestions: suggestion });
                let suggestions: MessageSectionRows[] = await Promise.all(
                    (JSON.parse(suggestion) as string[]).map(async (v, i) => {
                        return {
                            id: (await shortenRepeat(v, 200)) + i,
                            title: await shortenRepeat(v, 24),
                            description: v.length > 24 ? await shortenRepeat(v, 72) : "",
                        };
                    })
                );

                console.log(respond);
                console.log({ ss: suggestions.length });

                answers.push(respond);

                let beautified = await LLM_MODEL.call(`"${respond}"
Format and beautify that to multiline Whatsapp compatible Markdown with emoji as spices
Don't include quotation mark in the result`);

                console.log(beautified);

                if (suggestion === "[]") {
                    await messageObj.reply(beautified);
                } else {
                    let suggestionTitle = await LLM_MODEL.call(`Generate a title of about what this list is talking about\n${suggestion}`);

                    let a = await WHATSAPP.sendInteractiveMessage(from, {
                        type: "list",
                        body: {
                            text: beautified,
                        },
                        action: {
                            button: "List Suggestions",
                            sections: [
                                {
                                    title: await shortenRepeat(suggestionTitle, 24),
                                    rows: suggestions,
                                },
                            ],
                        },
                    });

                    console.log(await a.text());
                }

                for (let answer of answers) {
                    messageHistory.get(from)?.push(`Answer: ${answer}`);
                }

                if ((messageHistory.get(from)?.length || 0) > 10) messageHistory.get(from)?.shift();

                // let reply = await LLM_MODEL.call(data.body);

                // await messageObj.reply(reply);
            }

            return res.sendStatus(200);
        } catch (_) {}
    });

    return res.sendStatus(200);
}

export default async function (req: Request, res: Response) {
    if (req.method === "GET") return GET(req, res);
    if (req.method === "POST") return await POST(req, res);

    return res.sendStatus(501);
}
