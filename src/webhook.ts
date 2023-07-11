import { Request, Response } from "express";
import { WebhookContactProfile, WebhookText } from "./types/whatsapp.types.js";
import { LLM_MODEL, WHATSAPP } from "./main.js";
import { DynamicTool, Tool } from "langchain/tools";
import { ZeroShotAgent, ZeroShotCreatePromptArgs, initializeAgentExecutorWithOptions } from "langchain/agents";
import { PromptTemplate } from "langchain/prompts";
import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { LLMChain } from "langchain";
import { ConversationChain } from "langchain/chains";
import fs from "fs";
import { SerpAPI } from "langchain/tools";

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

            if (type === "text") {
                let data = message["text"] as WebhookText;

                let answers: string[] = [];

                let tools = [
                    new SerpAPI("13c303117b20e8f1395f18fc349b7f62e7f7a5a8732e1b2d4856d2414ef7b98f"),
                    new DynamicTool({
                        name: "tokopedia-query",
                        description: "a Tokopedia search engine. useful for searching any products from tokopedia. input should be a search query in bahasa indonesia",
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
                ];

                let agent = await initializeAgentExecutorWithOptions(tools, LLM_MODEL, {
                    agentType: "zero-shot-react-description",
                    agentArgs: {
                        prefix: `
You are an helpful chatbot, your job is to help people with their question, no matter what their question is.
Your answer should be in markdown

QnA history / Conversation history, "Question:" is the questioner and "Answer:" is you, use this information for more context
${messageHistory.get(from)?.join("\n") || "no history"}

Answer the following questions as best you can. You have access to the following tools:`,
                    },
                });

                let respond = await agent.run(data.body);

                //                 let respond = (
                //                     await LLM_MODEL.call(`${JSON.stringify(JSON.parse(fs.readFileSync("./src/data/qna.json").toString()))}

                // ${messageHistory.get(from)?.join("\n") || ""}
                // Question: ${data.body}
                // Thought:`)
                //                 ).trim();

                console.log(respond);

                answers.push(respond);
                await messageObj.reply(respond);

                // await WHATSAPP.sendInteractiveMessage(from, {
                //     type: "button",
                //     body: {
                //         text: "Test Buttons",
                //     },
                //     action: {
                //         buttons: [
                //             {
                //                 type: "reply",
                //                 reply: {
                //                     id: "ID",
                //                     title: "TITLE",
                //                 },
                //             },
                //             {
                //                 type: "reply",
                //                 reply: {
                //                     id: "ID2",
                //                     title: "TITLE 2",
                //                 },
                //             },
                //             {
                //                 type: "reply",
                //                 reply: {
                //                     id: "ID3",
                //                     title: "TITLE 3",
                //                 },
                //             },
                //         ],
                //     },
                // });

                // await WHATSAPP.sendInteractiveMessage(from, {
                //     type: "list",
                //     header: {
                //         type: "text",
                //         text: "Header",
                //     },
                //     body: {
                //         text: "Test List",
                //     },
                //     footer: {
                //         text: "Footer",
                //     },
                //     action: {
                //         button: "List",
                //         sections: [
                //             {
                //                 title: "List 1",
                //                 rows: [
                //                     {
                //                         id: "ID",
                //                         title: "Title",
                //                         description: "Desc",
                //                     },
                //                 ],
                //             },
                //             {
                //                 title: "List 2",
                //                 rows: [
                //                     {
                //                         id: "ID2",
                //                         title: "Title",
                //                         description: "Desc",
                //                     },
                //                 ],
                //             },
                //         ],
                //     },
                // });

                if (messageHistory.get(from)) {
                    messageHistory.get(from)?.push(`Question: ${data.body}`);
                    for (let answer of answers) {
                        messageHistory.get(from)?.push(`Answer: ${answer}`);
                    }

                    if ((messageHistory.get(from)?.length || 0) > 10) messageHistory.get(from)?.shift();
                } else {
                    messageHistory.set(from, [`Question: ${data.body}`, ...answers.map((v) => `Answer: ${v}`)]);
                }

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
