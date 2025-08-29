"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const mistralai_1 = require("@mistralai/mistralai");
class MistralAIClient {
    constructor(apiKey) {
        this.client = new mistralai_1.Mistral({ apiKey: apiKey });
    }
    generateFact(prompt) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const chatResponse = yield this.client.chat.complete({
                    model: 'mistral-small', // You can choose a different model if needed
                    messages: [{ role: 'user', content: prompt }],
                });
                return chatResponse.choices[0].message.content || 'Could not return a response';
            }
            catch (error) {
                console.error("Error generating fact from Mistral AI:", error);
                return "Could not generate a fact at this time.";
            }
        });
    }
}
exports.default = MistralAIClient;
