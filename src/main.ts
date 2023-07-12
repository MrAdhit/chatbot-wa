import express from "express";
import { AddressInfo } from "net";

import webhook from "./webhook.js";
import WhatsappAPI from "./lib/whatsapp.js";
import { OpenAI } from "langchain/llms/openai";

export const WHATSAPP = new WhatsappAPI(process.env["WHATSAPP_ACCESS_TOKEN"] || "", process.env["WHATSAPP_PHONE_ID"] || "");
export const LLM_MODEL = new OpenAI({ temperature: 0, verbose: true });

const app = express();

app.use((req, res, next) => {
    console.log(req.url);

    next();
});

app.get("/", (req, res) => {
    return res.sendStatus(200);
});

app.get("/nodejs/token", (req, res) => {
    return res.send("bro stfu");
});

app.all("/webhook", webhook);

let listener = app.listen(process.env["LISTEN_PORT"], () => {
    let address = listener.address() as AddressInfo;
    console.log(`Server started at https://${address.address}:${address.port}`);
});
