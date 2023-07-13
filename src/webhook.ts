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

enum UserState {
    INITIAL,
    BOT_TYPE_CHOICE,
    GOOGLE_QUERY,
    TOKOPEDIA_QUERY,
    CONFIRMATION,
    SEARCH_CONFIRMATION,
}

const BOT_TYPES = ["Search on Google", "Search on Tokopedia"];

let userState: Map<string, { state: UserState; info?: any }> = new Map();

async function decideOption(message: string, list: string[]) {
    let chosen = (
        await LLM_MODEL.call(`Input: ${message}
Based on this list
${JSON.stringify(list)}

Which of those list option that is the most similar to the input message?


If the answer is not in one of the options list, just answer with "None"
Your answer should only choose one of the option from the list


Answer:`)
    )
        .trim()
        .replace(/\"/g, "");

    if (chosen.toLowerCase() === "none") return -1;

    return list
        .map((v, i) => {
            return {
                v: chosen.toLowerCase().includes(v.toLowerCase()),
                i,
            };
        })
        .filter((v) => v.v)[0].i;
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

            let user = WHATSAPP.getUser(from);
            let messageObj = WHATSAPP.getMessage(from, mId);
            await messageObj.read();

            if (type === "text" || type === "interactive") {
                let msg = type === "text" ? (message["text"] as WebhookText)["body"] : message["interactive"]["type"] === "list_reply" ? (message["interactive"] as WebhookInteractive<"list_reply">)["list_reply"]["id"] : message["interactive"]["type"] === "button_reply" ? (message["interactive"] as WebhookInteractive<"button_reply">)["button_reply"]["id"] : "";

                let retry = true;

                while (retry) {
                    retry = false;

                    let state = userState.get(from) || userState.set(from, { state: UserState.INITIAL }).get(from);
                    console.log(userState.get(from));

                    if (state?.state === UserState.INITIAL) {
                        await user.interactive.sendButtons(`Hello ${contact.profile.name}, what can I do for you?`, BOT_TYPES);
                        userState.set(from, { state: UserState.BOT_TYPE_CHOICE });
                        return;
                    }

                    if (state?.state === UserState.BOT_TYPE_CHOICE) {
                        let chosen = BOT_TYPES.map((v) => v.toLowerCase().trim()).indexOf(msg.toLowerCase().trim());
                        if (chosen !== -1) {
                            switch (chosen) {
                                case 0: {
                                    await user.sendMessage(`What should I search in Google?`);
                                    userState.set(from, { state: UserState.GOOGLE_QUERY });
                                    return;
                                }
                                case 1: {
                                    await user.sendMessage(`What should I search in Tokopedia?`);
                                    userState.set(from, { state: UserState.TOKOPEDIA_QUERY });
                                    return;
                                }
                            }
                        }

                        let which = await decideOption(msg, BOT_TYPES);
                        if (which !== -1) {
                            await user.interactive.sendButtons(`Did you mean "${BOT_TYPES[which]}" ?`, ["Yes", "No"]);

                            switch (which) {
                                case 0: {
                                    userState.set(from, {
                                        state: UserState.CONFIRMATION,
                                        info: {
                                            type: UserState.GOOGLE_QUERY,
                                        },
                                    });
                                    console.log({ userState });
                                    return;
                                }
                                case 1: {
                                    userState.set(from, {
                                        state: UserState.CONFIRMATION,
                                        info: {
                                            type: UserState.TOKOPEDIA_QUERY,
                                        },
                                    });
                                    return;
                                }
                            }

                            return;
                        }

                        await user.sendMessage(`Sorry but I don't know with what you mean by "${msg.trim()}"`);
                        userState.set(from, { state: UserState.INITIAL });
                        retry = true;
                        continue;
                    }

                    if (state?.state === UserState.CONFIRMATION) {
                        let correct = msg.toLowerCase().trim().includes("yes");
                        let info = state.info["type"] as UserState;

                        if (correct) {
                            switch (info) {
                                case UserState.GOOGLE_QUERY: {
                                    await user.sendMessage(`What should I search in Google?`);
                                    userState.set(from, { state: UserState.GOOGLE_QUERY });
                                    return;
                                }
                                case UserState.TOKOPEDIA_QUERY: {
                                    await user.sendMessage(`What should I search in Tokopedia?`);
                                    userState.set(from, { state: UserState.TOKOPEDIA_QUERY });
                                    return;
                                }
                            }
                        }

                        let which = await decideOption(msg, ["Yes", "No"]);

                        if (which === 0) {
                            switch (info) {
                                case UserState.GOOGLE_QUERY: {
                                    await user.sendMessage(`What should I search in Google?`);
                                    userState.set(from, { state: UserState.GOOGLE_QUERY });
                                    break;
                                }
                                case UserState.TOKOPEDIA_QUERY: {
                                    await user.sendMessage(`What should I search in Tokopedia?`);
                                    userState.set(from, { state: UserState.TOKOPEDIA_QUERY });
                                    break;
                                }
                            }
                        }

                        await user.sendMessage(`Sorry if I didn't catch you right 😔`);
                        userState.set(from, { state: UserState.INITIAL });
                        retry = true;
                        continue;
                    }

                    if (state?.state === UserState.SEARCH_CONFIRMATION) {
                        let correct = ["Yes", "No", "Search Again"].indexOf(msg.trim());
                        let info = state.info["type"] as UserState;

                        if (correct === 1 || correct === 2) {
                            if (correct === 1) {
                                await user.sendMessage(`Sorry if that is not what you're looking for 😔`);
                            }
                            await user.sendMessage(`What should I search again? 🤔`);

                            switch (info) {
                                case UserState.GOOGLE_QUERY: {
                                    userState.set(from, { state: UserState.GOOGLE_QUERY });
                                    return;
                                }
                                case UserState.TOKOPEDIA_QUERY: {
                                    userState.set(from, { state: UserState.TOKOPEDIA_QUERY });
                                    return;
                                }
                            }
                        }

                        let which = await decideOption(msg, ["Yes", "No", "Search Again"]);

                        if (which === 1 || which === 2) {
                            if (correct === 1) {
                                await user.sendMessage(`Sorry if that is not what you're looking for 😔`);
                            }
                            await user.sendMessage(`What should I search again? 🤔`);

                            switch (info) {
                                case UserState.GOOGLE_QUERY: {
                                    userState.set(from, { state: UserState.GOOGLE_QUERY });
                                    break;
                                }
                                case UserState.TOKOPEDIA_QUERY: {
                                    userState.set(from, { state: UserState.TOKOPEDIA_QUERY });
                                    break;
                                }
                            }
                        }

                        await user.sendMessage(`I'm glad I could help you ☺`);
                        userState.set(from, { state: UserState.INITIAL });
                        retry = true;
                        continue;
                    }

                    if (state?.state === UserState.GOOGLE_QUERY || state?.state === UserState.TOKOPEDIA_QUERY) {
                        let tools = [
                            new DynamicTool({
                                name: "none",
                                description: "If you can't choose any tool to use, just use this one",
                                func: async (_) => {
                                    return "you must proceed with your final answer";
                                },
                            }),
                        ];

                        if (state.state === UserState.GOOGLE_QUERY) {
                            tools.push(
                                new DynamicTool({
                                    name: "google-searcher",
                                    description: "a search engine. useful for when you need to answer questions about current events. input should be a search query.",
                                    func: async (query) => {
                                        await WHATSAPP.sendTextMessage(from, `Searching "${query}" in Google`);

                                        return new SerpAPI()._call(query);
                                    },
                                })
                            );
                        }
                        if (state.state === UserState.TOKOPEDIA_QUERY) {
                            tools.push(
                                new DynamicTool({
                                    name: "tokopedia-searcher",
                                    description: "a Tokopedia search engine. useful for searching any shopping related stuff. input should be a search query in bahasa indonesia",
                                    func: async (query) => {
                                        await WHATSAPP.sendTextMessage(from, `Searching "${query}" in Tokopedia`);

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
                                })
                            );
                        }

                        let agent = await initializeAgentExecutorWithOptions(tools, LLM_MODEL, {
                            agentType: "zero-shot-react-description",
                            agentArgs: {
                                prefix: `
System: Be joyful with your answer
System: Format and beautify with spaces the answer
System: Add utf8 emoji to your answer
System: You should also put the accurate url from the search result in the bottom after two line break as source in your answer

Answer the following questions as best you can. You have access to the following tools:`,
                            },
                        });

                        let result = (await agent.run(msg)).trim();

                        await user.sendMessage(result);
                        await user.interactive.sendButtons(`Is that what you're looking for?`, ["Yes", "No", "Search Again"]);

                        userState.set(from, {
                            state: UserState.SEARCH_CONFIRMATION,
                            info: {
                                type: state.state,
                            },
                        });
                    }
                }
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
