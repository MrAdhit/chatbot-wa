import { MessageInteractive } from "../types/whatsapp.types.js";

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

    getMessage(to: string, messageId: string) {
        return new WhatsappMessage(to, messageId, this);
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
