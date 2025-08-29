import { Mistral } from '@mistralai/mistralai';

class MistralAIClient {
  private client: Mistral;

  constructor(apiKey: string) {
    this.client = new Mistral({ apiKey: apiKey });
  }

  async generateFact(prompt: string): Promise<any> {
    try {
      const chatResponse = await this.client.chat.complete({
        model: 'mistral-small', // You can choose a different model if needed
        messages: [{ role: 'user', content: prompt }],
      });
      return chatResponse.choices[0].message.content || 'Could not return a response';
    } catch (error) {
      console.error("Error generating fact from Mistral AI:", error);
      return "Could not generate a fact at this time.";
    }
  }
}

export default MistralAIClient;
