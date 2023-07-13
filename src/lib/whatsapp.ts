import { MessageButton, MessageInteractive } from "../types/whatsapp.types.js";

class WhatsappMessage {
    private to: string;
    private messageId: string;
    private api: WhatsappAPI;

    constructor(to: string, messageId: string, api: WhatsappAPI) {
        this.to = to;
        this.messageId = messageId;
        this.api = api;
    }

    read() {
        return this.api.request({
            messaging_product: "whatsapp",
            status: "read",
            message_id: this.messageId,
        });
    }

    reply(message: string) {
        return this.api.request({
            messaging_product: "whatsapp",
            context: {
                message_id: this.messageId,
            },
            to: this.to,
            type: "text",
            text: {
                preview_url: false,
                body: message,
            },
        });
    }
}

class WhatsappUser {
    private to: string;
    private api: WhatsappAPI;

    constructor(to: string, api: WhatsappAPI) {
        this.to = to;
        this.api = api;
    }

    sendMessage(message: string) {
        return this.api.sendTextMessage(this.to, message);
    }

    get interactive() {
        return new WhatsappInteractiveMessage(this.to, this.api);
    }
}

class WhatsappInteractiveMessage {
    private to: string;
    private api: WhatsappAPI;

    constructor(to: string, api: WhatsappAPI) {
        this.to = to;
        this.api = api;
    }

    sendButtons(message: string, buttons: string[]) {
        let btns: MessageButton[] = buttons.map((v) => {
            return {
                type: "reply",
                reply: {
                    id: v,
                    title: v.slice(0, 20),
                },
            };
        });

        return this.api.sendInteractiveMessage(this.to, {
            type: "button",
            body: {
                text: message,
            },
            action: {
                buttons: btns,
            },
        });
    }
}

export default class WhatsappAPI {
    private auth: string;
    private endpoint: string;

    constructor(accessToken: string, phoneNumberId: string) {
        this.auth = `Bearer ${accessToken}`;
        this.endpoint = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
    }

    sendTextMessage(to: string, message: string) {
        return this.request({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: {
                preview_url: false,
                body: message,
            },
        });
    }

    sendInteractiveMessage(to: string, interactive: MessageInteractive) {
        return this.request({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "interactive",
            interactive: interactive,
        });
    }

    getUser(number: string) {
        return new WhatsappUser(number, this);
    }

    getMessage(number: string, messageId: string) {
        return new WhatsappMessage(number, messageId, this);
    }

    request(data: object) {
        return fetch(this.endpoint, {
            headers: {
                Authorization: this.auth,
                "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify(data),
        });
    }
}
