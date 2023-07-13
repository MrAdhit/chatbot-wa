export interface WebhookText {
    body: string;
}

export type WebhookInteractiveTypes = "button_reply" | "list_reply";

export type WebhookInteractive<T extends WebhookInteractiveTypes> = T extends "button_reply"
    ? {
          type: "button_reply";
          button_reply: WebhookButtonReply;
      }
    : T extends "list_reply"
    ? {
          type: "list_reply";
          list_reply: WebhookListReply;
      }
    : never;

export interface WebhookButtonReply {
    id: string;
    title: string;
}

export interface WebhookListReply {
    id: string;
    title: string;
    description: string;
}

export interface WebhookContactProfile {
    profile: WebhookProfile;
    wa_id: string;
}

export interface WebhookProfile {
    name: string;
}

export type MessageInteractiveTypes = "button" | "list";

export type MessageInteractive =
    | {
          type: "button";
          body: MessageBody;
          action: MessageAction<"button">;
      }
    | {
          type: "list";
          header?: MessageHeader;
          body: MessageBody;
          footer?: MessageFooter;
          action: MessageAction<"list">;
      };

export type MessageHeader = {
    type: "text";
    text: string;
};

export interface MessageBody {
    text: string;
}

export interface MessageFooter {
    text: string;
}

export type MessageAction<T extends MessageInteractiveTypes> = T extends "button"
    ? {
          buttons: MessageButton[];
      }
    : T extends "list"
    ? {
          button: string;
          sections: MessageSection[];
      }
    : never;

export interface MessageSection {
    title?: string;
    rows: MessageSectionRows[];
}

export interface MessageSectionRows {
    id: string;
    title: string;
    description?: string;
}

export interface MessageButton {
    type: "reply";
    reply: MessageReply;
}

export interface MessageReply {
    id: string;
    title: string;
}
