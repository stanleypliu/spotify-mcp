import { Mistral } from "@mistralai/mistralai";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const MCP_API_KEY = process.env.MCP_API_KEY || "";

const mistralClient = new Mistral({ apiKey: MISTRAL_API_KEY });

async function testAIClient() {
  const userQuery = "Find me an energetic dance track.";

  console.log(`User query: "${userQuery}"`);

  try {
    // Step 1: Send user query to Mistral AI
    const chatResponse = await mistralClient.chat.complete({
      model: "voxtral-small-2507",
      messages: [{ role: "user", content: userQuery }],
      toolChoice: {
        type: "function",
        function: { name: "track_recommendation" },
      },
      tools: [
        {
          type: "function",
          function: {
            name: "track_recommendation",
            description:
              "Finds a track based on genre and mood from the user's Spotify playlists.",
            parameters: {
              type: "object",
              properties: {
                genre: {
                  type: "string",
                  description: "The genre of the track, e.g., rock, pop, jazz",
                },
                mood: {
                  type: "string",
                  description:
                    "The mood of the track (e.g., happy, sad, energetic, calm)",
                },
              },
              required: ["genre", "mood"],
            },
          },
        },
      ],
    });

    const toolCall = chatResponse.choices[0].message.toolCalls?.[0];

    if (toolCall && toolCall.function.name === "track_recommendation") {
      console.log("Mistral AI suggested a tool call:", toolCall.function);

      const { genre, mood } = JSON.parse(toolCall.function.arguments as string);

      // Step 2: Make HTTP request to your Ruby MCP server
      const rubyServerUrl = `http://localhost:4567/api/v1/track-recommendation?genre=${genre}&mood=${mood}`;
      console.log(`Calling Ruby MCP Server: ${rubyServerUrl}`);

      const rubyServerResponse = await axios.get(rubyServerUrl, {
        headers: {
          "X-API-Key": MCP_API_KEY,
          Authorization:
            "Bearer BQCDrWs5w5SKwG-VJO3bN-k_AKOKlaT2qoAmenohXGcvqaateddOCNTB6N6keQEmcIt4nwUsuYg-cx9mrZmAhcS2sLPzZLgdbGXXbCH7IeqaGgYT-IbyyVaZqfPZmtZaGl-qNP-1e4Uob_AMtO7qHo46HKKZ0rElVx8djF7MGsBDl8V2Xx81HlMGk6x8p_hk4RQfMse2Cw7kEcz_eGUBdVEa4ieg5zNWZJIMfublvbjIT3U",
        },
      });

      console.log("Ruby MCP Server Response:", rubyServerResponse.data);

      const artist = JSON.parse(JSON.stringify(rubyServerResponse.data))
        ["track"]["album"]["artists"].map(
          (artist: { name: string }) => artist.name
        )
        .join(", ");
      const song = JSON.parse(JSON.stringify(rubyServerResponse.data))["track"][
        "name"
      ];

      // Step 3: Send tool output back to Mistral AI
      const toolOutputResponse = await mistralClient.chat.complete({
        model: "voxtral-small-2507",
        messages: [
          { role: "user", content: userQuery },
          {
            role: "assistant",
            prefix: true,
            content: `I have a recommendation - ${artist} - ${song}`,
          },
        ],
      });

      console.log(
        "Final Mistral AI Response:",
        toolOutputResponse.choices[0].message.content
      );
    } else {
      console.log(
        "Mistral AI response:",
        chatResponse.choices[0].message.content
      );
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        "Error calling Ruby MCP Server:",
        error.response?.data || error.message
      );
    } else {
      console.error("Error in AI client test:", error);
    }
  }
}

testAIClient();
